export type LocalAiMode = 'off' | 'auto' | 'local-first' | 'cloud-first' | 'local-only'
export type LocalAiBudget = 'low' | 'balanced' | 'max'
export type LocalAiInstallState = 'not-installed' | 'installing' | 'installed' | 'failed'
export type LocalAiAvailability = 'disabled' | 'available' | 'installable' | 'unsupported' | 'failed'

export type VisionProviderId = 'disabled' | 'auto' | 'openrouter'
export type TtsProviderId = 'deepgram' | 'system' | 'disabled'
export type SttProviderId = 'deepgram' | 'whisper-local'

export interface LocalAiConfig {
  mode: LocalAiMode
  budget: LocalAiBudget
  visionProvider: VisionProviderId
  ttsProvider: TtsProviderId
  sttProvider: SttProviderId
  allowModelDownloads: boolean
  allowBackgroundWarmup: boolean
  cloudEscalationEnabled: boolean
  localOnlyBlocksCloudVision: boolean
}

export interface LocalAiHardwareProfile {
  platform: NodeJS.Platform
  arch: string
  totalMemoryGb: number
  cpuModel: string
  gpuSummary: string
  capabilityTier: 'low' | 'balanced' | 'high'
  reasons: string[]
}

export interface LocalAiProviderStatus {
  id: string
  label: string
  availability: LocalAiAvailability
  installState: LocalAiInstallState
  installedBytes?: number
  estimatedRequiredGb?: number
  lastError?: string
  lastLatencyMs?: number
  lastTestAt?: number
  lastTestSuccess?: boolean
}

export interface LocalAiInstallProgress {
  provider: string
  packId: string
  phase: 'downloading' | 'verifying' | 'installing' | 'installed' | 'failed'
  downloadedBytes: number
  totalBytes?: number
  file?: string
  error?: string
}

export interface LocalAiStatus {
  config: LocalAiConfig
  hardware: LocalAiHardwareProfile
  providers: LocalAiProviderStatus[]
}

export const DEFAULT_LOCAL_AI_CONFIG: LocalAiConfig = {
  mode: 'auto',
  budget: 'balanced',
  visionProvider: 'auto',
  ttsProvider: 'deepgram',
  sttProvider: 'deepgram',
  allowModelDownloads: false,
  allowBackgroundWarmup: false,
  cloudEscalationEnabled: true,
  localOnlyBlocksCloudVision: false,
}
