# FreeLLMAPI Companion Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FreeLLMAPI-first Companion chat, optional FreeLLMAPI TTS, and an opt-in Companion Realtime Beta pipeline while keeping Classic Companion as the default working setup.

**Architecture:** Keep `AgentMode` unchanged (`interview` and `companion`). Add provider/engine settings inside Companion: `companionLlmProvider` selects OpenRouter-only vs FreeLLMAPI-first chat fallback, and `companionEngine` selects Classic vs Realtime Beta. Classic continues to use `CompanionPipeline`; Realtime Beta uses a new `CompanionRealtimePipeline` and a small FreeLLMAPI realtime client service.

**Tech Stack:** Electron 41, React 19, TypeScript, electron-store secure key storage, existing `ModeRouter` pipeline architecture, existing PCM audio IPC, FreeLLMAPI OpenAI-compatible `/v1/chat/completions`, `/v1/audio/speech`, and `/v1/realtime/sessions`.

---

## Product Decisions

1. **Classic is default.** Existing Companion behavior remains the default and must keep working without FreeLLMAPI configured.
2. **No third top-level mode.** Realtime Beta is a Companion engine setting, not a new `AgentMode`.
3. **Chat fallback ships first.** FreeLLMAPI-first chat is lower risk and reduces OpenRouter usage before realtime audio is introduced.
4. **TTS is optional.** FreeLLMAPI TTS is a Local AI speech output provider and does not become required for FreeLLMAPI chat.
5. **Realtime gets its own pipeline.** `CompanionRealtimePipeline` does not mutate the Classic STT -> LLM -> TTS loop.
6. **Fallback boundary is explicit.** Before realtime connects, failure can fall back to Classic Companion. After WebSocket connect, failure stops realtime cleanly and preserves artifacts.
7. **No broad provider rewrite.** Keep provider logic main-process-local. Do not recreate the reverted shared `llm-provider-config.ts` approach.

---

## File Structure

**New files:**

- `src/main/services/llm-routing.ts` - OpenAI-compatible endpoint normalization, fallback classification, and endpoint constructors for OpenRouter and FreeLLMAPI.
- `src/main/services/local-ai/providers/freellmapi-tts-provider.ts` - TTS provider that calls FreeLLMAPI `/v1/audio/speech`.
- `src/main/services/realtime/freellmapi-realtime-client.ts` - session minting, WebSocket lifecycle, audio send, and realtime event emission.
- `src/main/services/realtime/realtime-message-utils.ts` - Gemini Live message builders and server-message summarizer copied into Whisphry's source tree.
- `src/main/pipelines/companion-realtime-pipeline.ts` - dedicated beta pipeline.
- `scripts/check-freellmapi-provider-config.mjs` - config, defaults, secure-key, provider-selection, and Classic-default guardrail.
- `scripts/check-companion-realtime-pipeline.mjs` - realtime pipeline isolation and fallback-boundary guardrail.

**Modified files:**

- `src/shared/constants.ts` - FreeLLMAPI base URL default.
- `src/shared/types.ts` - Companion provider/engine/realtime config types, AppConfig fields, ModeScopedConfig fields, optional session-state realtime status.
- `src/shared/local-ai-types.ts` - add `freellmapi` TTS provider.
- `src/main/services/mode-config-service.ts` - normalize/persist new Companion fields.
- `src/main/services/llm-service.ts` - accept endpoint routing and use OpenAI-compatible fallback calls instead of hard-coded OpenRouter fetches in Companion paths.
- `src/main/pipelines/companion-pipeline.ts` - accept an `llmRouting` dependency and construct `LLMService` with it.
- `src/main/pipelines/index.ts` - add realtime builder and select Classic vs Realtime Beta for `companion`.
- `src/main/pipelines/pipeline.ts` - allow realtime status through `PipelineState`.
- `src/main/services/session-runtime-store.ts` - add persisted-in-memory Companion realtime status for session-state broadcasts.
- `src/main/services/session-state-service.ts` - include optional realtime status in session-state broadcasts.
- `src/main/ipc-handlers.ts` - config read/write, secure FreeLLMAPI key, LLM routing, TTS provider selection, realtime pipeline deps, START_SESSION key gate.
- `src/preload/index.ts` - expose new config types through existing `getConfig`/`setConfig` declarations.
- `src/renderer/settings/components/ApiConfig.tsx` - FreeLLMAPI key/base URL and Companion engine/provider UI.
- `src/renderer/settings/components/LocalAiSettings.tsx` - speech output selector with FreeLLMAPI.
- `package.json` - add guardrail scripts to `check:release`.

---

## Task 0: Baseline Safety Check

**Files:**
- Read only: worktree status and approved spec.

- [ ] **Step 1: Confirm dirty worktree scope**

Run:

```bash
git status --short
```

Expected: There may be unrelated modified/untracked files already present. Do not revert them. Before each commit, stage only the files from the current task.

- [ ] **Step 2: Re-read the approved design**

Run:

```bash
Get-Content docs\superpowers\specs\2026-05-26-freellmapi-companion-realtime-design.md
```

Expected: The spec says Classic Companion remains default, FreeLLMAPI chat/TTS are optional, and Realtime Beta gets a dedicated pipeline.

- [ ] **Step 3: Run current fast guardrails**

Run:

```bash
node scripts/check-mode-isolation.mjs
node scripts/check-local-ai-config.mjs
node scripts/check-local-ai-routing.mjs
```

Expected: PASS, or fail only on pre-existing dirty-worktree issues. Record any pre-existing failure in the implementation notes before editing.

---

## Task 1: Add Shared Types, Defaults, And Config Guardrail

**Files:**
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/local-ai-types.ts`
- Modify: `src/main/services/mode-config-service.ts`
- Create: `scripts/check-freellmapi-provider-config.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing guardrail**

Create `scripts/check-freellmapi-provider-config.mjs`:

```js
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(path, needle, message) {
  const text = read(path)
  if (!text.includes(needle)) {
    throw new Error(`${message}\nMissing in ${path}: ${needle}`)
  }
}

assertIncludes(
  'src/shared/constants.ts',
  "DEFAULT_FREELLMAPI_BASE_URL = 'http://localhost:3001/v1'",
  'FreeLLMAPI default base URL must be centralized.'
)

assertIncludes(
  'src/shared/types.ts',
  "export type CompanionLlmProvider = 'openrouter' | 'freellmapi-first'",
  'Companion LLM provider type must exist.'
)

assertIncludes(
  'src/shared/types.ts',
  "export type CompanionEngine = 'classic' | 'realtime-beta'",
  'Companion engine type must exist.'
)

assertIncludes(
  'src/shared/types.ts',
  'freeLlmApiBaseUrl?: string',
  'AppConfig must expose FreeLLMAPI base URL.'
)

assertIncludes(
  'src/shared/types.ts',
  'freeLlmApiKey?: string',
  'AppConfig must expose FreeLLMAPI key through getConfig.'
)

assertIncludes(
  'src/shared/types.ts',
  'llmProvider: CompanionLlmProvider',
  'ModeScopedConfig.companion must persist LLM provider choice.'
)

assertIncludes(
  'src/shared/types.ts',
  'engine: CompanionEngine',
  'ModeScopedConfig.companion must persist Classic vs Realtime Beta.'
)

assertIncludes(
  'src/shared/local-ai-types.ts',
  "export type TtsProviderId = 'deepgram' | 'system' | 'freellmapi' | 'disabled'",
  'Local AI TTS providers must include FreeLLMAPI.'
)

assertIncludes(
  'src/main/services/mode-config-service.ts',
  "companion.llmProvider",
  'ModeConfigService must read companion LLM provider.'
)

assertIncludes(
  'src/main/services/mode-config-service.ts',
  "companion.engine",
  'ModeConfigService must read companion engine.'
)

assertIncludes(
  'package.json',
  'check:freellmapi-provider',
  'package.json must expose the FreeLLMAPI provider guardrail.'
)

console.log('check-freellmapi-provider-config: ok')
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
```

Expected: FAIL because the FreeLLMAPI types/defaults are not added yet.

- [ ] **Step 3: Add constant**

In `src/shared/constants.ts`, add after `OPENROUTER_BASE_URL`:

```ts
export const DEFAULT_FREELLMAPI_BASE_URL = 'http://localhost:3001/v1'
export const DEFAULT_COMPANION_LLM_PROVIDER = 'openrouter' as const
export const DEFAULT_COMPANION_ENGINE = 'classic' as const
export const DEFAULT_COMPANION_REALTIME_VOICE = 'alloy'
export const DEFAULT_COMPANION_REALTIME_MODEL = 'auto'
```

- [ ] **Step 4: Extend shared types**

