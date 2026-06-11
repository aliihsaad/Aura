import {
  OPENROUTER_BASE_URL,
} from '@shared/constants'

export type LlmEndpointId = 'openrouter' | 'freellmapi'

export interface LlmEndpoint {
  id: LlmEndpointId
  label: string
  baseUrl: string
  apiKey: string
  model: string
  tracksModelSelection: boolean
  headers: Record<string, string>
}

export interface LlmRoutingConfig {
  endpoints: LlmEndpoint[]
}

export function normalizeOpenAiBaseUrl(value: string, fallback: string): string {
  const trimmed = String(value || '').trim() || fallback
  return trimmed.replace(/\/+$/, '')
}

export function openRouterEndpoint(apiKey: string, model: string): LlmEndpoint {
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: normalizeOpenAiBaseUrl(OPENROUTER_BASE_URL, OPENROUTER_BASE_URL),
    apiKey,
    model,
    tracksModelSelection: true,
    headers: {
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Aura',
    },
  }
}

/** LLM-Hub (FreeLLMAPI successor) — OpenAI-compatible free relay. Placed
 * before the OpenRouter endpoint so reasoning/vision calls cost nothing
 * while the relay is healthy; LLMService falls back automatically. */
export function freeLlmApiEndpoint(baseUrl: string, apiKey: string, model: string): LlmEndpoint {
  return {
    id: 'freellmapi',
    label: 'LLM-Hub',
    baseUrl: normalizeOpenAiBaseUrl(baseUrl, baseUrl),
    apiKey,
    model,
    tracksModelSelection: true,
    headers: {},
  }
}

export function shouldFallbackAfterStatus(status: number): boolean {
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  )
}
