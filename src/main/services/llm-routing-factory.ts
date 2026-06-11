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
let modelsCache: {
  byId: Map<string, RelayModelInfo>
  /** Last path segment → canonical relay id. The relay serves Google models
   * under native ids (`gemini-3-flash-preview`) while Aura configures
   * OpenRouter ids (`google/gemini-3-flash-preview`) — basename matching
   * bridges the two naming schemes. */
  byBasename: Map<string, string>
  fetchedAt: number
  baseUrl: string
} | null = null
let refreshInFlight = false

function basenameOf(model: string): string {
  const segments = model.split('/')
  return (segments[segments.length - 1] || model).toLowerCase()
}

/** Canonical relay id for a requested model, or null when the relay does not
 * serve it under any known name. */
export function resolveRelayModelId(model: string): string | null {
  if (!modelsCache) return null
  const requested = model.trim()
  if (modelsCache.byId.has(requested)) return requested
  return modelsCache.byBasename.get(basenameOf(requested)) ?? null
}

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
  _opts?: { vision?: boolean }
): LlmRoutingConfig {
  const endpoints: LlmRoutingConfig['endpoints'] = []
  const relay = getRelaySource?.()

  if (relay?.enabled && relay.baseUrl.trim()) {
    void maybeRefreshRelayModels() // keeps the Settings relay panel fresh
    const baseUrl = normalizeOpenAiBaseUrl(relay.baseUrl, relay.baseUrl)
    // 'auto' engages the hub's own multi-provider router. Pinning a single
    // model proved brittle (one overloaded Google provider 502'd the whole
    // free path); with auto the hub walks its fallback chain itself, and
    // only a full hub failure drops through to OpenRouter. The hub never
    // tracks Aura's model selection — it always routes freely.
    endpoints.push({
      ...freeLlmApiEndpoint(baseUrl, relay.apiKey, 'auto'),
      tracksModelSelection: false,
    })
    console.log(`[LLMRouting] ${model} → LLM-Hub auto-route first, OpenRouter fallback.`)
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
    const byBasename = new Map<string, string>()
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
      const basename = basenameOf(id)
      if (!byBasename.has(basename)) byBasename.set(basename, id)
    }
    modelsCache = { byId, byBasename, fetchedAt: Date.now(), baseUrl }
    console.log(`[LLMRouting] relay model cache refreshed: ${byId.size} routable model(s).`)
  } catch (err) {
    // Keep any stale cache; routing simply stays OpenRouter-only for unknown ids.
    console.warn('[LLMRouting] relay model refresh failed:', err instanceof Error ? err.message : err)
  } finally {
    clearTimeout(timeout)
    refreshInFlight = false
  }
}
