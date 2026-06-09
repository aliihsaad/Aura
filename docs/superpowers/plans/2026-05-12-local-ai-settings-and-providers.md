# Local AI Settings And Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Checkpoint note:** the repository may already contain the Detail window upgrade checkpoint. Start from a clean `main` and make small commits after each task.

**Goal:** Add a user-controllable Local AI settings section and provider architecture so capable machines can use local vision/TTS while low-end machines can keep those features disabled.

**Architecture:** Treat local AI as optional providers behind stable interfaces. Settings persists user intent (`off`, `auto`, `local-first`, `cloud-first`) separately from runtime capability (`available`, `installable`, `unsupported`, `failed`). MiniCPM-V is a local vision cortex provider, local TTS providers sit beside Deepgram Aura, and Deepgram remains the default STT backend unless the user explicitly chooses a local fallback.

**Tech Stack:** Electron 41, React 19, TypeScript, electron-store, existing Settings window, existing Deepgram STT/TTS services, future OpenVINO GenAI / ONNX Runtime / model-pack executables.

**Sources checked on 2026-05-12:**
- MiniCPM-V 2.6 model card: https://huggingface.co/openbmb/MiniCPM-V-2_6
- MiniCPM-V 2.6 INT4 model card: https://huggingface.co/openbmb/MiniCPM-V-2_6-int4
- OpenVINO VLM docs: https://openvinotoolkit.github.io/openvino.genai/docs/use-cases/image-processing/
- OpenVINO install docs: https://openvinotoolkit.github.io/openvino.genai/docs/getting-started/installation/
- Piper repository status: https://github.com/rhasspy/piper
- Kokoro-82M model card: https://huggingface.co/hexgrad/Kokoro-82M
- whisper.cpp repository: https://github.com/ggerganov/whisper.cpp

---

## Product Decisions

1. **Local AI defaults to safe.** The default is `auto`, but no large local model is downloaded or loaded until the user installs a model pack.
2. **Weak machines stay protected.** `off` disables hardware probes, model loading, and background local inference. `auto` refuses MiniCPM-V when available RAM/VRAM is below the minimum.
3. **Deepgram remains default STT.** Vault memory `vm_8OhjkCcU2DlQDuMo` explicitly rejects replacing Deepgram with local Whisper as the default. `whisper.cpp` may be offered only as fallback/privacy mode after separate benchmarking.
4. **Local TTS can ship before local vision.** Piper/Kokoro are smaller than MiniCPM-V and can reduce Deepgram TTS dependency without changing STT.
5. **Installer stays lean.** The base installer ships no 4-8GB model weights. It ships only provider code and a model-pack manager. Model packs are downloaded after install.
6. **The cloud route never disappears.** If a local provider fails, Whisphry falls back to current cloud behavior unless the user explicitly selects `Local only`.

---

## File Structure

**New files:**
- `src/shared/local-ai-types.ts` - serializable config, provider status, diagnostics DTOs.
- `src/main/services/local-ai/local-ai-config-service.ts` - reads/writes local AI config through `electron-store`.
- `src/main/services/local-ai/hardware-profile.ts` - collects OS, CPU, RAM, GPU/NPU hints, and safe capability tiers.
- `src/main/services/local-ai/local-ai-manager.ts` - owns provider status, probes, install state, and diagnostics IPC results.
- `src/main/services/local-ai/model-pack-store.ts` - tracks installed packs under `app.getPath('userData')/models`.
- `src/main/services/local-ai/providers/vision-provider.ts` - local/cloud/disabled vision provider interface.
- `src/main/services/local-ai/providers/tts-provider.ts` - Deepgram/local/system/disabled TTS provider interface.
- `src/main/services/local-ai/providers/deepgram-tts-provider.ts` - adapter over existing `CompanionTtsService`.
- `src/main/services/local-ai/providers/system-tts-provider.ts` - no-key fallback using OS speech APIs where practical.
- `src/main/services/local-ai/providers/piper-tts-provider.ts` - local Piper process adapter once the pack is installed.
- `src/main/services/local-ai/providers/kokoro-tts-provider.ts` - local Kokoro adapter once the pack is installed.
- `src/main/services/local-ai/providers/minicpm-vision-provider.ts` - local vision cortex adapter once the pack is installed.
- `src/main/services/local-ai/providers/cloud-vision-provider.ts` - adapter over the existing OpenRouter vision path.
- `src/renderer/settings/components/LocalAiSettings.tsx` - Settings UI section.
- `scripts/check-local-ai-config.mjs` - fast config/defaults/probe-status verification.

