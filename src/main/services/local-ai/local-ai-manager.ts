import type {
  LocalAiConfig,
  LocalAiProviderStatus,
  LocalAiStatus,
} from '@shared/local-ai-types'
import { getLocalAiHardwareProfile } from './hardware-profile'
import { ModelPackStore } from './model-pack-store'
import {
  downloadModelPack,
  LOCAL_AI_MODEL_PACKS,
  LocalAiModelPackId,
  ModelPackInstallProgress,
} from './model-pack-downloads'
import { CloudVisionProvider } from './providers/cloud-vision-provider'
import { isWhisperRuntimeInstalled, WhisperCppSttService } from './providers/whisper-cpp-stt-service'
import type { LLMService } from '../llm-service'

interface LocalAiManagerDeps {
  readConfig: () => LocalAiConfig
  hasDeepgramKey: () => boolean
  hasOpenRouterKey?: () => boolean
  modelPackStore: ModelPackStore
}

type ProviderDiagnostics = Pick<LocalAiProviderStatus, 'lastError' | 'lastLatencyMs' | 'lastTestAt' | 'lastTestSuccess'>

export class LocalAiManager {
  private readonly diagnostics = new Map<string, ProviderDiagnostics>()
  private legacyPacksCleaned = false

  constructor(private readonly deps: LocalAiManagerDeps) {}

  recordProviderDiagnostic(id: string, diagnostic: ProviderDiagnostics): void {
    this.diagnostics.set(id, {
      ...this.diagnostics.get(id),
      ...diagnostic,
      lastTestAt: diagnostic.lastTestAt ?? Date.now(),
    })
  }

  removeModelPack(id: LocalAiModelPackId): { removed: boolean; path: string } {
    return this.deps.modelPackStore.removePack(id)
  }

  installModelPack(
    id: LocalAiModelPackId,
    onProgress?: (progress: ModelPackInstallProgress) => void
  ): Promise<{ bytes: number; path: string }> {
    return downloadModelPack(id, {
      modelPackStore: this.deps.modelPackStore,
      onProgress,
    })
  }

  createWhisperSttService(
    speaker: 'interviewer' | 'user',
    language: string,
    keyterms: string[] = []
  ): WhisperCppSttService {
    return new WhisperCppSttService(this.deps.modelPackStore, speaker, language, keyterms)
  }

  createCloudVisionProvider(getLLMService: () => LLMService | null): CloudVisionProvider {
    return new CloudVisionProvider({
      hasApiKey: () => this.deps.hasOpenRouterKey?.() ?? true,
      getLLMService,
    })
  }

  getStatus(): LocalAiStatus {
    this.cleanupLegacyModelPacksOnce()
    const config = this.deps.readConfig()
    const hardware = getLocalAiHardwareProfile()
    const disabled = config.mode === 'off'

    return {
      config,
      hardware,
      providers: [
        this.withDiagnostics(this.deepgramStatus(config)),
        this.withDiagnostics(this.whisperStatus(disabled)),
      ],
    }
  }

  private cleanupLegacyModelPacksOnce(): void {
    if (this.legacyPacksCleaned) return
    this.legacyPacksCleaned = true
    const removed = this.deps.modelPackStore
      .removeLegacyPacks(['piper-en-us-small', 'minicpm-v-2_6-openvino-int4', 'kokoro-82m'])
      .filter((item) => item.removed)
    if (removed.length > 0) {
      console.info('[LocalAI] Removed legacy model packs:', removed.map((item) => item.id).join(', '))
    }
  }

  private withDiagnostics(status: LocalAiProviderStatus): LocalAiProviderStatus {
    const diagnostic = this.diagnostics.get(status.id)
    if (!diagnostic) return status
    return {
      ...status,
      ...diagnostic,
      lastError: diagnostic.lastError || status.lastError,
    }
  }

  private deepgramStatus(config: LocalAiConfig): LocalAiProviderStatus {
    if (isLocalOnlyMode(config)) {
      return {
        id: 'deepgram',
        label: 'Deepgram speech',
        availability: 'failed',
        installState: 'not-installed',
        lastError: 'Blocked by Local-only mode',
      }
    }

    if (this.deps.hasDeepgramKey()) {
      return {
        id: 'deepgram',
        label: 'Deepgram speech',
        availability: 'available',
        installState: 'not-installed',
      }
    }

    return {
      id: 'deepgram',
      label: 'Deepgram speech',
      availability: 'failed',
      installState: 'not-installed',
      lastError: 'Deepgram API key missing',
    }
  }

  private whisperStatus(disabled: boolean): LocalAiProviderStatus {
    const packId = 'whisper-tiny-q5_1-cpp'
    const installed = this.deps.modelPackStore.isInstalled(packId)
    const runtimeReady = isWhisperRuntimeInstalled(this.deps.modelPackStore)
    const estimatedBytes = LOCAL_AI_MODEL_PACKS[packId].estimatedBytes
    return {
      id: 'whisper-local',
      label: 'Whisper local speech',
      availability: disabled ? 'disabled' : installed && runtimeReady ? 'available' : installed ? 'failed' : 'installable',
      installState: installed ? 'installed' : 'not-installed',
      installedBytes: this.deps.modelPackStore.installedBytes(packId),
      estimatedRequiredGb: Math.round((estimatedBytes / 1024 / 1024 / 1024) * 10) / 10,
      lastError: installed && !disabled && !runtimeReady
        ? 'Whisper runtime is missing. Remove and reinstall the Whisper pack to download the runtime.'
        : undefined,
    }
  }

}

function isLocalOnlyMode(config: LocalAiConfig): boolean {
  return config.mode === 'local-only'
}
