/**
 * CompanionPipeline — Phase 2 of the mode-isolation refactor.
 *
 * Owns the companion-mode session runtime: dual STT (system audio + mic
 * for the user's barge-in voice), the per-session LLM service, audio
 * capture wiring, and the heartbeat lifecycle that drives the bubble
 * (and Aura TTS when voice mode is on).
 *
 * Per plan §13.4, companion is one pipeline differentiated by
 * `voiceEnabled`. Voice mode adds a stop hook that
 * flushes the CompanionTtsService so audio playback halts on stop.
 *
 * The answer-flow callbacks
 * (transcript fanout, auto-answer trigger, answer streaming) are
 * passed in as deps; the heartbeat / bubble bodies still live in
 * ipc-handlers and are reached via the injected start/stop hooks.
 */

import type {
  AgentMode,
  AgentPresenceState,
  AppConfig,
  TranscriptEntry,
} from '@shared/types'

import type { AudioCaptureService } from '../audio/capture'
import { LLMService } from '../services/llm-service'
import { buildLlmRouting } from '../services/llm-routing-factory'
import type { SessionRuntimeService } from '../services/session-runtime-service'
import type { SessionRuntimeStore } from '../services/session-runtime-store'
import { STTService } from '../services/stt-service'

import {
  BasePipeline,
  type PipelineStartContext,
  type PipelineState,
  type PipelineStopReason,
} from './pipeline'

export interface CompanionPipelineDeps {
  // ── Per-session inputs ────────────────────────────────────
  voiceEnabled: boolean
  createSttService: (speaker: 'system' | 'user', language: string, keyterms: string[]) => STTService
  openrouterApiKey: string
  defaultModel: string
  sttLanguage: string
  micEnabled: boolean
  utteranceDebounceMs: number
  shouldAutoTriggerFromMic: boolean
  keyterms: string[]

  // ── Singletons (injected, not imported) ───────────────────
  sessionRuntimeStore: SessionRuntimeStore
  sessionRuntimeService: SessionRuntimeService
  audioCapture: AudioCaptureService

  // ── Voice-only teardown hook (voice mode flushes Aura TTS) ──
  stopVoiceOutput: () => void

  // ── Runtime callbacks reused from the legacy binding ──────
  onTranscript: (entry: TranscriptEntry) => void
  onAutoAnswerTrigger: () => void
  onAudioChunk: (source: 'system' | 'user', chunk: Buffer) => void
  onAnswerChunk: (fullAnswer: string) => void
  onAnswerDone: (answer: string) => void
  onAnswerError: (error: Error) => void
}

export class CompanionPipeline extends BasePipeline {
  readonly mode: AgentMode

  private presence: AgentPresenceState = 'idle'
  private busy = false

  constructor(private readonly deps: CompanionPipelineDeps) {
    super()
    this.mode = 'companion'
  }

  async start(_ctx: PipelineStartContext): Promise<void> {
    const d = this.deps
    const store = d.sessionRuntimeStore

    store.sttService = d.createSttService('system', d.sttLanguage, d.keyterms)
    store.micSttService = d.micEnabled
      ? d.createSttService('user', d.sttLanguage, d.keyterms)
      : null
    store.llmService = new LLMService(
      d.openrouterApiKey,
      d.defaultModel,
      buildLlmRouting(d.openrouterApiKey, d.defaultModel)
    )

    d.sessionRuntimeService.clearPendingGeneration()

    d.sessionRuntimeService.bindSessionRuntime({
      systemSttService: store.sttService,
      micSttService: store.micSttService,
      llmService: store.llmService,
      audioCapture: d.audioCapture,
      utteranceDebounceMs: d.utteranceDebounceMs,
      onTranscript: d.onTranscript,
      onAutoAnswerTrigger: d.onAutoAnswerTrigger,
      shouldAutoTriggerFromMic: d.shouldAutoTriggerFromMic,
      onAudioChunk: d.onAudioChunk,
      onAnswerChunk: d.onAnswerChunk,
      onAnswerDone: d.onAnswerDone,
      onAnswerError: d.onAnswerError,
    })

    await store.sttService.connect()
    await store.micSttService?.connect()
    d.audioCapture.startCapture()

    this.presence = 'listening'
  }

  async stop(_reason: PipelineStopReason): Promise<void> {
    const d = this.deps
    const store = d.sessionRuntimeStore

    d.sessionRuntimeService.clearPendingGeneration()
    d.audioCapture.stopCapture()
    d.audioCapture.removeAllListeners('audio-data')

    await store.sttService?.disconnect()
    await store.micSttService?.disconnect()
    store.llmService?.abort()

    if (d.voiceEnabled) {
      d.stopVoiceOutput()
    }

    this.presence = 'idle'
    this.busy = false
  }

  override onTranscriptInterim(_entry: TranscriptEntry): void {
    /* handled via the bound STT listeners until later phase-2 commits */
  }

  override onTranscriptFinal(_entry: TranscriptEntry): void {
    /* handled via the bound STT listeners until later phase-2 commits */
  }

  override onSettingsChanged(_diff: Partial<AppConfig>): void {
    /* personality / voice toggles stay in ipc-handlers SET_CONFIG */
  }

  getState(): PipelineState {
    return {
      mode: this.mode,
      presence: this.presence,
      busy: this.busy,
    }
  }
}