**Modified files:**
- `src/shared/types.ts` - imports or re-exports local AI config types as part of `AppConfig`.
- `src/shared/ipc-channels.ts` - local AI IPC channel names.
- `src/preload/index.ts` - exposes local AI config/status/test methods.
- `src/main/ipc-handlers.ts` - wires config, diagnostics, provider tests, TTS routing, and vision routing.
- `src/main/services/agent/companion-tts-service.ts` - becomes one TTS provider, not the only TTS path.
- `src/main/services/agent/heartbeat-service.ts` - uses local vision summaries when available and cost-effective.
- `src/main/services/llm-service.ts` - accepts local vision summaries as screen context without sending raw screenshots when the policy says local-first.
- `src/renderer/settings/components/ApiConfig.tsx` - either embeds `LocalAiSettings` or links to it in the Settings tab.
- `src/renderer/settings/App.tsx` - optional nav item if Local AI becomes its own tab.
- `package.json` - adds lightweight dependencies only after provider choices are final. Avoid adding heavy native runtimes to the first UI/config commit.

---

## Configuration Contract

Add these types in `src/shared/local-ai-types.ts`:

```ts
export type LocalAiMode = 'off' | 'auto' | 'local-first' | 'cloud-first' | 'local-only'
export type LocalAiBudget = 'low' | 'balanced' | 'max'
export type LocalAiInstallState = 'not-installed' | 'installing' | 'installed' | 'failed'
export type LocalAiAvailability = 'disabled' | 'available' | 'installable' | 'unsupported' | 'failed'

export type VisionProviderId = 'disabled' | 'auto' | 'minicpm-v-2_6-openvino' | 'openrouter'
export type TtsProviderId = 'deepgram' | 'system' | 'piper' | 'kokoro' | 'disabled'
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
  openvinoRuntime: 'unknown' | 'available' | 'missing'
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
```

Extend `AppConfig` in `src/shared/types.ts`:

```ts
import type { LocalAiConfig } from './local-ai-types'

export interface AppConfig {
  // existing fields stay unchanged
  localAi?: LocalAiConfig
}
```

---

## Task 1: Add Types, Defaults, And Store Plumbing

**Files:**
- Create: `src/shared/local-ai-types.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/ipc-channels.ts`
- Create: `scripts/check-local-ai-config.mjs`

- [ ] **Step 1: Add `src/shared/local-ai-types.ts`**

Use the exact type block from "Configuration Contract". Keep it dependency-free so both main and renderer can import it.

- [ ] **Step 2: Add IPC channels**

In `src/shared/ipc-channels.ts`, add:

```ts
LOCAL_AI_GET_STATUS: 'local-ai:get-status',
LOCAL_AI_SET_CONFIG: 'local-ai:set-config',
LOCAL_AI_TEST_TTS: 'local-ai:test-tts',
LOCAL_AI_TEST_VISION: 'local-ai:test-vision',
LOCAL_AI_INSTALL_MODEL: 'local-ai:install-model',
LOCAL_AI_REMOVE_MODEL: 'local-ai:remove-model',
```

- [ ] **Step 3: Return local AI config from `GET_CONFIG`**

In `src/main/ipc-handlers.ts`, import `DEFAULT_LOCAL_AI_CONFIG` and include this field in `IPC.GET_CONFIG`:

```ts
localAi: {
  ...DEFAULT_LOCAL_AI_CONFIG,
  ...(configStore.get('localAi', {}) as Record<string, unknown>),
},
```

- [ ] **Step 4: Accept local AI config in `SET_CONFIG`**

Add `'localAi'` to `ALLOWED_CONFIG_KEYS`. Before writing it, normalize unknown values:

```ts
function normalizeLocalAiConfig(input: unknown): LocalAiConfig {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<LocalAiConfig>
    : {}
  return {
    ...DEFAULT_LOCAL_AI_CONFIG,
    ...raw,
    mode: ['off', 'auto', 'local-first', 'cloud-first', 'local-only'].includes(String(raw.mode))
      ? raw.mode as LocalAiMode
      : DEFAULT_LOCAL_AI_CONFIG.mode,
    budget: ['low', 'balanced', 'max'].includes(String(raw.budget))
      ? raw.budget as LocalAiBudget
      : DEFAULT_LOCAL_AI_CONFIG.budget,
    sttProvider: raw.sttProvider === 'whisper-local' ? 'whisper-local' : 'deepgram',
  }
}
```

Store `localAi` through `configStore.set('localAi', normalizeLocalAiConfig(value))`.

- [ ] **Step 5: Expose preload methods**

In `src/preload/index.ts`, add:

```ts
getLocalAiStatus: () => ipcRenderer.invoke(IPC.LOCAL_AI_GET_STATUS),
setLocalAiConfig: (config: unknown) => ipcRenderer.invoke(IPC.LOCAL_AI_SET_CONFIG, config),
testLocalAiTts: () => ipcRenderer.invoke(IPC.LOCAL_AI_TEST_TTS),
testLocalAiVision: () => ipcRenderer.invoke(IPC.LOCAL_AI_TEST_VISION),
installLocalAiModel: (id: string) => ipcRenderer.invoke(IPC.LOCAL_AI_INSTALL_MODEL, id),
removeLocalAiModel: (id: string) => ipcRenderer.invoke(IPC.LOCAL_AI_REMOVE_MODEL, id),
```

- [ ] **Step 6: Add a fast verification script**

Create `scripts/check-local-ai-config.mjs` that imports/transpiles the shared type module and verifies `DEFAULT_LOCAL_AI_CONFIG` has:

```js
assert.equal(DEFAULT_LOCAL_AI_CONFIG.mode, 'auto')
assert.equal(DEFAULT_LOCAL_AI_CONFIG.ttsProvider, 'deepgram')
assert.equal(DEFAULT_LOCAL_AI_CONFIG.sttProvider, 'deepgram')
assert.equal(DEFAULT_LOCAL_AI_CONFIG.allowModelDownloads, false)
```

- [ ] **Step 7: Verify**

Run:

```bash
node scripts/check-local-ai-config.mjs
npm run build
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/local-ai-types.ts src/shared/types.ts src/shared/ipc-channels.ts src/preload/index.ts src/main/ipc-handlers.ts scripts/check-local-ai-config.mjs
git commit -m "feat(local-ai): add settings config contract"
```

---

## Task 2: Add Runtime Status And Hardware Capability Probe

**Files:**
- Create: `src/main/services/local-ai/hardware-profile.ts`
- Create: `src/main/services/local-ai/model-pack-store.ts`
- Create: `src/main/services/local-ai/local-ai-manager.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Implement a conservative hardware profile**

`hardware-profile.ts` should use Node/Electron-safe APIs first:

```ts
import os from 'node:os'
import type { LocalAiHardwareProfile } from '@shared/local-ai-types'

