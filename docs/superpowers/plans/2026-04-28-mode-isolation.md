# Mode Isolation Refactor

**Status:** Approved 2026-04-28 — ready for phase 0
**Author:** Claude (system-engineer mode)
**Date:** 2026-04-28
**Related:** `docs/superpowers/plans/2026-04-26-workspace-mode.md`, `docs/superpowers/plans/2026-04-18-phase8-proactive-agent.md`

## 1. Problem

Today every mode shares a single dispatcher in `src/main/ipc-handlers.ts` (3490 lines, 77 IPC handlers, 38 sites that branch on mode). Symptoms we keep paying for:

- Workspace bubble leaks into Interview mode (heartbeat fires on transcript turns regardless of intent).
- Interview answer window stalls on "Waiting for an answer..." because `isAgentTaskBusy()` is set by a heartbeat run that the user didn't ask for.
- `sessionIntent` and `agentMode` are two parallel mode discriminators, and `isWorkspaceRuntimeMode()` used to OR them — silently activating the workspace runtime when a session was set to "workspace" intent but the user expected interview.
- `SessionSetup` wizard renders a single form with conditional fields, so a "Proactive Agent" picker (originally for Gemini Live) survived even after Gemini was deleted.
- Answer window has three writers (Interview answer pipeline, Workspace executor live feed, Companion `open_answer_window` tool) and no clear ownership — last writer wins.
- A bug fixed in one mode regresses another, because the same function services all three.

The shared-with-conditionals architecture made sense when Companion was the only mode and Workspace was bolted on as a second loop. With three product modes we are paying compound cost and the user is losing trust in the app.

## 2. Goals

- **Hard mode isolation.** A bug or stall in Workspace cannot affect Interview, and vice versa.
- **Single source of truth for "what mode am I in."** One enum read in one place, owned by a `ModeRouter`. No more `sessionIntent` vs `agentMode` ambiguity.
- **Per-mode IPC channels.** Renderers subscribe to mode-prefixed channels and never branch on mode.
- **Per-mode pipelines.** Each mode owns its STT wiring, its LLM client, its tool catalog, its window writes, its lifecycle.
- **Mode-first SessionSetup.** Pick the mode, then render only that mode's fields.
- **Incremental migration.** Every phase ends with the app shippable.

### Non-goals

- Not changing user data formats (sessions, transcripts, profile, vault memory).
- Not changing the visual design of the overlay, answer, canvas, preview, or settings windows.
- Not removing functionality. Anything currently working keeps working.
- Not rewriting Deepgram, OpenRouter, or vault clients.

## 3. Target Architecture

```
                   ┌──────────────────────┐
   Settings/UI ──► │     ModeRouter       │ ◄── single owner of currentMode
                   │                      │     (reads agentMode from config)
                   │  switchMode(mode)    │     calls activePipeline.start/stop
                   │  activePipeline      │
                   └──────────┬───────────┘
                              │ delegates
            ┌─────────────────┼──────────────────┬───────────────────────┐
            ▼                 ▼                  ▼                       ▼
   ┌────────────────┐ ┌────────────────────────────┐ ┌─────────────────┐
   │ InterviewPipe  │ │ CompanionPipe              │ │ WorkspacePipe   │
   │                │ │  voiceEnabled toggled      │ │                 │
   │ STT: dual      │ │  from overlay control bar  │ │ STT: mic-led    │
   │ utterance →    │ │                            │ │ SpeechAgent     │
   │ AnswerPipeline │ │ Heartbeat                  │ │ ExecutionAgent  │
   │ → AnswerWin    │ │ → Bubble (+ Aura TTS if    │ │ → CanvasFeed    │
   │ (teleprompt)   │ │    voiceEnabled)           │ │ ApprovalGate    │
   └────────────────┘ └────────────────────────────┘ └─────────────────┘
            │                       │                         │
            └───────────────────────┴─────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │   Shared Kernel        │
                  │  (utilities, no mode)  │
                  │                        │
                  │  ConfigStore           │
                  │  ContextManager        │
                  │  WindowManager         │
                  │  LLMServiceFactory     │
                  │  STTServiceFactory     │
                  │  MemoryService         │
                  │  ScreenCaptureService  │
                  │  TerminalService       │
                  │  ArtifactStore         │
                  └────────────────────────┘
```

### Pipeline contract (`src/main/pipelines/pipeline.ts`)

