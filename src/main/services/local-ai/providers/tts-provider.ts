import type { TtsProviderId } from '@shared/local-ai-types'

export interface TtsChunk {
  sampleRate: number
  channels: number
  pcmBase64: string
}

export interface TtsAvailability {
  ok: boolean
  reason?: string
}

export interface TtsProvider {
  readonly id: TtsProviderId
  readonly label: string
  speak(text: string, onChunk: (chunk: TtsChunk) => void): Promise<void>
  stop(): void
  isAvailable(): Promise<TtsAvailability>
}

export class UnavailableTtsProvider implements TtsProvider {
  readonly label: string

  constructor(
    readonly id: TtsProviderId,
    reason: string
  ) {
    this.label = reason
  }

  async speak(): Promise<void> {
    throw new Error(this.label)
  }

  stop(): void {}

  async isAvailable(): Promise<TtsAvailability> {
    return { ok: false, reason: this.label }
  }
}