In `src/shared/types.ts`, keep the existing imports unchanged and add these exported types near `LiveAgentMode`:

```ts
export type CompanionLlmProvider = 'openrouter' | 'freellmapi-first'
export type CompanionEngine = 'classic' | 'realtime-beta'
export type CompanionRealtimeStatus = 'off' | 'connecting' | 'live' | 'failed' | 'stopped'
```

Extend `AppConfig`:

```ts
  freeLlmApiKey?: string
  freeLlmApiBaseUrl?: string
  companionLlmProvider?: CompanionLlmProvider
  companionEngine?: CompanionEngine
  companionRealtimeModel?: string
  companionRealtimeVoiceName?: string
  companionRealtimeInputTranscription?: boolean
  companionRealtimeOutputTranscription?: boolean
```

Extend `ModeScopedConfig['companion']`:

```ts
    llmProvider: CompanionLlmProvider
    engine: CompanionEngine
    realtimeModel: string
    realtimeVoiceName: string
    realtimeInputTranscription: boolean
    realtimeOutputTranscription: boolean
```

Extend `SessionState`:

```ts
  companionEngine?: CompanionEngine
  companionRealtimeStatus?: CompanionRealtimeStatus
```

- [ ] **Step 5: Add FreeLLMAPI TTS provider type**

In `src/shared/local-ai-types.ts`, change the TTS union to:

```ts
export type TtsProviderId = 'deepgram' | 'system' | 'freellmapi' | 'disabled'
```

Keep `DEFAULT_LOCAL_AI_CONFIG.ttsProvider` as `'deepgram'`.

- [ ] **Step 6: Normalize companion config fields**

In `src/main/services/mode-config-service.ts`, import the new defaults:

```ts
  DEFAULT_COMPANION_ENGINE,
  DEFAULT_COMPANION_LLM_PROVIDER,
  DEFAULT_COMPANION_REALTIME_MODEL,
  DEFAULT_COMPANION_REALTIME_VOICE,
```

Add helper functions near `stringArrayValue`:

```ts
function companionLlmProviderValue(value: unknown): 'openrouter' | 'freellmapi-first' {
  return value === 'freellmapi-first' ? 'freellmapi-first' : 'openrouter'
}

function companionEngineValue(value: unknown): 'classic' | 'realtime-beta' {
  return value === 'realtime-beta' ? 'realtime-beta' : 'classic'
}
```

In `readModeScopedConfig().companion`, add:

```ts
        llmProvider: companionLlmProviderValue(
          companion.llmProvider ?? this.configStore.get('companionLlmProvider', DEFAULT_COMPANION_LLM_PROVIDER)
        ),
        engine: companionEngineValue(
          companion.engine ?? this.configStore.get('companionEngine', DEFAULT_COMPANION_ENGINE)
        ),
        realtimeModel: nonEmptyString(
          companion.realtimeModel,
          String(this.configStore.get('companionRealtimeModel', DEFAULT_COMPANION_REALTIME_MODEL))
        ),
        realtimeVoiceName: nonEmptyString(
          companion.realtimeVoiceName,
          String(this.configStore.get('companionRealtimeVoiceName', DEFAULT_COMPANION_REALTIME_VOICE))
        ),
        realtimeInputTranscription: booleanValue(
          companion.realtimeInputTranscription,
          Boolean(this.configStore.get('companionRealtimeInputTranscription', true))
        ),
        realtimeOutputTranscription: booleanValue(
          companion.realtimeOutputTranscription,
          Boolean(this.configStore.get('companionRealtimeOutputTranscription', true))
        ),
```

In `updateModeScopedConfigFromFlatPatch`, add:

```ts
    if (config.companionLlmProvider !== undefined) {
      modes.companion.llmProvider = companionLlmProviderValue(config.companionLlmProvider)
    }
    if (config.companionEngine !== undefined) {
      modes.companion.engine = companionEngineValue(config.companionEngine)
    }
    if (config.companionRealtimeModel !== undefined) {
      modes.companion.realtimeModel = nonEmptyString(config.companionRealtimeModel, DEFAULT_COMPANION_REALTIME_MODEL)
    }
    if (config.companionRealtimeVoiceName !== undefined) {
      modes.companion.realtimeVoiceName = nonEmptyString(config.companionRealtimeVoiceName, DEFAULT_COMPANION_REALTIME_VOICE)
    }
    if (config.companionRealtimeInputTranscription !== undefined) {
      modes.companion.realtimeInputTranscription = Boolean(config.companionRealtimeInputTranscription)
    }
    if (config.companionRealtimeOutputTranscription !== undefined) {
      modes.companion.realtimeOutputTranscription = Boolean(config.companionRealtimeOutputTranscription)
    }
```

- [ ] **Step 7: Wire package script**

In `package.json`, add:

```json
"check:freellmapi-provider": "node scripts/check-freellmapi-provider-config.mjs",
```

Then add it into `check:release` before `npm run build`:

```json
"npm run check:freellmapi-provider && npm run build"
```

- [ ] **Step 8: Run task checks**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add src/shared/constants.ts src/shared/types.ts src/shared/local-ai-types.ts src/main/services/mode-config-service.ts scripts/check-freellmapi-provider-config.mjs package.json
git commit -m "feat: add freellmapi companion config types"
```

---

## Task 2: Wire FreeLLMAPI Config Through Main And Settings

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/settings/components/ApiConfig.tsx`
- Modify: `scripts/check-freellmapi-provider-config.mjs`

- [ ] **Step 1: Extend guardrail for config plumbing**

Append to `scripts/check-freellmapi-provider-config.mjs`:

```js
assertIncludes(
  'src/main/ipc-handlers.ts',
  "getSecureKey('freeLlmApiKey')",
  'ipc-handlers must read FreeLLMAPI secure key.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "new Set(['openrouterApiKey', 'deepgramApiKey', 'freeLlmApiKey'])",
  'FreeLLMAPI key must use secure key storage.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "'freeLlmApiBaseUrl'",
  'FreeLLMAPI base URL must be allowed through SET_CONFIG.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'freeLlmApiBaseUrl',
  'Settings UI must expose FreeLLMAPI base URL.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'freeLlmApiKey',
  'Settings UI must expose FreeLLMAPI key.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'companionEngine',
  'Settings UI must expose Companion engine.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'companionLlmProvider',
  'Settings UI must expose Companion LLM provider.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
```

Expected: FAIL because config plumbing is not added.

- [ ] **Step 3: Add read helpers in `ipc-handlers.ts`**

Import `DEFAULT_FREELLMAPI_BASE_URL` from `@shared/constants`.

Add near `getOpenRouterApiKey()`:

```ts
function getFreeLlmApiKey(): string {
  return (getSecureKey('freeLlmApiKey') || process.env.FREELLMAPI_API_KEY || '') as string
}

function getFreeLlmApiBaseUrl(): string {
  const configured = String(configStore.get('freeLlmApiBaseUrl', '') || '').trim()
  return configured || process.env.FREELLMAPI_BASE_URL || DEFAULT_FREELLMAPI_BASE_URL
}
```

- [ ] **Step 4: Return config from `GET_CONFIG`**

In `IPC.GET_CONFIG`, add:

```ts
      freeLlmApiKey: getSecureKey('freeLlmApiKey'),
      freeLlmApiBaseUrl: getFreeLlmApiBaseUrl(),
      companionLlmProvider: modes.companion.llmProvider,
      companionEngine: modes.companion.engine,
      companionRealtimeModel: modes.companion.realtimeModel,
      companionRealtimeVoiceName: modes.companion.realtimeVoiceName,
      companionRealtimeInputTranscription: modes.companion.realtimeInputTranscription,
      companionRealtimeOutputTranscription: modes.companion.realtimeOutputTranscription,
```

- [ ] **Step 5: Allow secure key and config writes**

In `IPC.SET_CONFIG`, change the secure key set to:

```ts
    const secureKeys = new Set(['openrouterApiKey', 'deepgramApiKey', 'freeLlmApiKey'])
```

Add these keys to `ALLOWED_CONFIG_KEYS`:

```ts
      'freeLlmApiKey', 'freeLlmApiBaseUrl',
      'companionLlmProvider', 'companionEngine',
      'companionRealtimeModel', 'companionRealtimeVoiceName',
      'companionRealtimeInputTranscription', 'companionRealtimeOutputTranscription',
```

- [ ] **Step 6: Add Settings state**

In `src/renderer/settings/components/ApiConfig.tsx`, add state:

```tsx
  const [freeLlmApiKey, setFreeLlmApiKey] = useState('')
  const [freeLlmApiBaseUrl, setFreeLlmApiBaseUrl] = useState('http://localhost:3001/v1')
  const [companionLlmProvider, setCompanionLlmProvider] = useState<'openrouter' | 'freellmapi-first'>('openrouter')
  const [companionEngine, setCompanionEngine] = useState<'classic' | 'realtime-beta'>('classic')
  const [companionRealtimeModel, setCompanionRealtimeModel] = useState('auto')
  const [companionRealtimeVoiceName, setCompanionRealtimeVoiceName] = useState('alloy')
  const [companionRealtimeInputTranscription, setCompanionRealtimeInputTranscription] = useState(true)
  const [companionRealtimeOutputTranscription, setCompanionRealtimeOutputTranscription] = useState(true)
```

In `loadConfig`, set those fields:

```tsx
      setFreeLlmApiKey(config.freeLlmApiKey || '')
      setFreeLlmApiBaseUrl(config.freeLlmApiBaseUrl || 'http://localhost:3001/v1')
      setCompanionLlmProvider((config.companionLlmProvider || 'openrouter') as 'openrouter' | 'freellmapi-first')
      setCompanionEngine((config.companionEngine || 'classic') as 'classic' | 'realtime-beta')
      setCompanionRealtimeModel(config.companionRealtimeModel || 'auto')
      setCompanionRealtimeVoiceName(config.companionRealtimeVoiceName || 'alloy')
      setCompanionRealtimeInputTranscription(config.companionRealtimeInputTranscription ?? true)
      setCompanionRealtimeOutputTranscription(config.companionRealtimeOutputTranscription ?? true)
```

In `handleSave`, send:

```tsx
      freeLlmApiKey,
      freeLlmApiBaseUrl,
      companionLlmProvider,
      companionEngine,
      companionRealtimeModel,
      companionRealtimeVoiceName,
      companionRealtimeInputTranscription,
      companionRealtimeOutputTranscription,
```

- [ ] **Step 7: Add compact Settings UI**

In the Settings page near API keys and Mode section, add a `FreeLLMAPI` block with:

```tsx
<div className="border-t border-white/4 pt-5">
  <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
    FreeLLMAPI base URL
  </label>
  <input
    type="text"
    value={freeLlmApiBaseUrl}
    onChange={(e) => setFreeLlmApiBaseUrl(e.target.value)}
    placeholder="http://localhost:3001/v1"
    className={inputClass}
  />
</div>

<div>
  <label className="block text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
    FreeLLMAPI key
  </label>
  <input
    type={showKeys ? 'text' : 'password'}
    value={freeLlmApiKey}
    onChange={(e) => setFreeLlmApiKey(e.target.value)}
    placeholder="freellmapi-..."
    className={inputClass}
  />
</div>
```

In the Companion-only Mode section, add two selects:

```tsx
{agentMode === 'companion' && (
  <div className="border-t border-white/4 pt-4 space-y-4">
    <div>
      <label className="text-[12.5px] text-white/50 block mb-2">Companion LLM</label>
      <select
        value={companionLlmProvider}
        onChange={(e) => setCompanionLlmProvider(e.target.value as 'openrouter' | 'freellmapi-first')}
        className={inputClass}
      >
        <option value="openrouter">OpenRouter only</option>
        <option value="freellmapi-first">FreeLLMAPI first, OpenRouter fallback</option>
      </select>
    </div>

    <div>
      <label className="text-[12.5px] text-white/50 block mb-2">Companion engine</label>
      <select
        value={companionEngine}
        onChange={(e) => setCompanionEngine(e.target.value as 'classic' | 'realtime-beta')}
        className={inputClass}
      >
        <option value="classic">Classic</option>
        <option value="realtime-beta">Realtime Beta</option>
      </select>
    </div>
  </div>
)}
```

Keep existing Voice model UI below this block.

- [ ] **Step 8: Run task checks**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/main/ipc-handlers.ts src/preload/index.ts src/renderer/settings/components/ApiConfig.tsx scripts/check-freellmapi-provider-config.mjs
git commit -m "feat: expose freellmapi companion settings"
```

---

## Task 3: Add OpenAI-Compatible LLM Routing

**Files:**
- Create: `src/main/services/llm-routing.ts`
- Modify: `src/main/services/llm-service.ts`
- Modify: `scripts/check-freellmapi-provider-config.mjs`

- [ ] **Step 1: Extend guardrail for routing**

Append:

```js
assertIncludes(
  'src/main/services/llm-routing.ts',
  'export interface LlmEndpoint',
  'LLM routing endpoint type must exist.'
)

assertIncludes(
  'src/main/services/llm-routing.ts',
  'buildCompanionLlmRouting',
  'Companion routing builder must exist.'
)

assertIncludes(
  'src/main/services/llm-service.ts',
  'LlmRoutingConfig',
  'LLMService must accept routing config.'
)

assertIncludes(
  'src/main/services/llm-service.ts',
  'requestChatCompletion',
  'LLMService must route chat completions through a shared fallback helper.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
```

Expected: FAIL because routing does not exist.

- [ ] **Step 3: Create routing helper**

Create `src/main/services/llm-routing.ts`:

```ts
import {
  DEFAULT_FREELLMAPI_BASE_URL,
  OPENROUTER_BASE_URL,
} from '@shared/constants'
import type { CompanionLlmProvider } from '@shared/types'

export type LlmEndpointId = 'openrouter' | 'freellmapi'

export interface LlmEndpoint {
  id: LlmEndpointId
  label: string
  baseUrl: string
  apiKey: string
  model: string
  headers: Record<string, string>
}

export interface LlmRoutingConfig {
  endpoints: LlmEndpoint[]
}

export interface CompanionLlmRoutingInput {
  provider: CompanionLlmProvider
  openrouterApiKey: string
  freeLlmApiKey: string
  freeLlmApiBaseUrl: string
  model: string
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
    headers: {
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Whisphry',
    },
  }
}

export function freeLlmApiEndpoint(baseUrl: string, apiKey: string, model: string): LlmEndpoint {
  return {
    id: 'freellmapi',
    label: 'FreeLLMAPI',
    baseUrl: normalizeOpenAiBaseUrl(baseUrl, DEFAULT_FREELLMAPI_BASE_URL),
    apiKey,
    model: model || 'auto',
    headers: {},
  }
}

export function buildCompanionLlmRouting(input: CompanionLlmRoutingInput): LlmRoutingConfig {
  const openrouter = input.openrouterApiKey
    ? openRouterEndpoint(input.openrouterApiKey, input.model)
    : null
  const freellmapi = input.freeLlmApiKey
    ? freeLlmApiEndpoint(input.freeLlmApiBaseUrl, input.freeLlmApiKey, input.model)
    : null

  if (input.provider === 'freellmapi-first' && freellmapi) {
    return { endpoints: openrouter ? [freellmapi, openrouter] : [freellmapi] }
  }

  return { endpoints: openrouter ? [openrouter] : [] }
}

export function shouldFallbackAfterStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500
}
```

- [ ] **Step 4: Refactor `LLMService` constructor**

In `src/main/services/llm-service.ts`, replace the OpenRouter constant import with routing imports:

```ts
import {
  type LlmEndpoint,
  type LlmRoutingConfig,
  openRouterEndpoint,
  shouldFallbackAfterStatus,
} from './llm-routing'
```

Replace constructor fields with:

```ts
  private apiKey: string
  private model: string
  private routing: LlmRoutingConfig
```

Replace constructor with:

```ts
  constructor(apiKey: string, model: string, routing?: LlmRoutingConfig) {
    super()
    this.apiKey = apiKey
    this.model = model
    this.routing = routing?.endpoints.length
      ? routing
      : { endpoints: apiKey ? [openRouterEndpoint(apiKey, model)] : [] }
  }
```

Update `setModel`:

```ts
  setModel(model: string): void {
    this.model = model
    this.routing = {
      endpoints: this.routing.endpoints.map((endpoint) => ({
        ...endpoint,
        model,
      })),
    }
  }