```typescript
export interface Pipeline {
  readonly mode: AgentMode

  start(ctx: SessionStartContext): Promise<void>
  stop(reason: 'user-stop' | 'mode-switch' | 'fatal'): Promise<void>

  // Inbound events. Implementations decide what (if anything) to do.
  onTranscriptInterim(entry: TranscriptEntry): void
  onTranscriptFinal(entry: TranscriptEntry): void
  onChatInput(text: string): Promise<void>
  onScreenCaptureRequest(): Promise<void>
  onManualAnswerRequest(): Promise<void>
  onSettingsChanged(diff: Partial<AppConfig>): void

  // Outbound state for UI.
  getState(): PipelineState
}
```

### Hard rules

1. **No `if (mode === ...)` outside ModeRouter.** If you need to branch on mode, the branch belongs in a different pipeline.
2. **No service holds a reference to another pipeline.** Cross-pipeline talk routes through the router (which only ever has one active pipeline anyway, so the router's job is mostly to deny the call).
3. **Lifecycle is total.** `pipeline.stop()` is responsible for releasing every resource it acquired in `start()`. The router does not clean up after a pipeline.
4. **One window writer per mode.** If two modes both want to write the answer window, the router proves at compile time that only one is alive.
5. **Mode-specific config keys live under `config.modes.<mode>.*`** (e.g. `config.modes.interview.autoAnswerEnabled`). Cross-mode keys (deepgram key, profile, theme) stay at root.

## 4. Shared kernel

These are *utilities*, not pipelines. They have no mode awareness, no global mutable state outside what they own, and they expose pure-ish APIs.

| Kernel module | Responsibility | Source today |
|---|---|---|
| `LLMServiceFactory` | Build an `LLMService` for a given OpenRouter model + key. No persisted state. | `services/llm-service.ts` (already mostly factory-shaped) |
| `STTServiceFactory` | Build a `STTService` for a given Deepgram key + speaker label + language. | `services/stt-service.ts` |
| `WindowManager` | Show/hide/focus the overlay, answer, canvas, preview, settings windows. Strict typed `send(window, channel, payload)`. | `windows.ts`, scattered `sendToOverlay` etc. |
| `ConfigStore` | Read/write encrypted config + secure keys. | `services/context-manager.ts` (split out config) |
| `ContextManager` | Profile, last session context, file context loader. | `services/context-manager.ts` |
| `MemoryService` | Vault recall, save, embeddings. | `services/memory/*` |
| `ScreenCaptureService` | One-shot screenshot + persist to session folder. | `services/screen-capture.ts` |
| `TerminalService` | Execute approved workspace-scoped commands. | `services/terminal-service.ts` |
| `ArtifactStore` | Save/load images, web fetches, files referenced by tools. | `services/memory/artifact-store.ts` |
| `ToolDefinitions` | Catalogue of tool schemas. Stateless. Pipelines pick subsets. | `services/agent/tool-definitions.ts` |
| `WebSearchService` | Brave/SerpAPI client. | `services/web-search-service.ts` |
| `WorkspaceFsService` | List/read/write workspace files (rooted at active workspace path). | `services/workspace-service.ts` |
| `MemoryPipeline` | Background event store that records transcript/screenshot events. Pipelines push, recall service reads. | `services/memory/*` |

### What is *not* in the shared kernel

- HeartbeatService → moves into CompanionPipeline
- WorkspaceSpeechService → moves into WorkspacePipeline
- WorkspaceExecutionService + WorkspaceExecutorService → move into WorkspacePipeline
- CompanionTtsService → moves into CompanionVoicePipeline
- AnswerRequestService + AnswerPrepService → move into InterviewPipeline
- All Gemini Live remnants in ipc-handlers (handleGeminiLiveEvent, startGeminiLive, etc.) → deleted

## 5. IPC channel taxonomy

Today: ~77 channels, ad-hoc names like `agent:companion-text:start`, `llm:question`, `workspace:state-update` mixed with `clipboard:write`, `stt:reconnecting`.

Target: a strict three-tier namespace.

```
mode:<mode>:<event>      Per-mode events. Renderers subscribe per mode.
window:<window>:<event>  Window-level events (open/close/focus/resize).
kernel:<service>:<event> Shared kernel events (config:set, deepgram:reconnecting).
```

Examples:

| Old | New |
|---|---|
| `llm:question` | `mode:interview:question` |
| `llm:answer-token` | `mode:interview:answer:token` |
| `llm:answer-end` | `mode:interview:answer:end` |
| `agent:companion-text:start` | `mode:companion:bubble:start` |
| `agent:companion-text:token` | `mode:companion:bubble:token` |
| `workspace:state-update` | `mode:workspace:state` |
| `workspace:approval-request` | `mode:workspace:approval:request` |
| `clipboard:write` | `kernel:clipboard:write` |
| `stt:reconnecting` | `kernel:stt:reconnecting` |
| `config:set` | `kernel:config:set` |

The renderer `Answer` window subscribes to `mode:interview:*` when interview is active and `mode:workspace:*` when workspace is active. The router publishes a single `kernel:mode:active` event whenever the mode switches; the answer-window renderer flips its subscription set on that event.

This is mechanical work, but it's the lever that prevents the "two writers race on the answer window" class of bug.

## 6. Window contracts

Today the answer window receives writes from three places. After the refactor:

| Window | Subscribed channels | Active when |
|---|---|---|
| Overlay | `kernel:*`, `mode:<active>:transcript:*`, `mode:<active>:presence`, `kernel:mode:active` | Always |
| Answer | `mode:interview:question`, `mode:interview:answer:*`, `mode:workspace:state`, `mode:workspace:log`, `mode:workspace:approval:*` | Visible if mode ∈ {interview, workspace}; hidden in companion modes |
| Canvas | `mode:workspace:state`, `mode:workspace:log`, `mode:workspace:approval:*`, `mode:workspace:bubble:*` (workspace TTS captions) | Visible only in workspace mode |
| Preview | `kernel:preview:*` | User-controlled |
| Settings | `kernel:config:*`, `kernel:mode:active`, mode-aware tabs | User-controlled |

Companion modes do not use the answer window. The `open_answer_window` tool for companion is replaced by an inline expandable bubble — the bubble *is* the answer surface in companion mode. (Optional: keep `open_answer_window` as an opt-in companion sub-feature, scoped to `mode:companion:answer:*` channels, so the answer window has at most two writers across the app, never three.)

## 7. SessionSetup wizard restructure

Current flow: one wizard, three steps, fields conditionally rendered.

Target flow: mode-first, then mode-specific.

```
Step 1: Pick mode
  ┌─────────────────────────────────────────┐
  │ ◉ Interview / Meeting / Presentation    │
  │ ○ Companion (chat overlay)              │
  │ ○ Workspace (file/code agent)           │
  └─────────────────────────────────────────┘

Step 2..N: rendered by the picked mode's setup component
  - InterviewSetup: company, role, interview type, subject, notes, context folder
  - CompanionSetup: personality preset, light context, voice model (voice on/off lives in overlay control bar, not here)
  - WorkspaceSetup: workspace folder picker (projects/notes/plans/<child>), speech model, execution model, voice replies toggle
```

Implementation: a `<SessionSetup>` shell component that owns step 1 and the navigation chrome, plus three sibling components (`InterviewSetup`, `CompanionSetup`, `WorkspaceSetup`) that own their own state and emit a typed `SessionStartContext` discriminated by mode.

```typescript
type SessionStartContext =
  | { mode: 'interview', interview: InterviewSessionFields }
  | { mode: 'companion', companion: CompanionSessionFields }
  | { mode: 'workspace', workspace: WorkspaceSessionFields }
```

`SessionContext` in `shared/types.ts` is replaced by this discriminated union. Persistence keeps a `lastSessionContext` per mode, so switching modes doesn't wipe the other mode's last setup.

## 8. Config & state separation

```typescript
interface AppConfig {
  // shared
  apiKeys: { openrouter: string; deepgram: string }
  profile: ProfileContext
  language: string
  contentProtection: boolean
  overlayOpacity: number
  fontSize: number

  // mode-scoped
  activeMode: AgentMode  // single source of truth
  modes: {
    interview: { autoAnswerEnabled: boolean; codingModelEnabled: boolean; codingModel: string; defaultModel: string }
    companion: { personality: PersonalityPreset; interruptionPolicy: InterruptionPolicy; heartbeatIntervalMs: number; proactiveNudges: boolean; voiceEnabled: boolean; voiceName: string; voiceModel: string }  // voiceEnabled toggled from overlay control bar
    workspace: { speechModel: string; executionModel: string; voiceEnabled: boolean }
  }
}
```

Migration: on first read after deploy, read existing flat keys and re-shape into nested form. Drop dead keys (`liveAgentEnabled`, `liveAgentVoiceEnabled`, `agentEngine`, etc.) once we are confident.

## 9. Migration phases

Each phase is shippable on its own. Stop at any phase if priorities shift.

### Phase 0: Surface lock (½ day)

- Add `mode-router.ts` shell that delegates every method to current ipc-handler functions. No behavior change.
- Add ESLint rule (or repo-grep CI) banning new `if (mode === ...)` outside `mode-router.ts` or `pipelines/`.
- Land the IPC channel taxonomy as a typed registry in `shared/ipc-channels.ts` (today's channels still flow through, but new code must declare its channel).

### Phase 1: InterviewPipeline extraction (1–1½ days)

- Create `pipelines/interview-pipeline.ts`.
- Move ownership of: dual STTService (interviewer + mic), `maybeGenerateAnswer`, `runManualAnswer`, `answer-prep-service`, `answer-request-service`, screen-capture-on-demand for interviews, answer window writes.
- Replace the interview branches in `ipc-handlers.ts` with `router.handle*` delegations.
- Acceptance: in interview mode, no heartbeat call sites are reachable; switching to a non-interview mode tears down the interview pipeline and stops both STTs.

### Phase 2: CompanionPipeline extraction (1½ days)

- Create `pipelines/companion-pipeline.ts`.
- Move: heartbeat-service, bubble manager (extracted from heartbeat-service), tool catalog filtering, soul prompt loader, screen-capture-on-demand for companion, presence state.
- Companion-voice extends companion-text and adds: `companion-tts-service`, voice channels, mic-bleed suppression.
- The answer window is hidden in companion mode by default; bubble is the surface.
- Acceptance: in companion mode, no `maybeGenerateAnswer` call site is reachable.

### Phase 3: WorkspacePipeline extraction (2 days)

- Create `pipelines/workspace-pipeline.ts`.
- Move: `workspace-execution-service`, `workspace-executor-service`, `workspace-speech-service`, workspace canvas writes, approval gate, persisted log buffer.
- Speech LLM and Execution LLM clients are per-pipeline and torn down on stop.
- Acceptance: in workspace mode, no heartbeat or interview answer pipeline call site is reachable.

### Phase 4: SessionSetup wizard restructure (½ day)

- Split `SessionSetup.tsx` into `SessionSetup.tsx` (shell + step 1) plus `InterviewSetup.tsx`, `CompanionSetup.tsx`, `WorkspaceSetup.tsx`.
- Replace `SessionContext` type with discriminated union.
- Persist `lastSessionContext` per mode under `config.modes.<mode>.lastSession`.

### Phase 5: IPC channel rename + window contracts (1 day)

- Apply the `mode:*` / `window:*` / `kernel:*` taxonomy.
- Wire answer window's subscription flip to `kernel:mode:active`.
- Hide answer window in companion mode by default.
- Hide canvas window outside workspace mode.

### Phase 6: Config flatten → nested migration (½ day)

- One-shot migration on app start: read flat keys, write nested shape, leave flat keys for one release as fallback, then delete.

### Phase 7: Cleanup (½ day)

- Delete Gemini Live remnants from ipc-handlers (handleGeminiLiveEvent, startGeminiLive, stopGeminiLive, all `gemini` references).
- Delete dead `companion-text` / `companion-voice` AgentEngine values.
- Delete dead `sessionIntent === 'workspace'` checks.
- Reduce `ipc-handlers.ts` to the routing skeleton (target: <800 lines).

**Total estimate: 7–8 days of focused work.**

## 10. File-level inventory (what moves where)

### New files

```
src/main/pipelines/
  pipeline.ts                       # Pipeline interface + lifecycle types
  mode-router.ts                    # Single owner of activePipeline
  interview-pipeline.ts
  companion-pipeline.ts
  workspace-pipeline.ts
  index.ts                          # factory: createPipeline(mode, deps)

src/shared/
  ipc-channels.ts                   # typed channel registry

src/renderer/overlay/components/
  setup/
    SessionSetup.tsx                # shell
    InterviewSetup.tsx
    CompanionSetup.tsx
    WorkspaceSetup.tsx
```

### Files that shrink dramatically

```
src/main/ipc-handlers.ts            # 3490 → ~800 (only routing + window IPC)
src/main/services/agent/heartbeat-service.ts        # moves into companion-pipeline as private
src/main/services/agent/workspace-speech-service.ts # moves into workspace-pipeline as private
src/main/services/agent/workspace-executor-service.ts # moves into workspace-pipeline as private
src/main/services/agent/workspace-execution-service.ts # moves into workspace-pipeline as private
src/main/services/agent/companion-tts-service.ts    # moves into companion-voice-pipeline
src/main/services/answer-request-service.ts        # moves into interview-pipeline
src/main/services/answer-prep-service.ts           # moves into interview-pipeline
src/renderer/overlay/components/SessionSetup.tsx   # split into 4 files
```

### Files that stay roughly the same

```
src/main/services/llm-service.ts
src/main/services/stt-service.ts
src/main/services/context-manager.ts
src/main/services/memory/*
src/main/services/screen-capture.ts
src/main/services/terminal-service.ts
src/main/services/web-search-service.ts
src/main/services/workspace-service.ts
src/main/services/workspace-analysis-service.ts
src/main/services/agent/tool-definitions.ts
src/main/services/agent/workspace-prompt.ts
src/main/services/agent/workspace-skills.ts
```

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hidden coupling discovered mid-extraction (e.g. heartbeat reads sessionTranscript directly from a global) | High | Medium | Phase 0 ESLint rule + a survey pass before each extraction phase. Document each cross-module read explicitly. |
| Renderer drift: overlay/answer renderers depend on legacy channels | High | Low | Phase 5 keeps both channel names live for one release. Renderer subscribes to both during transition. |
| Migration of `lastSessionContext` corrupts a user's saved setup | Low | Medium | One-shot migration writes to a new key, leaves old key intact for one release. |
| User runs old electron-store config alongside new schema | Medium | Low | Migration runs on every config load until flat keys are gone; idempotent. |
| Lost capability: companion `open_answer_window` tool | Low | Low | Optional companion-answer channel preserves it; gated by setting. |
| Refactor exceeds estimate | Medium | Low | Phases are independent; ship after any phase. |
| Memory pipeline cross-references break | Medium | Medium | MemoryPipeline stays kernel; pipelines push events via the same API; recall is read-only on pipelines. |

## 12. Acceptance criteria (whole-refactor)

- `grep -rn "if .*mode.*===\|if .*currentAgentMode\|if .*isWorkspaceRuntimeMode" src/main/services` returns zero matches.
- `grep -rn "sessionIntent" src/main` only returns hits inside InterviewPipeline (where it still drives interview-vs-meeting-vs-presentation copy).
- Switching from interview → workspace via Settings stops both interview STTs, releases the LLM service, and starts the workspace pipeline atomically. No "ghost" callbacks fire from the dead pipeline.
- A forced exception inside WorkspacePipeline cannot reach InterviewPipeline state. Verified by a fault-injection test.
- The answer window has at most one writer at any time, enforced by the channel-subscription contract.
- `ipc-handlers.ts` is under 1000 lines.
- All four current end-to-end flows (interview answer, companion bubble, workspace task with approval, mode switch mid-session) pass smoke tests.

## 13. Open questions (need user decision before phase 1)

1. **Mode switching mid-session.** ✅ **Decided 2026-04-28:** require Stop Session first. The agent-mode picker is disabled while a session is live; the user clicks Stop, then changes mode, then starts a new session. Eliminates the cross-pipeline race class entirely.
2. **Answer window in companion mode.** ✅ **Decided 2026-04-28:** drop `open_answer_window` from the companion tool catalog. The bubble is the only output surface in companion mode; the answer window is hidden. If a future capability needs it (e.g. long-form companion answers), revisit then.
3. **Per-mode session storage.** ✅ **Decided 2026-04-28:** flat list under `sessions/` with a `mode: 'interview' | 'companion' | 'workspace'` field on each `session.json`. Folder name keeps its existing `{date}_{company}_{role}` shape.
4. **Companion-text vs companion-voice.** ✅ **Decided 2026-04-28:** one `CompanionPipeline` with a `voiceEnabled` flag. The voice/text toggle lives in the overlay control bar, not in Settings or SessionSetup. `AgentMode` collapses from `companion-text | companion-voice` to a single `companion` value.
5. **`interviewType` placement.** ✅ **Decided 2026-04-28:** lives under `config.modes.interview.lastSession.interviewType`. Interview mode is the only consumer.

## 14. Out-of-scope (deliberate)

- Cross-platform Mac/Linux work.
- Re-architecting the memory/vault system.
- Replacing OpenRouter or Deepgram.
- Adding new modes (e.g. "debate", "tutoring") — the structure should make those cheap to add later but we don't add them now.
- Changing the look of any window. Visual changes belong in their own plan.

## 15. Approved scope (2026-04-28)

All five open questions resolved (see §13). Pipeline contract (§3) and IPC taxonomy (§5) accepted as drafted. Cleared to start phase 0 + phase 1 — these land together as the first PR (interview mode fully isolated). The user tests interview behavior in isolation before we touch companion or workspace.