export function getLocalAiHardwareProfile(): LocalAiHardwareProfile {
  const totalMemoryGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10
  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU'
  const reasons: string[] = []
  let capabilityTier: LocalAiHardwareProfile['capabilityTier'] = 'low'

  if (totalMemoryGb >= 32) capabilityTier = 'high'
  else if (totalMemoryGb >= 16) capabilityTier = 'balanced'
  else reasons.push('Less than 16GB system RAM')

  return {
    platform: process.platform,
    arch: process.arch,
    totalMemoryGb,
    cpuModel,
    gpuSummary: 'GPU probe not run',
    openvinoRuntime: 'unknown',
    capabilityTier,
    reasons,
  }
}
```

- [ ] **Step 2: Implement model-pack store**

Use `app.getPath('userData')/models` and a JSON manifest in `model-packs.json`. The first version only reads installed state; downloads are added in Task 7.

- [ ] **Step 3: Implement `LocalAiManager.getStatus()`**

Return `LocalAiStatus` with:
- `minicpm-v-2_6-openvino`: `unsupported` when tier is `low`, `installable` when not installed and tier is `balanced/high`, `available` when installed.
- `piper`: `installable` when not installed, `available` when installed.
- `kokoro`: `installable` when not installed, `available` when installed.
- `deepgram`: `available` only when `deepgramApiKey` exists; otherwise `failed` with `lastError: 'Deepgram API key missing'`.
- `system`: `available` on Windows/macOS, `unsupported` on unknown Linux setups until a shell command is selected.

- [ ] **Step 4: Wire `LOCAL_AI_GET_STATUS`**

In `ipc-handlers.ts`, create one manager instance and return `manager.getStatus()`.

- [ ] **Step 5: Verify**

Run:

```bash
node scripts/check-local-ai-config.mjs
npm run build
```

Expected: both pass and the new files compile.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/local-ai src/main/ipc-handlers.ts
git commit -m "feat(local-ai): report hardware and provider status"
```

---

## Task 3: Add The Settings UI Section

**Files:**
- Create: `src/renderer/settings/components/LocalAiSettings.tsx`
- Modify: `src/renderer/settings/components/ApiConfig.tsx`
- Modify: `src/renderer/settings/App.tsx` if a dedicated tab is chosen
- Modify: `src/preload/index.ts` type declarations

- [ ] **Step 1: Build a self-contained `LocalAiSettings` component**

The component should load `window.api.getLocalAiStatus()` on mount and render:
- Mode segmented control: Off, Auto, Local-first, Cloud-first, Local only.
- Budget segmented control: Low, Balanced, Max.
- Vision provider row with status and install/remove buttons.
- TTS provider row with Deepgram, System, Piper, Kokoro, Disabled.
- STT provider row with Deepgram default and Whisper local marked as fallback/privacy.
- Cloud escalation toggle.
- Model downloads toggle.
- Test TTS and Test Vision buttons.

- [ ] **Step 2: Use restrained operational UI**

Match current settings styling: compact headings, small labels, no marketing copy, no nested cards. Use icons already imported from `lucide-react`: `Cpu`, `Brain`, `Radio`, `Download`, `Shield`, `Wrench`.

- [ ] **Step 3: Protect weak machines in the UI**

When status says MiniCPM is `unsupported`, disable its install button and show the first reason from `hardware.reasons`. When mode is `off`, disable provider test buttons and show statuses as idle/disabled.

- [ ] **Step 4: Save changes**

On every local AI control change, call:

```ts
await window.api.setLocalAiConfig({
  ...status.config,
  mode: nextMode,
})
```

Then reload status.

- [ ] **Step 5: Embed in Settings**

The low-risk option is to add the section near the current LLM/Deepgram settings inside `ApiConfig.tsx`:

```tsx
import LocalAiSettings from './LocalAiSettings'

// after API keys and before model selection
<LocalAiSettings />
```

If the file becomes unwieldy, add a new tab in `src/renderer/settings/App.tsx` named `Local AI` and render the component there.

- [ ] **Step 6: Verify**

Run:

```bash
npm run build
```

Expected: build passes and the Settings page has no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/settings/components/LocalAiSettings.tsx src/renderer/settings/components/ApiConfig.tsx src/renderer/settings/App.tsx src/preload/index.ts
git commit -m "feat(settings): add local ai controls"
```

---

## Task 4: Introduce TTS Provider Interface Without Changing Behavior

**Files:**
- Create: `src/main/services/local-ai/providers/tts-provider.ts`
- Create: `src/main/services/local-ai/providers/deepgram-tts-provider.ts`
- Create: `src/main/services/local-ai/providers/system-tts-provider.ts`
- Modify: `src/main/services/agent/companion-tts-service.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Define `TtsProvider`**

```ts
export interface TtsChunk {
  sampleRate: number
  channels: number
  pcmBase64: string
}

export interface TtsProvider {
  readonly id: TtsProviderId
  readonly label: string
  speak(text: string, onChunk: (chunk: TtsChunk) => void): Promise<void>
  stop(): void
  isAvailable(): Promise<{ ok: boolean; reason?: string }>
}
```