```

- [ ] **Step 5: Add shared request helper**

Add this private method before `callOpenRouter`:

```ts
  private async requestChatCompletion(args: {
    body: Record<string, unknown>
    signal?: AbortSignal
    purpose: string
  }): Promise<{ response: Response; endpoint: LlmEndpoint }> {
    if (this.routing.endpoints.length === 0) {
      throw new Error('No LLM provider configured')
    }

    let lastError: Error | null = null
    for (const endpoint of this.routing.endpoints) {
      try {
        const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.apiKey}`,
            'Content-Type': 'application/json',
            ...endpoint.headers,
          },
          body: JSON.stringify({
            ...args.body,
            model: endpoint.model,
          }),
          signal: args.signal,
        })

        if (response.ok) return { response, endpoint }

        const errorText = await response.text()
        const error = new Error(`${endpoint.label} ${args.purpose} error ${response.status}: ${errorText}`)
        lastError = error
        if (!shouldFallbackAfterStatus(response.status)) throw error
        console.warn(`[LLM] ${endpoint.label} failed for ${args.purpose}; trying fallback:`, error.message)
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error
        lastError = error instanceof Error ? error : new Error(String(error))
        console.warn(`[LLM] ${endpoint.label} failed for ${args.purpose}; trying fallback:`, lastError.message)
      }
    }

    throw lastError || new Error(`No LLM provider returned a response for ${args.purpose}`)
  }
```

- [ ] **Step 6: Replace chat fetch sites**

In `callOpenRouter`, replace the `fetch(`${OPENROUTER_BASE_URL}/chat/completions`, ...)` block with:

```ts
      const { response } = await this.requestChatCompletion({
        purpose: 'stream',
        signal: this.abortController!.signal,
        body: {
          messages,
          stream: true,
          temperature,
          max_tokens: maxTokens,
          ...(availableTools.length > 0
            ? {
                tools: availableTools,
                ...(requireToolCall ? { tool_choice: 'required' } : {}),
              }
            : {}),
        },
      })
```

In `callOpenRouterOnce`, replace the fetch block with:

```ts
    const { response } = await this.requestChatCompletion({
      purpose: 'single-shot',
      body: {
        messages,
        stream: false,
        temperature,
        max_tokens: maxTokens,
      },
    })
```

In `runHeartbeat`, replace the fetch block with:

```ts
      const { response } = await this.requestChatCompletion({
        purpose: 'heartbeat',
        signal,
        body: {
          messages,
          stream: true,
          temperature,
          max_tokens: maxTokens,
          stream_options: { include_usage: true },
          ...(iteration === 0 && tools.length > 0 ? { tools } : {}),
        },
      })
```

In `runWorkspaceExecutor`, `cheapTextCompletion`, and `cheapVisionCompletion`, keep OpenRouter-only behavior for now unless the call uses the Companion session service. Add a code comment above each remaining raw OpenRouter call:

```ts
      // Non-companion helper remains OpenRouter-only until provider support is verified for this path.
```

- [ ] **Step 7: Run task checks**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/main/services/llm-routing.ts src/main/services/llm-service.ts scripts/check-freellmapi-provider-config.mjs
git commit -m "feat: add llm routing fallback"
```

---

## Task 4: Wire FreeLLMAPI-First Chat Into Companion Only

**Files:**
- Modify: `src/main/pipelines/companion-pipeline.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `scripts/check-freellmapi-provider-config.mjs`

- [ ] **Step 1: Extend guardrail for Companion-only routing**

Append:

```js
assertIncludes(
  'src/main/pipelines/companion-pipeline.ts',
  'llmRouting: LlmRoutingConfig',
  'CompanionPipeline must accept injected LLM routing.'
)

assertIncludes(
  'src/main/pipelines/companion-pipeline.ts',
  'new LLMService(d.openrouterApiKey, d.defaultModel, d.llmRouting)',
  'CompanionPipeline must construct LLMService with routing config.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'buildCompanionLlmRouting',
  'ipc-handlers must build Companion LLM routing.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'canStartCurrentSessionWithConfiguredProviders',
  'START_SESSION must gate on the selected provider set, not always OpenRouter.'
)

assertIncludes(
  'src/main/pipelines/interview-pipeline.ts',
  'new LLMService(d.openrouterApiKey, d.defaultModel)',
  'InterviewPipeline must remain OpenRouter-only in this phase.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
```

Expected: FAIL because Companion routing is not wired.

- [ ] **Step 3: Inject routing into `CompanionPipeline`**

In `src/main/pipelines/companion-pipeline.ts`, import:

```ts
import type { LlmRoutingConfig } from '../services/llm-routing'
```

Add to `CompanionPipelineDeps`:

```ts
  llmRouting: LlmRoutingConfig
```

Change the LLM construction:

```ts
    store.llmService = new LLMService(d.openrouterApiKey, d.defaultModel, d.llmRouting)
```

- [ ] **Step 4: Build routing in `ipc-handlers.ts`**

Import:

```ts
import { buildCompanionLlmRouting } from './services/llm-routing'
```

Add helper near `readPerSessionInputs`:

```ts
  const buildCurrentCompanionLlmRouting = () => {
    const modes = modeConfig.readModeScopedConfig()
    return buildCompanionLlmRouting({
      provider: modes.companion.llmProvider,
      openrouterApiKey: getOpenRouterApiKey(),
      freeLlmApiKey: getFreeLlmApiKey(),
      freeLlmApiBaseUrl: getFreeLlmApiBaseUrl(),
      model: modes.companion.model || modeConfig.getInterviewModeConfig().defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL,
    })
  }
```

Pass into the companion builder:

```ts
      llmRouting: buildCurrentCompanionLlmRouting(),
```

- [ ] **Step 5: Replace hard OpenRouter session gate**

Add helper before `IPC.START_SESSION`:

```ts
function canStartCurrentSessionWithConfiguredProviders(): { ok: true } | { ok: false; reason: string } {
  const mode = currentAgentMode()
  const modes = modeConfig.readModeScopedConfig()
  const openrouterKey = getOpenRouterApiKey()

  if (mode !== 'companion') {
    return openrouterKey
      ? { ok: true }
      : { ok: false, reason: 'OpenRouter API key not configured' }
  }

  if (modes.companion.engine === 'realtime-beta') {
    if (getFreeLlmApiKey()) return { ok: true }
    if (openrouterKey) return { ok: true }
    return { ok: false, reason: 'FreeLLMAPI or OpenRouter API key not configured' }
  }

  if (modes.companion.llmProvider === 'freellmapi-first' && getFreeLlmApiKey()) {
    return { ok: true }
  }

  return openrouterKey
    ? { ok: true }
    : { ok: false, reason: 'OpenRouter API key not configured' }
}
```

In `IPC.START_SESSION`, replace:

```ts
    if (!openrouterKey) throw new Error('OpenRouter API key not configured')
```

with:

```ts
    const providerGate = canStartCurrentSessionWithConfiguredProviders()
    if (!providerGate.ok) throw new Error(providerGate.reason)
```

- [ ] **Step 6: Run task checks**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
npm run build
```

Expected: Both PASS. Classic Companion should still construct and use `CompanionPipeline`.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/main/pipelines/companion-pipeline.ts src/main/ipc-handlers.ts scripts/check-freellmapi-provider-config.mjs
git commit -m "feat: route companion chat through freellmapi fallback"
```

---

## Task 5: Add FreeLLMAPI TTS Provider

**Files:**
- Create: `src/main/services/local-ai/providers/freellmapi-tts-provider.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/services/local-ai/local-ai-manager.ts`
- Modify: `src/renderer/settings/components/LocalAiSettings.tsx`
- Modify: `scripts/check-freellmapi-provider-config.mjs`

- [ ] **Step 1: Extend guardrail for TTS**

Append:

```js
assertIncludes(
  'src/main/services/local-ai/providers/freellmapi-tts-provider.ts',
  'class FreeLlmApiTtsProvider',
  'FreeLLMAPI TTS provider class must exist.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "case 'freellmapi'",
  'Selected TTS provider switch must route FreeLLMAPI.'
)

assertIncludes(
  'src/main/services/local-ai/local-ai-manager.ts',
  'freellmapiStatus',
  'Local AI manager must report FreeLLMAPI provider status.'
)

assertIncludes(
  'src/renderer/settings/components/LocalAiSettings.tsx',
  'Speech Output',
  'Local AI settings must expose speech output selector.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
```

Expected: FAIL because FreeLLMAPI TTS is not added.

- [ ] **Step 3: Create provider**

Create `src/main/services/local-ai/providers/freellmapi-tts-provider.ts`:

```ts
import { DEFAULT_FREELLMAPI_BASE_URL } from '@shared/constants'
import type { TtsAvailability, TtsChunk, TtsProvider } from './tts-provider'

interface FreeLlmApiTtsProviderDeps {
  getApiKey: () => string
  getBaseUrl: () => string
  getModel: () => string
  getVoice: () => string
}

export class FreeLlmApiTtsProvider implements TtsProvider {
  readonly id = 'freellmapi'
  readonly label = 'FreeLLMAPI speech'
  private abortController: AbortController | null = null

  constructor(private readonly deps: FreeLlmApiTtsProviderDeps) {}

  async isAvailable(): Promise<TtsAvailability> {
    return this.deps.getApiKey()
      ? { ok: true }
      : { ok: false, reason: 'FreeLLMAPI key missing' }
  }

  async speak(text: string, onChunk: (chunk: TtsChunk) => void): Promise<void> {
    const availability = await this.isAvailable()
    if (!availability.ok) throw new Error(availability.reason)

    this.stop()
    this.abortController = new AbortController()
    const baseUrl = normalizeBaseUrl(this.deps.getBaseUrl())
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.deps.getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.deps.getModel() || 'auto',
        input: text,
        voice: this.deps.getVoice() || 'alloy',
        response_format: 'pcm',
      }),
      signal: this.abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`FreeLLMAPI TTS error ${response.status}: ${await response.text()}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) return
    onChunk({
      sampleRate: 24000,
      channels: 1,
      pcmBase64: buffer.toString('base64'),
    })
  }

  stop(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}

