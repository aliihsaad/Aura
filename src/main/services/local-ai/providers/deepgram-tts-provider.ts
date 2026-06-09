import { CompanionTtsService } from '../../agent/companion-tts-service'
import type { TtsAvailability, TtsChunk, TtsProvider } from './tts-provider'

interface DeepgramTtsProviderDeps {
  getApiKey: () => string
  getModel: () => string
  getService: () => CompanionTtsService | null
}

export class DeepgramTtsProvider implements TtsProvider {
  readonly id = 'deepgram'
  readonly label = 'Deepgram Aura'

  constructor(private readonly deps: DeepgramTtsProviderDeps) {}

  async isAvailable(): Promise<TtsAvailability> {
    return this.deps.getApiKey()
      ? { ok: true }
      : { ok: false, reason: 'Deepgram API key missing' }
  }

  async speak(text: string, _onChunk: (chunk: TtsChunk) => void): Promise<void> {
    const service = this.deps.getService()
    if (!service) throw new Error('Deepgram TTS service is unavailable')
    service.beginTurn()
    service.enqueueDelta(text)
    service.endTurn()
  }

  stop(): void {
    this.deps.getService()?.stop()
  }
}