- [ ] **Step 2: Wrap Deepgram**

`deepgram-tts-provider.ts` should adapt the current `CompanionTtsService` behavior. No user-facing behavior changes in this task.

- [ ] **Step 3: Add disabled/system providers**

`system-tts-provider.ts` can start as an availability provider plus a test command for Windows PowerShell `System.Speech` only when invoked by `LOCAL_AI_TEST_TTS`. Do not route companion speech through system TTS until audio output parity is verified.

- [ ] **Step 4: Route `SPEAK_ANSWER` through selected provider**

Keep Deepgram as default. If `localAi.ttsProvider === 'disabled'`, return `answer:tts-unavailable`. If provider fails, send unavailable and keep the read-aloud button stoppable.

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
```

Expected: build passes; read-aloud still uses Deepgram by default.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/local-ai/providers src/main/services/agent/companion-tts-service.ts src/main/ipc-handlers.ts
git commit -m "feat(local-ai): abstract answer tts providers"
```

---

## Task 5: Add Local TTS Model Pack Support

**Files:**
- Create: `src/main/services/local-ai/model-pack-downloads.ts`
- Modify: `src/main/services/local-ai/model-pack-store.ts`
- Modify: `src/main/services/local-ai/providers/piper-tts-provider.ts`
- Modify: `src/main/services/local-ai/providers/kokoro-tts-provider.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/renderer/settings/components/LocalAiSettings.tsx`

- [ ] **Step 1: Define model pack metadata**

Start with metadata only:

```ts
export const LOCAL_AI_MODEL_PACKS = {
  'piper-en-us-small': {
    id: 'piper-en-us-small',
    label: 'Piper English Small',
    provider: 'piper',
    estimatedBytes: 80 * 1024 * 1024,
  },
  'kokoro-82m': {
    id: 'kokoro-82m',
    label: 'Kokoro 82M',
    provider: 'kokoro',
    estimatedBytes: 450 * 1024 * 1024,
  },
  'minicpm-v-2_6-openvino-int4': {
    id: 'minicpm-v-2_6-openvino-int4',
    label: 'MiniCPM-V 2.6 OpenVINO INT4',
    provider: 'minicpm-v-2_6-openvino',
    estimatedBytes: 8 * 1024 * 1024 * 1024,
  },
} as const
```

- [ ] **Step 2: Implement install/remove as explicit user actions**

`LOCAL_AI_INSTALL_MODEL` should reject unless `allowModelDownloads` is true. `LOCAL_AI_REMOVE_MODEL` deletes only paths under the model root after resolving the absolute path and confirming it starts with the model root.

- [ ] **Step 3: Add progress-free first version**

The first implementation can block until complete and then refresh status. If downloads are too slow in manual testing, split into progress events in a follow-up commit.

- [ ] **Step 4: Verify path safety**

Add assertions in `scripts/check-local-ai-config.mjs` for the model-pack root resolver:
- pack path starts with model root
- unknown pack id is rejected
- remove refuses paths outside model root

- [ ] **Step 5: Commit**

```bash
git add src/main/services/local-ai src/main/ipc-handlers.ts src/renderer/settings/components/LocalAiSettings.tsx scripts/check-local-ai-config.mjs
git commit -m "feat(local-ai): manage optional model packs"
```

---

## Task 6: Add Vision Cortex Interface And Cloud-Compatible Output

**Files:**
- Create: `src/main/services/local-ai/providers/vision-provider.ts`
- Create: `src/main/services/local-ai/providers/cloud-vision-provider.ts`
- Create: `src/main/services/local-ai/providers/minicpm-vision-provider.ts`
- Modify: `src/main/services/local-ai/local-ai-manager.ts`
- Modify: `src/main/services/agent/heartbeat-service.ts`
- Modify: `src/main/services/llm-service.ts`

- [ ] **Step 1: Define a small vision result**

```ts
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
```

- [ ] **Step 2: Add cloud provider adapter**