function normalizeBaseUrl(value: string): string {
  return (String(value || '').trim() || DEFAULT_FREELLMAPI_BASE_URL).replace(/\/+$/, '')
}
```

- [ ] **Step 4: Wire provider selection**

In `src/main/ipc-handlers.ts`, import:

```ts
import { FreeLlmApiTtsProvider } from './services/local-ai/providers/freellmapi-tts-provider'
```

Change:

```ts
const LOCAL_AI_TTS_PROVIDERS: TtsProviderId[] = ['deepgram', 'system', 'disabled']
```

to:

```ts
const LOCAL_AI_TTS_PROVIDERS: TtsProviderId[] = ['deepgram', 'system', 'freellmapi', 'disabled']
```

Add case in `getSelectedAnswerTtsProvider()`:

```ts
    case 'freellmapi':
      return new FreeLlmApiTtsProvider({
        getApiKey: getFreeLlmApiKey,
        getBaseUrl: getFreeLlmApiBaseUrl,
        getModel: () => modeConfig.getCompanionModeConfig().realtimeModel || 'auto',
        getVoice: () => modeConfig.getCompanionModeConfig().realtimeVoiceName || 'alloy',
      })
```

- [ ] **Step 5: Add Local AI provider status**

In `src/main/services/local-ai/local-ai-manager.ts`, add `hasFreeLlmApiKey?: () => boolean` to `LocalAiManagerDeps`.

Add FreeLLMAPI status to `providers`:

```ts
        this.withDiagnostics(this.freellmapiStatus(config)),
```

Add method:

```ts
  private freellmapiStatus(config: LocalAiConfig): LocalAiProviderStatus {
    if (config.mode === 'off') {
      return {
        id: 'freellmapi',
        label: 'FreeLLMAPI speech',
        availability: 'disabled',
        installState: 'not-installed',
      }
    }

    if (this.deps.hasFreeLlmApiKey?.()) {
      return {
        id: 'freellmapi',
        label: 'FreeLLMAPI speech',
        availability: 'available',
        installState: 'not-installed',
      }
    }

    return {
      id: 'freellmapi',
      label: 'FreeLLMAPI speech',
      availability: 'failed',
      installState: 'not-installed',
      lastError: 'FreeLLMAPI key missing',
    }
  }
```

In `getLocalAiManager()` deps, pass:

```ts
      hasFreeLlmApiKey: () => Boolean(getFreeLlmApiKey()),
```

- [ ] **Step 6: Add Speech Output UI**

In `src/renderer/settings/components/LocalAiSettings.tsx`, import `TtsProviderId`.

Add provider options near `sttProviders`:

```tsx
const ttsProviders: Array<{ value: TtsProviderId; label: string }> = [
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'freellmapi', label: 'FreeLLMAPI' },
  { value: 'system', label: 'System voice' },
  { value: 'disabled', label: 'Disabled' },
]
```

Add a `Speech Output` select next to `Speech Input`:

```tsx
<div>
  <label className="block text-[11px] font-medium text-white/38 mb-2 uppercase">
    Speech Output
  </label>
  <select
    value={config?.ttsProvider ?? 'deepgram'}
    disabled={!config || pending}
    onChange={(e) => void updateConfig({ ttsProvider: e.target.value as TtsProviderId })}
    className="input-premium w-full rounded-xl bg-white/[0.025] border border-white/6 px-3 py-2.5 text-[12.5px] text-white/75 focus:border-cyan-500/25 focus:outline-none transition-all disabled:opacity-45"
  >
    {ttsProviders.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 7: Run task checks**

Run:

```bash
node scripts/check-freellmapi-provider-config.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/main/services/local-ai/providers/freellmapi-tts-provider.ts src/main/ipc-handlers.ts src/main/services/local-ai/local-ai-manager.ts src/renderer/settings/components/LocalAiSettings.tsx scripts/check-freellmapi-provider-config.mjs
git commit -m "feat: add freellmapi tts provider"
```

---

## Task 6: Add Realtime Message Utilities And Client

**Files:**
- Create: `src/main/services/realtime/realtime-message-utils.ts`
- Create: `src/main/services/realtime/freellmapi-realtime-client.ts`
- Create: `scripts/check-companion-realtime-pipeline.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing realtime guardrail**

Create `scripts/check-companion-realtime-pipeline.mjs`:

```js
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(path, needle, message) {
  const text = read(path)
  if (!text.includes(needle)) {
    throw new Error(`${message}\nMissing in ${path}: ${needle}`)
  }
}

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'createRealtimeAudioInputMessage',
  'Realtime message helper must build audio input messages.'
)

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'summarizeRealtimeServerMessage',
  'Realtime message helper must summarize server events.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'class FreeLlmApiRealtimeClient',
  'FreeLLMAPI realtime client must exist.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  '/realtime/sessions',
  'Realtime client must mint FreeLLMAPI realtime sessions.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'sendAudioChunk',
  'Realtime client must expose audio chunk sending.'
)

assertIncludes(
  'package.json',
  'check:companion-realtime',
  'package.json must expose realtime guardrail.'
)

console.log('check-companion-realtime-pipeline: ok')
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
```

Expected: FAIL because realtime client files do not exist.

- [ ] **Step 3: Add realtime message utils**

Create `src/main/services/realtime/realtime-message-utils.ts`:

```ts
export interface RealtimeAudioChunk {
  data: string
  mimeType: string
}

export interface RealtimeServerMessageSummary {
  text: string
  inputTranscription?: string
  outputTranscription?: string
  audioChunks: RealtimeAudioChunk[]
  interrupted: boolean
  turnComplete: boolean
  setupComplete: boolean
  usage?: Record<string, unknown>
}

export function createRealtimeSetupMessage(options: {
  model: string
  responseModalities: Array<'AUDIO' | 'TEXT'>
  instructions?: string
  inputAudioTranscription?: boolean
  outputAudioTranscription?: boolean
  temperature?: number
}): Record<string, unknown> {
  const setup: Record<string, unknown> = {
    model: options.model.startsWith('models/') ? options.model : `models/${options.model}`,
    generationConfig: {
      responseModalities: options.responseModalities,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    },
  }

  if (options.instructions) {
    setup.systemInstruction = { parts: [{ text: options.instructions }] }
  }
  if (options.inputAudioTranscription) setup.inputAudioTranscription = {}
  if (options.outputAudioTranscription) setup.outputAudioTranscription = {}

  return { setup }
}

export function createRealtimeAudioInputMessage(data: string, sampleRate = 16000): Record<string, unknown> {
  return {
    realtimeInput: {
      mediaChunks: [{
        data,
        mimeType: `audio/pcm;rate=${sampleRate}`,
      }],
    },
  }
}

export function createRealtimeAudioStreamEndMessage(): Record<string, unknown> {
  return {
    realtimeInput: {
      audioStreamEnd: true,
    },
  }
}

