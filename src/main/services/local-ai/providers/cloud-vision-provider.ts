import type { LLMService } from '../../llm-service'
import {
  parseVisionCortexJson,
  VisionCortexInput,
  VisionCortexResult,
  VisionProvider,
} from './vision-provider'

interface CloudVisionProviderDeps {
  hasApiKey: () => boolean
  getLLMService: () => LLMService | null
}

export class CloudVisionProvider implements VisionProvider {
  readonly id = 'openrouter' as const

  constructor(private readonly deps: CloudVisionProviderDeps) {}

  async isAvailable(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.deps.hasApiKey()) {
      return { ok: false, reason: 'OpenRouter API key missing' }
    }
    if (!this.deps.getLLMService()) {
      return { ok: false, reason: 'OpenRouter LLM service is not initialized' }
    }
    return { ok: true }
  }

  async analyze(input: VisionCortexInput): Promise<VisionCortexResult> {
    const available = await this.isAvailable()
    if (!available.ok) {
      throw new Error(available.reason || 'OpenRouter vision provider is not available')
    }

    const startedAt = Date.now()
    const llm = this.deps.getLLMService()
    if (!llm) throw new Error('OpenRouter LLM service is not initialized')

    const raw = await llm.analyzeVisionCortex(input)
    return parseVisionCortexJson(this.id, raw, Date.now() - startedAt)
  }
}