The cloud adapter should call the existing OpenRouter vision model path and return the same `VisionCortexResult` shape. This makes local/cloud behavior comparable.

- [ ] **Step 3: Add MiniCPM provider shell**

The MiniCPM provider returns `isAvailable: false` until the OpenVINO pack is installed. Do not fake successful local inference. This keeps Settings truthful before model pack work is complete.

- [ ] **Step 4: Feed results into heartbeat context**

In `heartbeat-service.ts`, add a dependency like:

```ts
getLocalVisionContext?: () => Promise<VisionCortexResult | null>
```

When available, include a short block:

```text
LOCAL VISION CORTEX
Provider: minicpm-v-2_6-openvino
Visible text: ...
UI hints: ...
Escalate: yes/no, reason
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run build
```

Expected: build passes and cloud routing is unchanged when local vision is unavailable.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/local-ai/providers src/main/services/local-ai/local-ai-manager.ts src/main/services/agent/heartbeat-service.ts src/main/services/llm-service.ts
git commit -m "feat(local-ai): add vision cortex provider contract"
```

---

## Task 7: Implement Routing Policy And Fallbacks

**Files:**
- Create: `src/main/services/local-ai/local-ai-routing-policy.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/services/agent/heartbeat-service.ts`
- Modify: `src/main/services/llm-service.ts`

- [ ] **Step 1: Implement policy decisions**

`local-ai-routing-policy.ts` should export:

```ts
export interface LocalAiRouteDecision {
  useLocalVision: boolean
  sendRawScreenshotToCloud: boolean
  allowCloudEscalation: boolean
  reason: string
}
```

Rules:
- `off`: no local vision, cloud allowed.
- `auto`: local vision only if provider available and hardware tier is not low.
- `local-first`: local vision first, cloud escalation allowed when `cloudEscalationEnabled`.
- `cloud-first`: cloud unchanged, local vision can enrich context only when warmed.
- `local-only`: local vision only; block cloud screenshot upload when `localOnlyBlocksCloudVision`.

- [ ] **Step 2: Use policy in screenshot-heavy paths**

Apply the policy where screenshots are captured for answer generation and heartbeat. The first pass should only replace cloud screenshots with local summaries when the local result has `confidence !== 'low'`.

- [ ] **Step 3: Make failures boring**

On provider crash/timeout:
- Record `lastError`.
- Fall back to cloud if allowed.
- Add a one-line diagnostic to logs.
- Do not show a modal during a live session.

- [ ] **Step 4: Verify**

Run:

```bash
npm run build
```

Manual smoke:
- Set mode Off: cloud answer behavior unchanged.
- Set Auto with no model installed: behavior unchanged.
- Set Local only with no model installed: vision test reports unavailable and cloud screenshot upload is blocked only when the explicit local-only block flag is true.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/local-ai/local-ai-routing-policy.ts src/main/ipc-handlers.ts src/main/services/agent/heartbeat-service.ts src/main/services/llm-service.ts
git commit -m "feat(local-ai): route vision by local ai policy"
```

---

## Task 8: Add Diagnostics, Telemetry, And Manual Smoke Script

**Files:**
- Modify: `src/main/services/local-ai/local-ai-manager.ts`
- Modify: `src/main/services/cost-tracker.ts` if local/cloud deltas are already tracked there
- Modify: `src/renderer/settings/components/LocalAiSettings.tsx`
- Create: `scripts/check-local-ai-routing.mjs`

- [ ] **Step 1: Track provider diagnostics**

Store per-provider:
- last test time
- last latency
- last success/failure
- last error string
- installed bytes

- [ ] **Step 2: Surface diagnostics in Settings**

Each provider row should show one compact status chip:
- Available
- Installable
- Disabled
- Unsupported
- Failed

Show latency after a successful test, e.g. `TTS 184ms`.

- [ ] **Step 3: Add routing verification script**

`scripts/check-local-ai-routing.mjs` should assert:
- `off` never returns `useLocalVision`.
- `auto` refuses local vision on `low`.
- `local-first` uses local vision when provider is available.
- `local-only` can block raw screenshot cloud upload.