export function summarizeRealtimeServerMessage(message: unknown): RealtimeServerMessageSummary {
  const root = asRecord(message)
  const serverContent = asRecord(root.serverContent ?? root.server_content)
  const modelTurn = asRecord(serverContent.modelTurn ?? serverContent.model_turn)
  const parts = Array.isArray(modelTurn.parts) ? modelTurn.parts : []
  const audioChunks: RealtimeAudioChunk[] = []
  const textParts: string[] = []

  for (const rawPart of parts) {
    const part = asRecord(rawPart)
    if (typeof part.text === 'string' && part.text) textParts.push(part.text)
    const inlineData = asRecord(part.inlineData ?? part.inline_data)
    if (typeof inlineData.data === 'string' && inlineData.data) {
      audioChunks.push({
        data: inlineData.data,
        mimeType: typeof inlineData.mimeType === 'string'
          ? inlineData.mimeType
          : typeof inlineData.mime_type === 'string'
            ? inlineData.mime_type
            : 'audio/pcm;rate=24000',
      })
    }
  }

  const usage = asRecord(root.usageMetadata ?? root.usage_metadata)
  return {
    text: textParts.join('\n'),
    inputTranscription: readNestedText(serverContent.inputTranscription ?? serverContent.input_transcription),
    outputTranscription: readNestedText(serverContent.outputTranscription ?? serverContent.output_transcription),
    audioChunks,
    interrupted: Boolean(serverContent.interrupted),
    turnComplete: Boolean(serverContent.turnComplete ?? serverContent.turn_complete),
    setupComplete: Boolean(root.setupComplete ?? root.setup_complete),
    usage: Object.keys(usage).length > 0 ? usage : undefined,
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function readNestedText(value: unknown): string | undefined {
  const record = asRecord(value)
  const text = record.text
  if (typeof text === 'string' && text.trim()) return text.trim()
  const parts = Array.isArray(record.parts) ? record.parts : []
  const joined = parts
    .map((part) => asRecord(part).text)
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim()
  return joined || undefined
}
```

- [ ] **Step 4: Add FreeLLMAPI realtime client**

Create `src/main/services/realtime/freellmapi-realtime-client.ts`:

```ts
import { EventEmitter } from 'events'
import { DEFAULT_FREELLMAPI_BASE_URL } from '@shared/constants'
import {
  createRealtimeAudioInputMessage,
  createRealtimeAudioStreamEndMessage,
  createRealtimeSetupMessage,
  summarizeRealtimeServerMessage,
  type RealtimeAudioChunk,
} from './realtime-message-utils'

export type FreeLlmApiRealtimeClientEvent =
  | { type: 'status'; status: 'connecting' | 'live' | 'failed' | 'stopped' }
  | { type: 'audio'; chunk: RealtimeAudioChunk }
  | { type: 'input-transcript'; text: string }
  | { type: 'output-transcript'; text: string }
  | { type: 'text'; text: string }
  | { type: 'turn-complete' }
  | { type: 'error'; error: Error }

export interface FreeLlmApiRealtimeClientOptions {
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  instructions?: string
  inputAudioTranscription: boolean
  outputAudioTranscription: boolean
}

interface RealtimeSessionResponse {
  id: string
  provider: string
  model: string
  connect_url: string
  config: {
    response_modalities: Array<'AUDIO' | 'TEXT'>
    input_audio_transcription?: boolean
    output_audio_transcription?: boolean
    instructions?: string
    temperature?: number
  }
}

export class FreeLlmApiRealtimeClient extends EventEmitter {
  private socket: WebSocket | null = null
  private connected = false

  constructor(private readonly options: FreeLlmApiRealtimeClientOptions) {
    super()
  }

  async connect(): Promise<void> {
    this.emitEvent({ type: 'status', status: 'connecting' })
    const session = await this.mintSession()
    await this.openSocket(session)
  }

  sendAudioChunk(chunk: Buffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(createRealtimeAudioInputMessage(chunk.toString('base64'), 16000)))
  }

  endAudioStream(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(createRealtimeAudioStreamEndMessage()))
  }

  stop(): void {
    this.connected = false
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close()
    }
    this.socket = null
    this.emitEvent({ type: 'status', status: 'stopped' })
  }

  private async mintSession(): Promise<RealtimeSessionResponse> {
    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/realtime/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model || 'auto',
        instructions: this.options.instructions || undefined,
        voice: this.options.voice || 'alloy',
        response_modalities: ['AUDIO'],
        input_audio_transcription: this.options.inputAudioTranscription,
        output_audio_transcription: this.options.outputAudioTranscription,
      }),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(body?.error?.message || `FreeLLMAPI realtime session error ${response.status}`)
    }
    return body as RealtimeSessionResponse
  }

  private openSocket(session: RealtimeSessionResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(session.connect_url)
      this.socket = socket
      socket.binaryType = 'arraybuffer'

      socket.onopen = () => {
        socket.send(JSON.stringify(createRealtimeSetupMessage({
          model: session.model,
          responseModalities: session.config.response_modalities,
          instructions: session.config.instructions || this.options.instructions,
          inputAudioTranscription: session.config.input_audio_transcription,
          outputAudioTranscription: session.config.output_audio_transcription,
          temperature: session.config.temperature,
        })))
      }

      socket.onmessage = async (event) => {
        try {
          const text = await decodeSocketData(event.data)
          const summary = summarizeRealtimeServerMessage(JSON.parse(text))
          if (summary.setupComplete && !this.connected) {
            this.connected = true
            this.emitEvent({ type: 'status', status: 'live' })
            resolve()
          }
          if (summary.inputTranscription) this.emitEvent({ type: 'input-transcript', text: summary.inputTranscription })
          if (summary.outputTranscription) this.emitEvent({ type: 'output-transcript', text: summary.outputTranscription })
          if (summary.text) this.emitEvent({ type: 'text', text: summary.text })
          for (const chunk of summary.audioChunks) this.emitEvent({ type: 'audio', chunk })
          if (summary.turnComplete) this.emitEvent({ type: 'turn-complete' })
        } catch (error: any) {
          this.emitEvent({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
        }
      }

      socket.onerror = () => {
        const error = new Error('Realtime WebSocket error')
        this.emitEvent({ type: 'status', status: 'failed' })
        this.emitEvent({ type: 'error', error })
        if (!this.connected) reject(error)
      }

      socket.onclose = () => {
        if (this.connected) this.emitEvent({ type: 'status', status: 'stopped' })
        this.connected = false
        this.socket = null
      }
    })
  }

  private emitEvent(event: FreeLlmApiRealtimeClientEvent): void {
    this.emit('event', event)
  }
}

function normalizeBaseUrl(value: string): string {
  return (String(value || '').trim() || DEFAULT_FREELLMAPI_BASE_URL).replace(/\/+$/, '')
}

async function decodeSocketData(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  }
  if (data && typeof data === 'object' && 'arrayBuffer' in data) {
    const blob = data as { arrayBuffer: () => Promise<ArrayBuffer> }
    return Buffer.from(await blob.arrayBuffer()).toString('utf8')
  }
  return String(data ?? '')
}
```

- [ ] **Step 5: Wire package script**

In `package.json`, add:

```json
"check:companion-realtime": "node scripts/check-companion-realtime-pipeline.mjs",
```

Add it to `check:release` before `npm run build`.

- [ ] **Step 6: Run task checks**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add src/main/services/realtime/realtime-message-utils.ts src/main/services/realtime/freellmapi-realtime-client.ts scripts/check-companion-realtime-pipeline.mjs package.json
git commit -m "feat: add freellmapi realtime client"
```

---

## Task 7: Add CompanionRealtimePipeline Skeleton And Selection

**Files:**
- Create: `src/main/pipelines/companion-realtime-pipeline.ts`
- Modify: `src/main/pipelines/index.ts`
- Modify: `src/main/pipelines/pipeline.ts`
- Modify: `src/main/services/session-runtime-store.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `scripts/check-companion-realtime-pipeline.mjs`

- [ ] **Step 1: Extend realtime guardrail**

Append:

```js
assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'export class CompanionRealtimePipeline',
  'Dedicated realtime pipeline class must exist.'
)

assertIncludes(
  'src/main/pipelines/index.ts',
  'companionRealtime?',
  'Pipeline builders must expose a realtime Companion builder.'
)

assertIncludes(
  'src/main/pipelines/index.ts',
  "companionEngine: () => 'classic' | 'realtime-beta'",
  'Pipeline factory must choose Companion engine through an injected getter.'
)

