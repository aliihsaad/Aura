import {
  type LlmRoutingConfig,
  openRouterEndpoint,
  freeLlmApiEndpoint,
  normalizeOpenAiBaseUrl,
} from './llm-routing'

/**
 * Central LLM routing: LLM-Hub (free relay) first, OpenRouter fallback.
 *
 * The relay's /v1/models is availability-filtered server-side (only routable,
 * non-quarantined models appear) and carries capability metadata, so routing
 * decisions are a cache lookup here — no probing. A model that the relay does
 * not serve goes straight to OpenRouter with no wasted round-trip.
 */

export interface RelayModelInfo {
  id: string
  name?: string
  ownedBy?: string
  contextWindow?: number
  capabilities: string[]
}

interface RelaySource {
  baseUrl: string
  apiKey: string
  enabled: boolean
}

const MODELS_CACHE_TTL_MS = 60 * 60 * 1000
const MODELS_FETCH_TIMEOUT_MS = 10_000

let getRelaySource: (() => RelaySource) | null = null
let modelsCache: { byId: Map<string, RelayModelInfo>; fetchedAt: number; baseUrl: string } | null = null
let refreshInFlight = false

/** Wire the factory to live config (called once from ipc-handlers) and warm
 * the model cache in the background. */
export function configureFreeLlmRouting(getter: () => RelaySource): void {
  getRelaySource = getter
  void maybeRefreshRelayModels()
}

/** Snapshot of the relay's currently-routable models, for the Settings UI. */
export function getRelayModels(): RelayModelInfo[] {
  void maybeRefreshRelayModels()
  return modelsCache ? [...modelsCache.byId.values()] : []
}

/**
 * Routing for one LLMService instance. Synchronous by design — construction
 * sites can't await — so it reads the last cache snapshot and (re)warms it in
 * the background. Until the first refresh lands, everything routes to
 * OpenRouter, which is the safe direction to be wrong in.
 */
export function buildLlmRouting(
  openRouterApiKey: string,
  model: string,
  opts?: { vision?: boolean }
): LlmRoutingConfig {
  const endpoints: LlmRoutingConfig['endpoints'] = []
  const relay = getRelaySource?.()

  if (relay?.enabled && relay.baseUrl.trim()) {
    void maybeRefreshRelayModels()
    const baseUrl = normalizeOpenAiBaseUrl(relay.baseUrl, relay.baseUrl)
    const info = modelsCache?.baseUrl === baseUrl ? modelsCache.byId.get(model) : undefined
    const visionOk =
      !opts?.vision || info?.capabilities.some((cap) => /vision|image|multimodal/i.test(cap))
    if (info && visionOk) {
      endpoints.push(freeLlmApiEndpoint(baseUrl, relay.apiKey, model))
    }
  }

  if (openRouterApiKey) {
    endpoints.push(openRouterEndpoint(openRouterApiKey, model))
  }
  return { endpoints }
}

async function maybeRefreshRelayModels(): Promise<void> {
  const relay = getRelaySource?.()
  if (!relay?.enabled || !relay.baseUrl.trim() || refreshInFlight) return
  const baseUrl = normalizeOpenAiBaseUrl(relay.baseUrl, relay.baseUrl)
  if (modelsCache?.baseUrl === baseUrl && Date.now() - modelsCache.fetchedAt < MODELS_CACHE_TTL_MS) {
    return
  }

  refreshInFlight = true
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: relay.apiKey ? { Authorization: `Bearer ${relay.apiKey}` } : {},
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const parsed = await response.json()
    const byId = new Map<string, RelayModelInfo>()
    for (const entry of Array.isArray(parsed?.data) ? parsed.data : []) {
      const id = String(entry?.id ?? '').trim()
      if (!id) continue
      byId.set(id, {
        id,
        name: entry?.name ? String(entry.name) : undefined,
        ownedBy: entry?.owned_by ? String(entry.owned_by) : undefined,
        contextWindow: Number.isFinite(Number(entry?.context_window))
          ? Number(entry.context_window)
          : undefined,
        capabilities: Array.isArray(entry?.capabilities) ? entry.capabilities.map(String) : [],
      })
    }
    modelsCache = { byId, fetchedAt: Date.now(), baseUrl }
    console.log(`[LLMRouting] relay model cache refreshed: ${byId.size} routable model(s).`)
  } catch (err) {
    // Keep any stale cache; routing simply stays OpenRouter-only for unknown ids.
    console.warn('[LLMRouting] relay model refresh failed:', err instanceof Error ? err.message : err)
  } finally {
    clearTimeout(timeout)
    refreshInFlight = false
  }
}