- [ ] **Step 4: Verify**

Run:

```bash
node scripts/check-local-ai-config.mjs
node scripts/check-local-ai-routing.mjs
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/local-ai src/renderer/settings/components/LocalAiSettings.tsx scripts/check-local-ai-routing.mjs
git commit -m "test(local-ai): add diagnostics and routing checks"
```

---

## Task 9: Package And Installer Guardrails

**Files:**
- Modify: `package.json`
- Modify: installer config under `build` in `package.json`
- Create: `docs/superpowers/specs/2026-05-12-local-ai-installer-notes.md`

- [ ] **Step 1: Keep base installer model-free**

Confirm `build.extraResources` does not include model weights. Only include provider binaries if they are small and license-compatible.

- [ ] **Step 2: Document pack policy**

Write installer notes covering:
- model packs are downloaded post-install
- each pack has size and license metadata
- user can remove packs from Settings
- installer never enables local vision by default on weak machines
- cloud fallback remains available

- [ ] **Step 3: Verify package manifest**

Run:

```bash
npm run build
```

Expected: build passes. Do not run full `electron-builder` until provider binaries are selected.

- [ ] **Step 4: Commit**

```bash
git add package.json docs/superpowers/specs/2026-05-12-local-ai-installer-notes.md
git commit -m "docs(local-ai): define installer model-pack guardrails"
```

---

## Task 10: End-To-End Manual Test Matrix

**Files:**
- Modify: `docs/superpowers/plans/2026-05-12-local-ai-settings-and-providers.md` only if results require plan corrections

- [ ] **Step 1: Low-machine simulation**

Temporarily force `capabilityTier: 'low'` in the hardware probe.

Expected:
- MiniCPM row says unsupported.
- Install button disabled.
- Off and Auto do not load local vision.
- Deepgram/cloud behavior still works.

- [ ] **Step 2: No-key TTS behavior**

Remove Deepgram key in Settings and select Deepgram TTS.

Expected:
- Read-aloud button reports unavailable.
- App does not crash.
- Provider status says Deepgram key missing.

- [ ] **Step 3: Local TTS test**

Install a small local TTS pack and select it.

Expected:
- Test TTS speaks once.
- Read-aloud button enters active state, can stop, and returns inactive.
- Companion voice remains controllable from overlay.

- [ ] **Step 4: Local vision unavailable**

Select Local-first with no MiniCPM pack installed.

Expected:
- Vision test says install required.
- Live answer behavior falls back to cloud if escalation is enabled.

- [ ] **Step 5: Local-only cloud block**

Select Local only and enable cloud screenshot blocking.

Expected:
- Raw screenshots are not sent to OpenRouter.
- The app either uses local summary or asks the user to install/enable a local vision provider.

- [ ] **Step 6: Final verification**

Run:

```bash
node scripts/check-local-ai-config.mjs
node scripts/check-local-ai-routing.mjs
npm run build
git status --short
```

Expected:
- checks pass
- build passes
- only intentional changes remain

---

## Risk Register

- **MiniCPM-V is not lightweight enough for every machine.** Mitigation: default to no model download, capability probe, disabled install on low tier.
- **Native runtime packaging can bloat or break installers.** Mitigation: model packs and provider binaries are optional and removable.
- **Local STT may regress latency/language quality.** Mitigation: Deepgram remains default; local Whisper is fallback/privacy only.
- **Local TTS audio format may not match current PCM playback path.** Mitigation: keep Deepgram provider default, verify provider output format before routing companion voice.
- **Cloud cost savings may be overstated.** Mitigation: track local/could route counts and cloud screenshot suppression before claiming savings.
- **Privacy mode can reduce answer quality.** Mitigation: Local-only mode must make cloud blocking explicit.

---

## Execution Recommendation

Implement in this order:

1. Config and status plumbing.
2. Settings UI.
3. TTS provider abstraction.
4. Local TTS pack.
5. Vision provider contract.
6. Routing policy.
7. MiniCPM/OpenVINO provider.
8. Installer packaging.

This order gives useful user control early and keeps the risky native/model work behind provider boundaries.