assertIncludes(
  'src/main/pipelines/index.ts',
  'new CompanionRealtimePipeline',
  'Pipeline factory must instantiate realtime pipeline when selected.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'companionRealtime: () =>',
  'ipc-handlers must register realtime pipeline deps.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
```

Expected: FAIL because realtime pipeline is not added.

- [ ] **Step 3: Extend pipeline state**

In `src/main/pipelines/pipeline.ts`, update `PipelineState`:

```ts
  companionRealtimeStatus?: CompanionRealtimeStatus
```

Import `CompanionRealtimeStatus` from `@shared/types`.

- [ ] **Step 4: Add store slot**

In `src/main/services/session-runtime-store.ts`, add:

```ts
  companionRealtimeStatus: CompanionRealtimeStatus = 'off'
```

Import `CompanionRealtimeStatus` from `@shared/types`.

- [ ] **Step 5: Create realtime pipeline skeleton**

Create `src/main/pipelines/companion-realtime-pipeline.ts`:

```ts
import type {
  AgentMode,
  AgentPresenceState,
  AppConfig,
  CompanionRealtimeStatus,
  TranscriptEntry,
} from '@shared/types'
import type { AudioCaptureService } from '../audio/capture'
import type { SessionRuntimeStore } from '../services/session-runtime-store'
import {
  FreeLlmApiRealtimeClient,
  type FreeLlmApiRealtimeClientEvent,
  type FreeLlmApiRealtimeClientOptions,
} from '../services/realtime/freellmapi-realtime-client'
import {
  BasePipeline,
  type PipelineStartContext,
  type PipelineState,
  type PipelineStopReason,
} from './pipeline'

export interface CompanionRealtimePipelineDeps {
  clientOptions: () => FreeLlmApiRealtimeClientOptions
  audioCapture: AudioCaptureService
  sessionRuntimeStore: SessionRuntimeStore
  onTranscript: (entry: TranscriptEntry) => void
  emitVoiceAudioChunk: (payload: { pcmBase64: string; mimeType: string }) => void
  emitVoiceAudioEnd: () => void
  setPresenceState: (state: AgentPresenceState) => void
  onRealtimeStatus: (status: CompanionRealtimeStatus) => void
  onRealtimeError: (error: Error) => void
}

export class CompanionRealtimePipeline extends BasePipeline {
  readonly mode: AgentMode = 'companion'
  private client: FreeLlmApiRealtimeClient | null = null
  private presence: AgentPresenceState = 'idle'
  private busy = false
  private realtimeStatus: CompanionRealtimeStatus = 'off'

  constructor(private readonly deps: CompanionRealtimePipelineDeps) {
    super()
  }

  async start(_ctx: PipelineStartContext): Promise<void> {
    this.setRealtimeStatus('connecting')
    this.presence = 'thinking'
    this.deps.setPresenceState('thinking')
    this.client = new FreeLlmApiRealtimeClient(this.deps.clientOptions())
    this.client.on('event', (event: FreeLlmApiRealtimeClientEvent) => this.handleClientEvent(event))
    await this.client.connect()
    this.deps.audioCapture.removeAllListeners('audio-data')
    this.deps.audioCapture.on('audio-data', ({ source, chunk }: { source: 'interviewer' | 'user'; chunk: Buffer }) => {
      if (source === 'user') this.client?.sendAudioChunk(chunk)
    })
    this.deps.audioCapture.startCapture()
    this.presence = 'listening'
    this.deps.setPresenceState('listening')
  }

  async stop(_reason: PipelineStopReason): Promise<void> {
    this.deps.audioCapture.stopCapture()
    this.deps.audioCapture.removeAllListeners('audio-data')
    this.client?.endAudioStream()
    this.client?.stop()
    this.client = null
    this.deps.emitVoiceAudioEnd()
    this.presence = 'idle'
    this.busy = false
    this.setRealtimeStatus('stopped')
    this.deps.setPresenceState('idle')
  }

  override onSettingsChanged(_diff: Partial<AppConfig>): void {}

  getState(): PipelineState {
    return {
      mode: this.mode,
      presence: this.presence,
      busy: this.busy,
      companionRealtimeStatus: this.realtimeStatus,
    }
  }

  private handleClientEvent(event: FreeLlmApiRealtimeClientEvent): void {
    switch (event.type) {
      case 'status':
        this.setRealtimeStatus(event.status)
        if (event.status === 'live') {
          this.presence = 'listening'
          this.deps.setPresenceState('listening')
        }
        break
      case 'audio':
        this.presence = 'speaking'
        this.deps.setPresenceState('speaking')
        this.deps.emitVoiceAudioChunk({
          pcmBase64: event.chunk.data,
          mimeType: event.chunk.mimeType,
        })
        break
      case 'error':
        this.setRealtimeStatus('failed')
        this.deps.onRealtimeError(event.error)
        break
    }
  }

  private setRealtimeStatus(status: CompanionRealtimeStatus): void {
    this.realtimeStatus = status
    this.deps.sessionRuntimeStore.companionRealtimeStatus = status
    this.deps.onRealtimeStatus(status)
  }
}
```

- [ ] **Step 6: Wire factory selection**

In `src/main/pipelines/index.ts`, import `CompanionRealtimePipeline` and its deps.

Update `PipelineBuilders`:

```ts
  companionEngine: () => 'classic' | 'realtime-beta'
  companionRealtime?: () => CompanionRealtimePipelineDeps
```

Update factory companion branch:

```ts
  if (mode === 'companion') {
    if (activeBuilders.companionEngine?.() === 'realtime-beta' && activeBuilders.companionRealtime) {
      return new CompanionRealtimePipeline(activeBuilders.companionRealtime())
    }
    if (activeBuilders.companion) {
      return new CompanionPipeline(activeBuilders.companion())
    }
  }
```

- [ ] **Step 7: Register deps in `ipc-handlers.ts`**

Add builder registration:

```ts
    companionEngine: () => modeConfig.getCompanionModeConfig().engine,
    companionRealtime: () => ({
      clientOptions: () => {
        const companion = modeConfig.getCompanionModeConfig()
        return {
          baseUrl: getFreeLlmApiBaseUrl(),
          apiKey: getFreeLlmApiKey(),
          model: companion.realtimeModel || 'auto',
          voice: companion.realtimeVoiceName || 'alloy',
          instructions: buildRealtimeCompanionInstructions(),
          inputAudioTranscription: companion.realtimeInputTranscription,
          outputAudioTranscription: companion.realtimeOutputTranscription,
        }
      },
      audioCapture,
      sessionRuntimeStore,
      onTranscript: handleTranscriptEntry,
      emitVoiceAudioChunk: (payload) => {
        sendToCanvas('voice:audio-chunk', payload)
        sendToOverlay('voice:audio-chunk', payload)
      },
      emitVoiceAudioEnd: () => {
        sendToCanvas('voice:audio-end')
        sendToOverlay('voice:audio-end')
        sendToAnswer('voice:audio-end')
      },
      setPresenceState: (state) => heartbeatService.setPresenceState(state),
      onRealtimeStatus: () => broadcastSessionState(),
      onRealtimeError: (error) => console.warn('[CompanionRealtime] error:', error),
    }),
```

Add helper:

```ts
function buildRealtimeCompanionInstructions(): string {
  const profile = contextManager.getProfile()
  const session = contextManager.getSessionContext()
  return [
    'You are Whisphry in Companion Realtime Beta.',
    'Keep replies concise and conversational.',
    profile.name ? `User name: ${profile.name}.` : '',
    session.subject ? `Session subject: ${session.subject}.` : '',
    session.sessionNotes ? `Guidance notes: ${session.sessionNotes}.` : '',
  ].filter(Boolean).join('\n')
}
```

- [ ] **Step 8: Run task checks**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 9: Commit Task 7**

Run:

```bash
git add src/main/pipelines/companion-realtime-pipeline.ts src/main/pipelines/index.ts src/main/pipelines/pipeline.ts src/main/services/session-runtime-store.ts src/main/ipc-handlers.ts scripts/check-companion-realtime-pipeline.mjs
git commit -m "feat: add companion realtime pipeline"
```

---

## Task 8: Persist Realtime Transcripts And Broadcast Status

**Files:**
- Modify: `src/main/pipelines/companion-realtime-pipeline.ts`
- Modify: `src/main/services/session-state-service.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/renderer/overlay/App.tsx`
- Modify: `src/renderer/overlay/components/Controls.tsx`
- Modify: `src/renderer/canvas/components/ControlBar.tsx`
- Modify: `scripts/check-companion-realtime-pipeline.mjs`

- [ ] **Step 1: Extend guardrail for transcript/status behavior**

Append:

```js
assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "source: 'stt'",
  'Realtime transcripts must use normal transcript source semantics.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "audioSource: 'microphone'",
  'Realtime input transcript must be tagged as microphone audio.'
)

assertIncludes(
  'src/main/services/session-state-service.ts',
  'companionRealtimeStatus',
  'Session state service must broadcast realtime status.'
)

