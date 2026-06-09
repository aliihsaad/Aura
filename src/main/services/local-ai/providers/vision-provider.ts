import type { VisionProviderId } from '@shared/local-ai-types'

export interface VisionCortexInput {
  imageBase64: string
  mimeType: 'image/png' | 'image/jpeg'
  task: 'screen-summary' | 'ocr' | 'ui-change' | 'answer-context'
  maxTokens: number
}

export interface VisionCortexResult {
  provider: VisionProviderId
  summary: string
  visibleText: string[]
  uiHints: string[]
  confidence: 'low' | 'medium' | 'high'
  latencyMs: number
  shouldEscalate: boolean
  escalationReason?: string
}

export interface VisionProvider {
  readonly id: VisionProviderId
  analyze(input: VisionCortexInput): Promise<VisionCortexResult>
  isAvailable(): Promise<{ ok: boolean; reason?: string }>
}

export function normalizeVisionCortexResult(
  provider: VisionProviderId,
  value: Partial<VisionCortexResult>,
  latencyMs: number
): VisionCortexResult {
  const confidence = value.confidence === 'high' || value.confidence === 'medium'
    ? value.confidence
    : 'low'
  const visibleText = Array.isArray(value.visibleText)
    ? value.visibleText.map((item) => String(item)).filter(Boolean).slice(0, 20)
    : []
  const uiHints = Array.isArray(value.uiHints)
    ? value.uiHints.map((item) => String(item)).filter(Boolean).slice(0, 20)
    : []

  return {
    provider,
    summary: String(value.summary || '').trim() || 'No visual summary returned.',
    visibleText,
    uiHints,
    confidence,
    latencyMs,
    shouldEscalate: Boolean(value.shouldEscalate),
    escalationReason: value.escalationReason ? String(value.escalationReason) : undefined,
  }
}

export function parseVisionCortexJson(
  provider: VisionProviderId,
  raw: string,
  latencyMs: number
): VisionCortexResult {
  try {
    const jsonText = extractJsonObject(raw)
    const parsed = JSON.parse(jsonText) as Partial<VisionCortexResult>
    return normalizeVisionCortexResult(provider, parsed, latencyMs)
  } catch {
    return normalizeVisionCortexResult(
      provider,
      {
        summary: raw.trim(),
        confidence: 'low',
        shouldEscalate: true,
        escalationReason: 'Vision provider returned unstructured output',
      },
      latencyMs
    )
  }
}

export function formatVisionCortexContext(result: VisionCortexResult): string {
  const lines = [
    'LOCAL VISION CORTEX',
    `Provider: ${result.provider}`,
    `Summary: ${result.summary}`,
    `Confidence: ${result.confidence}`,
  ]
  if (result.visibleText.length > 0) {
    lines.push(`Visible text: ${result.visibleText.join(' | ')}`)
  }
  if (result.uiHints.length > 0) {
    lines.push(`UI hints: ${result.uiHints.join(' | ')}`)
  }
  lines.push(
    `Escalate: ${result.shouldEscalate ? 'yes' : 'no'}${result.escalationReason ? `, ${result.escalationReason}` : ''}`
  )
  lines.push(`Latency: ${result.latencyMs}ms`)
  return lines.join('\n')
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found')
  return match[0]
}