assertIncludes(
  'src/renderer/overlay/App.tsx',
  'companionRealtimeStatus',
  'Overlay must receive realtime status.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
```

Expected: FAIL because transcript/status UI is incomplete.

- [ ] **Step 3: Handle realtime transcript events**

In `CompanionRealtimePipeline.handleClientEvent`, add cases:

```ts
      case 'input-transcript':
        this.deps.onTranscript({
          id: `rt-user-${Date.now()}`,
          text: event.text,
          speaker: 'user',
          timestamp: Date.now(),
          isFinal: true,
          source: 'stt',
          audioSource: 'microphone',
        })
        break
      case 'output-transcript':
      case 'text':
        this.deps.onTranscript({
          id: `rt-agent-${Date.now()}`,
          text: event.text,
          speaker: 'unknown',
          timestamp: Date.now(),
          isFinal: true,
          source: 'stt',
          audioSource: 'chat',
        })
        break
      case 'turn-complete':
        this.presence = 'listening'
        this.deps.setPresenceState('listening')
        this.deps.emitVoiceAudioEnd()
        break
```

- [ ] **Step 4: Broadcast realtime status**

In `src/main/services/session-state-service.ts`, add `companionRealtimeStatus?: CompanionRealtimeStatus` to `BroadcastSessionStateOptions` and the `publishSessionState` object type. Import `CompanionRealtimeStatus`.

In `broadcastSessionState`, include:

```ts
      companionRealtimeStatus: options.companionRealtimeStatus,
```

In `src/main/ipc-handlers.ts`, pass:

```ts
    companionEngine: modeConfig.getCompanionModeConfig().engine,
    companionRealtimeStatus: sessionRuntimeStore.companionRealtimeStatus,
```

to both direct session-state object creation and `sessionStateService.broadcastSessionState`.

- [ ] **Step 5: Display compact status**

In `src/renderer/overlay/App.tsx`, add state:

```tsx
  const [companionRealtimeStatus, setCompanionRealtimeStatus] = useState<'off' | 'connecting' | 'live' | 'failed' | 'stopped'>('off')
```

In the session-state listener:

```tsx
    if (typeof state.companionRealtimeStatus === 'string') {
      setCompanionRealtimeStatus(state.companionRealtimeStatus)
    }
```

Pass it to `Controls`.

In `Controls.tsx`, add prop:

```ts
  companionRealtimeStatus: 'off' | 'connecting' | 'live' | 'failed' | 'stopped'
```

Render a small status chip only when status is not `off`:

```tsx
{companionRealtimeStatus !== 'off' && (
  <span className="rounded-md border border-white/6 bg-white/4 px-2 py-1 text-[10px] text-white/45">
    Realtime {companionRealtimeStatus}
  </span>
)}
```

- [ ] **Step 6: Run task checks**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 7: Commit Task 8**

Run:

```bash
git add src/main/pipelines/companion-realtime-pipeline.ts src/main/services/session-state-service.ts src/main/ipc-handlers.ts src/renderer/overlay/App.tsx src/renderer/overlay/components/Controls.tsx src/renderer/canvas/components/ControlBar.tsx scripts/check-companion-realtime-pipeline.mjs
git commit -m "feat: persist realtime companion status"
```

---

## Task 9: Realtime Start Fallback And Stop Cleanup

**Files:**
- Modify: `src/main/pipelines/mode-router.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `scripts/check-companion-realtime-pipeline.mjs`

- [ ] **Step 1: Extend guardrail for fallback boundary**

Append:

```js
assertIncludes(
  'src/main/ipc-handlers.ts',
  'startClassicCompanionFallbackAfterRealtimeStartFailure',
  'Realtime pre-connect failure must have an explicit Classic fallback path.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'realtime failure after connect does not auto-switch',
  'Post-connect realtime failure must not silently switch to Classic.'
)
```

- [ ] **Step 2: Run guardrail to verify failure**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
```

Expected: FAIL because fallback path is not explicit.

- [ ] **Step 3: Add fallback helper**

In `src/main/ipc-handlers.ts`, add:

```ts
async function startClassicCompanionFallbackAfterRealtimeStartFailure(
  sessionCtx: SessionContext | undefined,
  error: Error
): Promise<boolean> {
  const modes = modeConfig.readModeScopedConfig()
  if (currentAgentMode() !== 'companion') return false
  if (modes.companion.engine !== 'realtime-beta') return false
  if (!getOpenRouterApiKey()) return false

  console.warn('[CompanionRealtime] start failed before connect; falling back to Classic Companion:', error.message)
  const nextModes = modeConfig.readModeScopedConfig()
  nextModes.companion.engine = 'classic'
  modeConfig.writeModeScopedConfig(nextModes)
  await getModeRouter().startSession('companion', sessionCtx ?? ({} as SessionContext))
  return true
}
```

- [ ] **Step 4: Wrap router start**

In `IPC.START_SESSION`, replace:

```ts
    await router.startSession(currentAgentMode(), sessionCtx ?? ({} as SessionContext))
```

with:

```ts
    try {
      await router.startSession(currentAgentMode(), sessionCtx ?? ({} as SessionContext))
    } catch (error: any) {
      const err = error instanceof Error ? error : new Error(String(error))
      const fellBack = await startClassicCompanionFallbackAfterRealtimeStartFailure(sessionCtx, err)
      if (!fellBack) throw err
    }
```

Add this comment in `CompanionRealtimePipeline.handleClientEvent` error case:

```ts
        // realtime failure after connect does not auto-switch; the session stops or the user restarts in Classic.
```

- [ ] **Step 5: Run task checks**

Run:

```bash
node scripts/check-companion-realtime-pipeline.mjs
npm run build
```

Expected: Both PASS.

- [ ] **Step 6: Commit Task 9**

Run:

```bash
git add src/main/ipc-handlers.ts src/main/pipelines/companion-realtime-pipeline.ts scripts/check-companion-realtime-pipeline.mjs
git commit -m "feat: add realtime companion fallback boundary"
```

---

## Task 10: Final Release Guardrails And Manual Smoke

**Files:**
- Modify: `package.json`
- Read/run: all guardrails.

- [ ] **Step 1: Ensure release check includes new scripts**

In `package.json`, `check:release` must include:

```bash
npm run check:freellmapi-provider && npm run check:companion-realtime
```

before `npm run build`.

- [ ] **Step 2: Run targeted guardrails**

Run:

```bash
npm run check:freellmapi-provider
npm run check:companion-realtime
npm run check:mode-isolation
npm run check:local-ai
npm run check:companion-turn-boundaries
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run release guardrail**

Run:

```bash
npm run check:release
```

Expected: PASS.

- [ ] **Step 4: Manual smoke: Classic Companion**

Run the app through the existing dev workflow:

```bash
npm run dev
```

Manual checks:

- Settings defaults to Companion engine `Classic`.
- Existing OpenRouter-only Companion starts with no FreeLLMAPI configured.
- Deepgram STT starts normally when selected.
- Companion bubbles and optional voice still work.
- Stopping the session closes audio capture and speech output.

- [ ] **Step 5: Manual smoke: FreeLLMAPI-first chat**

With FreeLLMAPI running at `http://localhost:3001/v1`:

- Configure FreeLLMAPI key and base URL.
- Set Companion LLM to `FreeLLMAPI first, OpenRouter fallback`.
- Start Classic Companion.
- Confirm FreeLLMAPI dashboard logs show `/v1/chat/completions`.
- Stop FreeLLMAPI and confirm OpenRouter fallback produces a response when OpenRouter key is configured.

- [ ] **Step 6: Manual smoke: FreeLLMAPI TTS**

- Set Local AI Speech Output to `FreeLLMAPI`.
- Enable Companion voice.
- Trigger a Companion reply.
- Confirm audio plays.
- Confirm `LOCAL_AI_TEST_TTS` reports success or a clear FreeLLMAPI error.

- [ ] **Step 7: Manual smoke: Realtime Beta**

- Set Companion engine to `Realtime Beta`.
- Start Companion.
- Confirm status reaches `Realtime live`.
- Speak into microphone.
- Confirm user transcript appears.
- Confirm model audio plays through existing canvas/overlay audio playback.
- Stop the session.
- Confirm WebSocket closes, audio capture stops, and `voice:audio-end` fires.

- [ ] **Step 8: Commit final release wiring**

Run:

```bash
git add package.json
git commit -m "chore: include freellmapi realtime checks"
```

If `package.json` was already committed with the release script in earlier tasks, skip this commit and record that no final release-wiring diff remained.

---

## Execution Notes

- Stage only files named in the current task. The worktree had unrelated changes before this plan.
- After each task, run the listed checks before committing.
- Do not change `AgentMode` values.
- Do not remove current OpenRouter, Deepgram STT, or Deepgram TTS code paths.
- Do not make Realtime Beta the default.
- Do not update the approved design spec unless the user changes the architecture.

## Self-Review

Spec coverage:

- FreeLLMAPI primary chat with OpenRouter fallback is implemented by Tasks 1-4.
- FreeLLMAPI TTS provider is implemented by Task 5.
- Dedicated Companion Realtime Beta pipeline is implemented by Tasks 6-9.
- Classic Companion default and non-breaking rollout are enforced by Tasks 1, 4, 7, 9, and 10.
- Guardrail checks are added in Tasks 1 and 6 and included in release checks in Tasks 1, 6, and 10.

Ambiguity resolved:

- Realtime Beta is an engine setting inside Companion, not a top-level `AgentMode`.
- FreeLLMAPI chat and realtime are independently configurable.
- Interview remains OpenRouter-only in this implementation.
- Post-connect realtime failure does not silently fall back mid-turn.
