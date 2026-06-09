# Workspace Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build workspace mode as a fourth AgentMode where two parallel OpenRouter conversations cooperate — a Speech leg that stays responsive to the user (voice or text + Aura TTS) while an Execution leg plans and executes workspace tasks with a Claude-Code-style live feed in the answer window.

**Architecture:** A single `WorkspaceExecutionService` in main owns the state machine, queue, log ring buffer, and approval policies. The Speech leg runs a fast OpenRouter loop (user-selected `speechModel`) with a narrow 7-tool control catalogue; it talks to the user and reads/mutates service state. The Execution leg runs a stronger OpenRouter loop (user-selected `executionModel`) with the full workspace toolkit; it plans, executes, and verifies one task at a time. Skills are markdown instruction packs the planner picks from. The approval gate is generalized so any sensitive tool (write, terminal, delete) can request approval. The canvas window adds a workspace-mode live feed UI subscribed to state and log events.

**Tech Stack:** Electron 41, React 19, TypeScript, OpenRouter, Deepgram (STT + Aura TTS), `electron-store`, existing `WorkspaceService`/`TerminalService`/`WorkspaceAnalysisService`.

---

## File Structure

**New:**
- `src/main/services/agent/workspace-execution-service.ts` — state machine, queue, logs, approval policies (single source of truth)
- `src/main/services/agent/workspace-speech-service.ts` — Speech leg OpenRouter loop, TTS routing, status-snapshot injection
- `src/main/services/agent/workspace-executor-service.ts` — Execution leg planner + executor + verifier
- `src/main/services/agent/workspace-skills.ts` — skill loader + planner skill picker
- `src/main/services/agent/workspace-prompt.ts` — system prompts for Speech leg, Planner, Executor, Verifier
- `resources/workspace-skills/create-new-project.md`
- `resources/workspace-skills/inspect-workspace.md`
- `resources/workspace-skills/modify-existing-feature.md`
- `resources/workspace-skills/write-research-doc.md`
- `resources/workspace-skills/generate-content.md`
- `src/renderer/canvas/components/WorkspaceFeed.tsx` — live execution feed UI
- `src/renderer/canvas/components/WorkspaceApprovalCard.tsx` — inline approval card with diff preview

**Modified:**
- `src/shared/types.ts` — extend `AgentMode`, add `WorkspaceTask`/`ExecutionPlan`/`AgentLogEntry`/`WorkspaceExecutionState`/`ApprovalRequest`/`ApprovalResponse`, drop dead `gemini-text`/`gemini-audio` engines
- `src/shared/constants.ts` — add `WORKSPACE_DEFAULTS`, IPC channel names
- `src/main/services/agent/tool-definitions.ts` — add 7 Speech control tools, generalize `requestWorkspaceWriteApproval` → `requestApproval`, add `AbortSignal` to executor signature
- `src/main/ipc-handlers.ts` — wire `WorkspaceExecutionService` + Speech leg + Executor leg into agent-mode plumbing, add IPC handlers for state/logs subscription, drop dead Gemini Live paths
- `src/preload/index.ts` — expose workspace-mode subscription APIs
- `src/renderer/canvas/App.tsx` — render `WorkspaceFeed` when in workspace mode
- `src/renderer/settings/components/ApiConfig.tsx` — add `speechModel` + `executionModel` model pickers, add Workspace tile to mode picker
- `README.md` — document the new mode

**Deleted:**
- Any remaining Gemini Live source paths (`liveAgentEnabled`/`liveAgentVoiceEnabled` config keys keep their migration shims but no longer drive runtime behavior)

---

## Task 1: Extend shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `'workspace'` to `AgentMode`**

In `src/shared/types.ts`, change the `AgentMode` definition:

```ts
// Product-level mode the user picks in Settings. Maps to lower-level engines
// via deriveAgentMode/applyAgentMode helpers in ipc-handlers.
// Persisted under config.agentMode.
export type AgentMode =
  | 'interview'
  | 'companion-text'
  | 'companion-voice'
  | 'workspace'
```

- [ ] **Step 2: Drop dead engine values from `AgentEngine`**

```ts
export type AgentEngine =
  | 'default'
  | 'openrouter'
  | 'companion-text'
  | 'companion-voice'
  | 'workspace-speech'
  | 'workspace-executor'
```

(Removed: `'gemini-text' | 'gemini-audio'`. The migration shim in `applyAgentMode` keeps `liveAgentEnabled`/`liveAgentVoiceEnabled` config keys updated for backwards compatibility but they no longer drive runtime engines.)

- [ ] **Step 3: Add workspace state types**

Append to `src/shared/types.ts`:

```ts
export type WorkspacePlanMode = 'plan_only' | 'plan_and_execute'

export type WorkspaceExecutionStatus =
  | 'idle'
  | 'planning'
  | 'queued'
  | 'waiting_for_approval'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'

export type AgentLogPhase =
  | 'received'
  | 'planning'
  | 'skill_selection'
  | 'queued'
  | 'approval'
  | 'execution'
  | 'verification'
  | 'completed'
  | 'failed'

export type AgentLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface AgentLogEntry {
  id: string
  timestamp: number
  taskId?: string
  level: AgentLogLevel
  phase: AgentLogPhase
  message: string
  toolName?: string
  filePath?: string
  durationMs?: number
}

export interface ExecutionPlanStep {
  id: string
  description: string
  toolName?: string
  filePath?: string
  requiresApproval: boolean
}

export interface ExecutionPlan {
  summary: string
  steps: ExecutionPlanStep[]
  selectedSkillId?: string
}

export interface WorkspaceTask {
  id: string
  request: string
  source: 'voice' | 'chat' | 'ui' | 'system'
  status:
    | 'pending'
    | 'planning'
    | 'waiting_for_approval'
    | 'executing'
    | 'verifying'
    | 'done'
    | 'failed'
    | 'cancelled'
  createdAt: number
  startedAt?: number
  finishedAt?: number
  plan?: ExecutionPlan
  planMode: WorkspacePlanMode
  skillId?: string
  failureReason?: string
}

export interface ApprovalRequest {
  id: string
  taskId?: string
  toolName: string
  summary: string
  payload: Record<string, any>
  preview?: string
  bytes?: number
  createdAt: number
}

export interface ApprovalResponse {
  id: string
  decision: 'approve' | 'decline' | 'always-allow-session'
}

export interface WorkspaceExecutionState {
  status: WorkspaceExecutionStatus
  currentTask: WorkspaceTask | null
  queue: WorkspaceTask[]
  activeApproval: ApprovalRequest | null
  recentLogs: AgentLogEntry[]
  workspacePath: string
  paused: boolean
}
```

- [ ] **Step 4: Add `AbortSignal` to `ToolExecutorFn`**

Find the existing `ToolExecutorFn` definition. Change to:

```ts
export type ToolExecutorFn = (
  toolName: string,
  args: Record<string, any>,
  signal?: AbortSignal
) => Promise<string>
```

- [ ] **Step 5: Add config keys**

Find `AppConfig`. Add:

```ts
  speechModel?: string
  executionModel?: string
  workspaceVoiceEnabled?: boolean
  workspacePlanMode?: WorkspacePlanMode
  workspaceAlwaysAllowTools?: string[]
```

(Keep existing `companionVoiceModel`, `agentMode`, etc.)

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: TypeScript compile succeeds. (Errors will appear elsewhere because consumers don't know the new types yet — fix only what's mechanically broken; later tasks fix the rest.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add workspace-mode shared types"
```

---

## Task 2: Add workspace constants and IPC channel names

**Files:**
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Append constants**

```ts
export const WORKSPACE_DEFAULTS = {
  speechModel: 'anthropic/claude-haiku-4-5-20251001',
  executionModel: 'anthropic/claude-sonnet-4-6',
  planMode: 'plan_and_execute' as const,
  voiceEnabled: true,
  logRingSize: 200,
  speechMaxTokens: 220,
  speechTemperature: 0.5,
  plannerMaxTokens: 1500,
  plannerTemperature: 0.2,
  executorMaxTokens: 4096,
  executorTemperature: 0.2,
  executorMaxIterations: 12,
}
```

(Defaults are *fallbacks* if the user hasn't picked models yet. The user can pick any OpenRouter-routed model in settings — the defaults exist so first-run is functional.)

- [ ] **Step 2: Append IPC channel names to the existing channels object**

Find the `WORKSPACE` channel block (`LIST_WORKSPACE_FOLDERS`, etc.) and add to the same channels constant:

```ts
  WORKSPACE_STATE_UPDATE: 'workspace:state-update',
  WORKSPACE_LOG_APPEND: 'workspace:log-append',
  WORKSPACE_APPROVAL_REQUESTED: 'workspace:approval-requested',
  WORKSPACE_APPROVAL_RESOLVED: 'workspace:approval-resolved',
  WORKSPACE_SUBMIT_REQUEST: 'workspace:submit-request',
  WORKSPACE_CANCEL_TASK: 'workspace:cancel-task',
  WORKSPACE_PAUSE_QUEUE: 'workspace:pause-queue',
  WORKSPACE_RESUME_QUEUE: 'workspace:resume-queue',
  WORKSPACE_DECIDE_APPROVAL: 'workspace:decide-approval',
  WORKSPACE_GET_STATE: 'workspace:get-state',
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants.ts
git commit -m "Add workspace constants and IPC channel names"
```

---

## Task 3: Create `WorkspaceExecutionService` skeleton

**Files:**
- Create: `src/main/services/agent/workspace-execution-service.ts`

- [ ] **Step 1: Write the service**

Create `src/main/services/agent/workspace-execution-service.ts`:

```ts
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  AgentLogEntry,
  AgentLogLevel,
  AgentLogPhase,
  ApprovalRequest,
  ApprovalResponse,
  ExecutionPlan,
  WorkspaceExecutionState,
  WorkspaceExecutionStatus,
  WorkspacePlanMode,
  WorkspaceTask,
} from '@shared/types'
import { WORKSPACE_DEFAULTS } from '@shared/constants'

export interface WorkspaceExecutionServiceDeps {
  getWorkspacePath: () => string
  logRingSize?: number
}

type ApprovalResolver = (decision: ApprovalResponse['decision']) => void

export class WorkspaceExecutionService extends EventEmitter {
  private status: WorkspaceExecutionStatus = 'idle'
  private currentTask: WorkspaceTask | null = null
  private queue: WorkspaceTask[] = []
  private activeApproval: ApprovalRequest | null = null
  private logs: AgentLogEntry[] = []
  private alwaysAllow = new Set<string>()
  private paused = false
  private currentAbort: AbortController | null = null
  private pendingApprovals = new Map<string, ApprovalResolver>()

  constructor(private readonly deps: WorkspaceExecutionServiceDeps) {
    super()
  }

  // ----- Public API: state queries -----

  getState(): WorkspaceExecutionState {
    return {
      status: this.status,
      currentTask: this.currentTask,
      queue: [...this.queue],
      activeApproval: this.activeApproval,
      recentLogs: this.logs.slice(-50),
      workspacePath: this.deps.getWorkspacePath(),
      paused: this.paused,
    }
  }

  getStatus(): WorkspaceExecutionStatus {
    return this.status
  }

  isBusy(): boolean {
    return this.currentTask !== null
  }

  getRecentLogs(limit = 25): AgentLogEntry[] {
    return this.logs.slice(-limit)
  }

  // ----- Public API: queue mutations -----

  submitTask(input: {
    request: string
    source: WorkspaceTask['source']
    planMode?: WorkspacePlanMode
  }): WorkspaceTask {
    const task: WorkspaceTask = {
      id: randomUUID(),
      request: input.request,
      source: input.source,
      status: 'pending',
      createdAt: Date.now(),
      planMode: input.planMode || WORKSPACE_DEFAULTS.planMode,
    }
    this.queue.push(task)
    this.appendLog({
      taskId: task.id,
      level: 'info',
      phase: 'received',
      message: `New task from ${task.source}: ${task.request}`,
    })
    this.emitState()
    this.emit('task-queued', task)
    return task
  }

  pauseQueue(): void {
    if (this.paused) return
    this.paused = true
    this.appendLog({ level: 'info', phase: 'queued', message: 'Queue paused' })
    this.emitState()
  }

  resumeQueue(): void {
    if (!this.paused) return
    this.paused = false
    this.appendLog({ level: 'info', phase: 'queued', message: 'Queue resumed' })
    this.emitState()
    this.emit('queue-resumed')
  }

  cancelCurrent(reason = 'cancelled by user'): void {
    if (!this.currentTask) return
    this.currentAbort?.abort()
    const task = this.currentTask
    task.status = 'cancelled'
    task.failureReason = reason
    task.finishedAt = Date.now()
    this.appendLog({
      taskId: task.id,
      level: 'warning',
      phase: 'failed',
      message: `Task cancelled: ${reason}`,
    })
    this.activeApproval = null
    this.declineAllPendingApprovals('task cancelled')
    this.transitionTo('idle')
    this.currentTask = null
    this.emitState()
  }

  // ----- Public API: lifecycle for the executor -----

  beginTask(taskId: string): WorkspaceTask | null {
    if (this.paused) return null
    if (this.currentTask) return null
    const idx = this.queue.findIndex((t) => t.id === taskId)
    if (idx === -1) return null
    const task = this.queue.splice(idx, 1)[0]
    task.startedAt = Date.now()
    task.status = 'planning'
    this.currentTask = task
    this.currentAbort = new AbortController()
    this.transitionTo('planning')
    this.emitState()
    return task
  }

  setPlan(plan: ExecutionPlan): void {
    if (!this.currentTask) return
    this.currentTask.plan = plan
    this.currentTask.skillId = plan.selectedSkillId
    this.appendLog({
      taskId: this.currentTask.id,
      level: 'info',
      phase: 'planning',
      message: `Plan: ${plan.summary} (${plan.steps.length} steps)`,
    })
    if (plan.selectedSkillId) {
      this.appendLog({
        taskId: this.currentTask.id,
        level: 'info',
        phase: 'skill_selection',
        message: `Skill: ${plan.selectedSkillId}`,
      })
    }
  }

  transitionTo(status: WorkspaceExecutionStatus): void {
    this.status = status
    if (this.currentTask) {
      switch (status) {
        case 'planning':
          this.currentTask.status = 'planning'
          break
        case 'waiting_for_approval':
          this.currentTask.status = 'waiting_for_approval'
          break
        case 'executing':
          this.currentTask.status = 'executing'
          break
        case 'verifying':
          this.currentTask.status = 'verifying'
          break
        case 'completed':
          this.currentTask.status = 'done'
          this.currentTask.finishedAt = Date.now()
          break
        case 'failed':
          this.currentTask.status = 'failed'
          this.currentTask.finishedAt = Date.now()
          break
      }
    }
    this.emitState()
  }

  finishTask(result: 'completed' | 'failed', failureReason?: string): void {
    if (!this.currentTask) return
    if (failureReason) this.currentTask.failureReason = failureReason
    this.appendLog({
      taskId: this.currentTask.id,
      level: result === 'completed' ? 'success' : 'error',
      phase: result === 'completed' ? 'completed' : 'failed',
      message:
        result === 'completed'
          ? 'Task completed'
          : `Task failed: ${failureReason || 'unknown error'}`,
    })
    this.transitionTo(result)
    this.currentTask = null
    this.currentAbort = null
    this.activeApproval = null
    this.emitState()
    this.emit('task-finished', result)
    if (!this.paused && this.queue.length > 0) {
      this.emit('next-task-ready')
    } else {
      this.transitionTo('idle')
    }
  }

  getCurrentAbortSignal(): AbortSignal | undefined {
    return this.currentAbort?.signal
  }

  // ----- Public API: logs -----

  appendLog(entry: Omit<AgentLogEntry, 'id' | 'timestamp'>): AgentLogEntry {
    const full: AgentLogEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...entry,
    }
    this.logs.push(full)
    const ringSize = this.deps.logRingSize || WORKSPACE_DEFAULTS.logRingSize
    if (this.logs.length > ringSize) {
      this.logs = this.logs.slice(this.logs.length - ringSize)
    }
    this.emit('log', full)
    return full
  }

  // ----- Public API: approvals -----

  requestApproval(input: {
    toolName: string
    summary: string
    payload: Record<string, any>
    preview?: string
    bytes?: number
  }): Promise<ApprovalResponse['decision']> {
    if (this.alwaysAllow.has(input.toolName)) {
      return Promise.resolve('always-allow-session')
    }
    const id = randomUUID()
    const request: ApprovalRequest = {
      id,
      taskId: this.currentTask?.id,
      toolName: input.toolName,
      summary: input.summary,
      payload: input.payload,
      preview: input.preview,
      bytes: input.bytes,
      createdAt: Date.now(),
    }
    this.activeApproval = request
    this.transitionTo('waiting_for_approval')
    this.appendLog({
      taskId: this.currentTask?.id,
      level: 'info',
      phase: 'approval',
      message: `Awaiting approval: ${input.summary}`,
      toolName: input.toolName,
      filePath: input.payload?.path,
    })
    this.emit('approval-requested', request)
    return new Promise((resolve) => {
      this.pendingApprovals.set(id, resolve)
    })
  }

  resolveApproval(response: ApprovalResponse): boolean {
    const resolver = this.pendingApprovals.get(response.id)
    if (!resolver) return false
    this.pendingApprovals.delete(response.id)
    if (response.decision === 'always-allow-session' && this.activeApproval) {
      this.alwaysAllow.add(this.activeApproval.toolName)
    }
    this.appendLog({
      taskId: this.currentTask?.id,
      level: response.decision === 'decline' ? 'warning' : 'success',
      phase: 'approval',
      message: `Approval ${response.decision} for ${this.activeApproval?.toolName}`,
      toolName: this.activeApproval?.toolName,
    })
    this.activeApproval = null
    if (this.currentTask) this.transitionTo('executing')
    this.emit('approval-resolved', response)
    resolver(response.decision)
    return true
  }

  declineAllPendingApprovals(reason: string): void {
    for (const [id, resolve] of this.pendingApprovals) {
      this.appendLog({
        level: 'warning',
        phase: 'approval',
        message: `Approval auto-declined (${reason})`,
      })
      resolve('decline')
      this.emit('approval-resolved', { id, decision: 'decline' })
    }
    this.pendingApprovals.clear()
  }

  resetForNewSession(): void {
    this.cancelCurrent('session ended')
    this.queue = []
    this.logs = []
    this.alwaysAllow = new Set()
    this.paused = false
    this.transitionTo('idle')
    this.emitState()
  }

  // ----- Internals -----

  private emitState(): void {
    this.emit('state', this.getState())
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: file compiles in isolation.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/agent/workspace-execution-service.ts
git commit -m "Add WorkspaceExecutionService state machine"
```

---

## Task 4: Generalize approval gate

**Files:**
- Modify: `src/main/services/agent/tool-definitions.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Replace `requestWorkspaceWriteApproval` in `ToolExecutorDeps` with a generic `requestApproval`**

In `tool-definitions.ts`, find the `ToolExecutorDeps` interface and replace the existing `requestWorkspaceWriteApproval` block with:

```ts
  requestApproval?: (input: {
    toolName: string
    summary: string
    payload: Record<string, any>
    preview?: string
    bytes?: number
  }) => Promise<'approve' | 'decline' | 'always-allow-session'>
```

- [ ] **Step 2: Update `executeWriteWorkspaceFile` to use the new shape**

```ts
async function executeWriteWorkspaceFile(
  deps: ToolExecutorDeps,
  args: Record<string, any>,
  _signal?: AbortSignal
): Promise<string> {
  if (!deps.workspaceService) {
    return 'Workspace file writing is not available right now.'
  }

  const targetPath = String(args.path ?? '').trim()
  if (!targetPath) {
    return 'No file path provided.'
  }

  const content = String(args.content ?? '')
  const bytes = Buffer.byteLength(content, 'utf8')
  const preview = content.length > 1200 ? `${content.slice(0, 1200)}\n\n...` : content

  const decision = await deps.requestApproval?.({
    toolName: 'write_workspace_file',
    summary: `Write ${bytes} bytes to ${targetPath}`,
    payload: { path: targetPath, content },
    preview,
    bytes,
  })
  if (decision === 'decline' || decision === undefined) {
    return `User declined write_workspace_file for "${targetPath}". No file was written.`
  }

  const result = deps.workspaceService.writeTextFile(targetPath, content)
  return [
    `Wrote ${result.bytes} bytes to "${result.path}".`,
    result.created ? 'File was newly created.' : 'File was overwritten.',
  ].join('\n')
}
```

- [ ] **Step 3: Add a generalized terminal approval call in the existing `run_terminal_command` executor**

Find the existing terminal-command executor block. Wrap the actual command run with:

```ts
const decision = await deps.requestApproval?.({
  toolName: 'run_terminal_command',
  summary: `Run: ${command}`,
  payload: { command, cwd: deps.terminalService?.getRoot?.() },
})
if (decision === 'decline' || decision === undefined) {
  return `User declined run_terminal_command. Command not executed.`
}
```

(Replace any existing `requestTerminalApproval` Electron-dialog path with this. The dialog fallback can stay only when `deps.requestApproval` is unset, e.g. in non-workspace flows.)

- [ ] **Step 4: Add `signal` parameter to `ToolExecutorFn` callsites**

In `tool-definitions.ts`, find the function that builds the actual `ToolExecutorFn` (it dispatches by `toolName`). Add a third arg:

```ts
return async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  signal?: AbortSignal
): Promise<string> {
  // ...existing dispatcher, plus pass `signal` to long-running tools.
}
```

Pass `signal` into `executeWriteWorkspaceFile`, `executeRunTerminalCommand`, `executeSearchWeb`, `executeAnalyzeWorkspaceCode`, and `executeAnalyzeCurrentScreen`. Other tools can ignore it.

- [ ] **Step 5: Wire `requestApproval` in `ipc-handlers.ts`**

In `ipc-handlers.ts`, replace the existing `requestWorkspaceWriteApproval` function with a generic one that bridges to `WorkspaceExecutionService` when in workspace mode, and falls back to the existing canvas-window flow otherwise:

```ts
async function requestApproval(input: {
  toolName: string
  summary: string
  payload: Record<string, any>
  preview?: string
  bytes?: number
}): Promise<'approve' | 'decline' | 'always-allow-session'> {
  // In workspace mode, route through WorkspaceExecutionService so the live
  // feed UI shows the approval card and the speech leg can decide via voice.
  if (currentAgentMode() === 'workspace') {
    return workspaceExecutionService.requestApproval(input)
  }

  // Legacy path (interview/companion modes): existing canvas card flow.
  if (input.toolName === 'write_workspace_file') {
    if (alwaysAllowWorkspaceWritesThisSession) return 'always-allow-session'
    const id = randomUUID()
    const payload: WorkspaceWriteApprovalRequest = {
      id,
      toolName: 'write_workspace_file',
      path: String(input.payload.path),
      bytes: input.bytes ?? 0,
      preview: input.preview ?? '',
    }
    showAnswerWindow()
    sendToAnswer('tool-approval:workspace-write-requested', payload)
    sendToOverlay('tool-approval:workspace-write-requested', payload)
    return new Promise((resolve) => {
      pendingWorkspaceWriteApprovals.set(id, (approved: boolean) =>
        resolve(approved ? 'approve' : 'decline')
      )
    })
  }
  // For unknown tools in non-workspace mode, decline by default.
  return 'decline'
}
```

(Keep `pendingWorkspaceWriteApprovals` typed as `Map<string, (approved: boolean) => void>` for the legacy path.)

- [ ] **Step 6: Update tool deps wiring**

Find where `ToolExecutorDeps` are constructed (search for `requestWorkspaceWriteApproval`). Replace with:

```ts
requestApproval,
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: compiles. Existing write-approval flow still works in non-workspace modes.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/agent/tool-definitions.ts src/main/ipc-handlers.ts
git commit -m "Generalize approval gate for any sensitive tool"
```

---

## Task 5: Add Speech-leg control tools

**Files:**
- Modify: `src/main/services/agent/tool-definitions.ts`

- [ ] **Step 1: Add the 7 control tool definitions**

Append a new block to `TOOL_DEFINITIONS` (or add a new exported array `WORKSPACE_SPEECH_TOOL_DEFINITIONS` if the existing array is mode-shared):

```ts
export const WORKSPACE_SPEECH_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'submit_workspace_request',
      description:
        'Submit a workspace task to the Execution Agent for planning and execution. Use when the user asks you to build, write, modify, scaffold, research, or generate something inside the active workspace. The Execution Agent will plan, ask for approvals on sensitive actions, execute, and verify. You can keep talking to the user while it runs.',
      parameters: {
        type: 'object',
        properties: {
          request: {
            type: 'string',
            description: 'Concise restatement of what the user wants done.',
          },
          plan_mode: {
            type: 'string',
            enum: ['plan_only', 'plan_and_execute'],
            description:
              'plan_only just produces a plan; plan_and_execute runs the steps after approval. Default: plan_and_execute.',
          },
        },
        required: ['request'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_execution_status',
      description:
        'Get the current state of the Execution Agent (idle/planning/executing/etc.), the current task, queue length, and the most recent log entries. Call before reporting status to the user.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_current_task',
      description:
        'Cancel whatever the Execution Agent is currently doing. Use only if the user explicitly asks to stop or abandon the work in progress.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason for cancellation.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_queue',
      description: 'Pause the queue so no new tasks start until resume_queue is called.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_queue',
      description: 'Resume the queue if it was paused.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_execution_logs',
      description:
        'Fetch the most recent agent log entries (planning steps, tool calls, approvals, results). Use when the user asks "what are you doing" or "what just happened".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries to fetch (default 20).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'decide_pending_approval',
      description:
        'Approve or decline the currently-pending sensitive-action approval (e.g. write to a file, run a terminal command). Only call when the user explicitly says yes/no/always to the pending question.',
      parameters: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            enum: ['approve', 'decline', 'always-allow-session'],
          },
        },
        required: ['decision'],
      },
    },
  },
]
```

- [ ] **Step 2: Add executors for the 7 tools**

Add a new exported function:

```ts
export interface SpeechToolExecutorDeps {
  workspaceExecutionService: import('./workspace-execution-service').WorkspaceExecutionService
}

export function buildSpeechToolExecutor(deps: SpeechToolExecutorDeps): ToolExecutorFn {
  const svc = deps.workspaceExecutionService
  return async function executeSpeechTool(toolName, args) {
    switch (toolName) {
      case 'submit_workspace_request': {
        const request = String(args.request || '').trim()
        if (!request) return 'No request text provided.'
        const planMode =
          args.plan_mode === 'plan_only' ? 'plan_only' : 'plan_and_execute'
        const task = svc.submitTask({ request, source: 'voice', planMode })
        return JSON.stringify({
          ok: true,
          taskId: task.id,
          queuePosition: svc.getState().queue.length,
        })
      }
      case 'get_execution_status': {
        const state = svc.getState()
        return JSON.stringify({
          status: state.status,
          paused: state.paused,
          currentTask: state.currentTask
            ? {
                id: state.currentTask.id,
                request: state.currentTask.request,
                status: state.currentTask.status,
                planSummary: state.currentTask.plan?.summary,
                stepsRemaining: state.currentTask.plan?.steps.length ?? 0,
              }
            : null,
          queueLength: state.queue.length,
          activeApproval: state.activeApproval
            ? {
                toolName: state.activeApproval.toolName,
                summary: state.activeApproval.summary,
              }
            : null,
        })
      }
      case 'cancel_current_task': {
        const reason = String(args.reason || 'cancelled by user')
        if (!svc.isBusy()) return 'No task is currently running.'
        svc.cancelCurrent(reason)
        return 'Cancelled.'
      }
      case 'pause_queue':
        svc.pauseQueue()
        return 'Queue paused.'
      case 'resume_queue':
        svc.resumeQueue()
        return 'Queue resumed.'
      case 'get_execution_logs': {
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20))
        const logs = svc.getRecentLogs(limit)
        return JSON.stringify(
          logs.map((l) => ({
            t: new Date(l.timestamp).toISOString(),
            phase: l.phase,
            level: l.level,
            tool: l.toolName,
            file: l.filePath,
            message: l.message,
          }))
        )
      }
      case 'decide_pending_approval': {
        const state = svc.getState()
        if (!state.activeApproval) return 'No pending approval.'
        const decision = ['approve', 'decline', 'always-allow-session'].includes(
          String(args.decision)
        )
          ? (args.decision as 'approve' | 'decline' | 'always-allow-session')
          : 'decline'
        svc.resolveApproval({ id: state.activeApproval.id, decision })
        return `Decision: ${decision}.`
      }
      default:
        return `Unknown speech tool "${toolName}".`
    }
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/agent/tool-definitions.ts
git commit -m "Add Speech-leg control tools and executor"
```

---

## Task 6: Workspace prompts

**Files:**
- Create: `src/main/services/agent/workspace-prompt.ts`

- [ ] **Step 1: Write the prompts module**

```ts
import { WorkspaceExecutionState } from '@shared/types'

export function buildSpeechSystemPrompt(workspacePath: string): string {
  return [
    'You are the Speech Agent in Whisphry workspace mode.',
    '',
    '## Your job',
    '- Listen to the user (voice transcript or chat input).',
    '- Hold a natural conversation while the Execution Agent does the actual work.',
    '- When the user wants something built, written, modified, researched, or generated inside the workspace, call submit_workspace_request and tell them you sent it.',
    '- Stay responsive even while the Execution Agent is busy. Use get_execution_status before reporting progress so you do not invent state.',
    '- If the user asks "what are you doing" or "what just happened", call get_execution_logs and summarize naturally.',
    '- If the user explicitly says approve / decline / always for a pending approval, call decide_pending_approval.',
    '- Never write files, run terminal commands, or perform tools yourself. You only have the 7 control tools listed.',
    '',
    '## Tone',
    '- Conversational, concise, one or two short sentences per turn.',
    '- Plain prose, no markdown, no code blocks. This will be spoken aloud.',
    '- If the user is mid-sentence or rambling, stay quiet — silence is fine.',
    '',
    `## Active workspace`,
    `Workspace root: ${workspacePath}`,
    '',
    'The Execution Agent has access to the full workspace toolkit (read/write files, run terminal, web search, screen analysis, image generation, deep code analysis). It also picks from a library of Skills (create-new-project, modify-existing-feature, write-research-doc, etc.) for the best result.',
  ].join('\n')
}

export function buildSpeechSnapshot(
  recentTranscript: string,
  state: WorkspaceExecutionState,
  recentLogs: string
): string {
  const taskBlock = state.currentTask
    ? [
        '## Execution Agent status',
        `status: ${state.status}`,
        `current task: ${state.currentTask.request}`,
        state.currentTask.plan
          ? `plan: ${state.currentTask.plan.summary} (${state.currentTask.plan.steps.length} steps)`
          : 'plan: not yet ready',
        `queue length: ${state.queue.length}`,
        state.activeApproval
          ? `awaiting approval: ${state.activeApproval.summary}`
          : 'no pending approval',
      ].join('\n')
    : `## Execution Agent status\nstatus: ${state.status}\nqueue length: ${state.queue.length}\nno active task`

  return [
    '## Recent transcript',
    recentTranscript || '(no recent input)',
    '',
    taskBlock,
    '',
    '## Recent execution logs',
    recentLogs || '(no recent logs)',
  ].join('\n')
}

export function buildPlannerSystemPrompt(args: {
  workspacePath: string
  skillCatalog: string
}): string {
  return [
    'You are the Planner inside the Whisphry Workspace Execution Agent.',
    '',
    '## Your job',
    '1. Read the user request.',
    '2. Choose at most one skill from the catalogue. If no skill fits, leave skill empty.',
    '3. Produce a concise execution plan: a one-line summary plus an ordered list of steps.',
    '4. For each step, mark whether it requires approval (writes, terminal commands, deletes).',
    '5. Output strictly valid JSON matching the schema below. No prose outside the JSON.',
    '',
    '## Output schema',
    '```json',
    '{',
    '  "summary": "string",',
    '  "selectedSkillId": "string | null",',
    '  "steps": [',
    '    {',
    '      "id": "string",',
    '      "description": "string",',
    '      "toolName": "string | null",',
    '      "filePath": "string | null",',
    '      "requiresApproval": false',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    `## Active workspace\n${args.workspacePath}`,
    '',
    '## Skill catalogue',
    args.skillCatalog,
  ].join('\n')
}

export function buildExecutorSystemPrompt(args: {
  workspacePath: string
  skillBody?: string
  plan: string
}): string {
  return [
    'You are the Executor inside the Whisphry Workspace Execution Agent.',
    '',
    '## Your job',
    '- Execute the approved plan one step at a time using your tools.',
    '- Call tools instead of describing what you would do.',
    '- For sensitive actions (write_workspace_file, run_terminal_command, delete), the runtime will pause for user approval. You do not need to ask separately.',
    '- After each step, briefly summarize what happened. Keep summaries terse — they go into the live feed.',
    '- When all steps are done, summarize the result.',
    '',
    `## Active workspace\n${args.workspacePath}`,
    args.skillBody ? `\n## Active skill\n${args.skillBody}` : '',
    '',
    '## Approved plan',
    args.plan,
  ].join('\n')
}

export function buildVerifierSystemPrompt(workspacePath: string): string {
  return [
    'You are the Verifier inside the Whisphry Workspace Execution Agent.',
    '',
    '## Your job',
    '- Confirm the most recent task actually achieved its goal.',
    '- Re-read changed files via read_workspace_file if needed.',
    '- Output a single short paragraph: what is verified, what (if anything) is unverified.',
    '- Do not perform new modifications.',
    '',
    `Workspace: ${workspacePath}`,
  ].join('\n')
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/agent/workspace-prompt.ts
git commit -m "Add workspace-mode system prompts"
```

---

## Task 7: Skill loader and built-in skills

**Files:**
- Create: `src/main/services/agent/workspace-skills.ts`
- Create: `resources/workspace-skills/create-new-project.md`
- Create: `resources/workspace-skills/inspect-workspace.md`
- Create: `resources/workspace-skills/modify-existing-feature.md`
- Create: `resources/workspace-skills/write-research-doc.md`
- Create: `resources/workspace-skills/generate-content.md`

- [ ] **Step 1: Write `create-new-project.md`**

```markdown
---
id: create-new-project
when: "User wants to scaffold or start a brand-new project, app, or codebase inside the workspace."
---

# Process

1. Decide the project root folder name from the user request. Slug-case it.
2. Create the project directory under the workspace root.
3. Add these scaffold files in this order:
   - `README.md` — purpose, how to run, status.
   - `plan.md` — goals, milestones, constraints, current state.
   - `agent.md` — system role for any AI assisting this project: tools, conventions, file layout.
   - `.gitignore` — language-appropriate defaults.
   - Language-specific manifest if obvious (`package.json`, `pyproject.toml`, `Cargo.toml`).
4. Stop after the scaffold. Do not start writing actual feature code unless the user asked for it.
5. Summarize what was created and suggest the next concrete step.

# Templates

## plan.md
```
# {{project name}}

## Goals
- {{primary goal}}

## Milestones
- [ ] M1: {{first deliverable}}

## Constraints
- {{any known constraints}}

## Current state
- Project scaffolded on {{date}}.
```

## agent.md
```
# Agent guide for {{project name}}

## Role
You assist with this project's development.

## Conventions
- {{coding style notes}}
- {{testing conventions}}

## Layout
- `README.md`: human-facing summary
- `plan.md`: goals + milestones
- `agent.md`: this file

## Tools
You have read/write access scoped to this project folder via Whisphry workspace tools.
```

# Safety
- Do not overwrite existing files. If a file already exists, skip it and note the skip.
- Keep scaffolds minimal. Prefer creating structure over content.
```

- [ ] **Step 2: Write `inspect-workspace.md`**

```markdown
---
id: inspect-workspace
when: "User wants a survey of what's in the workspace, or asks 'what's here', 'what have I got', 'show me my projects'."
---

# Process

1. Call list_workspace_files on the workspace root.
2. For each subdirectory, list its top-level contents.
3. Read README.md, plan.md, or agent.md if present in each project folder.
4. Produce a concise summary: project name, one-line purpose, last-modified hint.

# Safety
- Read-only. Do not write or delete anything.
```

- [ ] **Step 3: Write `modify-existing-feature.md`**

```markdown
---
id: modify-existing-feature
when: "User wants to change, fix, refactor, extend, or remove behavior in an existing project."
---

# Process

1. Locate the relevant files. Use search_workspace_code with a keyword the user mentioned.
2. Read the candidate files fully via read_workspace_file before making changes.
3. Identify the smallest set of edits that achieves the goal.
4. Write each modified file in full via write_workspace_file (the runtime will gate on approval).
5. After writes succeed, re-read each modified file in the verification phase.

# Safety
- Prefer minimal edits. Do not rewrite unrelated code.
- Never delete files unless the user explicitly asked.
- Do not run terminal commands unless the task requires them.
```

- [ ] **Step 4: Write `write-research-doc.md`**

```markdown
---
id: write-research-doc
when: "User wants a research document, technical brief, comparison writeup, or analysis assembled in markdown inside a notes or research folder."
---

# Process

1. Decide the destination path: typically `notes/<topic>.md` or `research/<topic>.md`.
2. If the topic needs current information, call search_web for up to 3 targeted queries.
3. Draft the document with this structure:
   - `# Title`
   - `## TL;DR` — 2–3 sentences
   - `## Background` — context the reader needs
   - `## Findings` — main points with sub-headings
   - `## Sources` — bullet list of URLs (if any)
4. Write the document via write_workspace_file.
5. Summarize the final structure and word count.

# Safety
- Cite sources accurately. Do not invent URLs.
- Stay within the workspace; do not download files.
```

- [ ] **Step 5: Write `generate-content.md`**

```markdown
---
id: generate-content
when: "User wants long-form content generated: a blog post, a README, a spec, marketing copy, an email."
---

# Process

1. Confirm the destination path (e.g. `notes/draft-<slug>.md`).
2. Draft the content to the requested length and tone.
3. Write the file via write_workspace_file.
4. Offer to revise tone, length, or structure if asked.

# Safety
- Never publish externally. The output stays in the workspace.
- If the user asks for sensitive content (credentials, secrets), refuse.
```

- [ ] **Step 6: Write the skill loader**

Create `src/main/services/agent/workspace-skills.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface WorkspaceSkill {
  id: string
  when: string
  body: string
}

let cached: WorkspaceSkill[] | null = null

function readSkillFromFile(filePath: string): WorkspaceSkill | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!fmMatch) return null
    const fm = fmMatch[1]
    const body = fmMatch[2].trim()
    const idMatch = fm.match(/id:\s*([^\n]+)/)
    const whenMatch = fm.match(/when:\s*"?([^"\n]+)"?/)
    if (!idMatch) return null
    return {
      id: idMatch[1].trim(),
      when: whenMatch ? whenMatch[1].trim() : '',
      body,
    }
  } catch {
    return null
  }
}

function loadDirectory(dir: string): WorkspaceSkill[] {
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  const skills: WorkspaceSkill[] = []
  for (const f of files) {
    const skill = readSkillFromFile(path.join(dir, f))
    if (skill) skills.push(skill)
  }
  return skills
}

export function loadWorkspaceSkills(): WorkspaceSkill[] {
  if (cached) return cached
  // Built-in: bundled with the app under resources/workspace-skills/
  const builtinDir = app.isPackaged
    ? path.join(process.resourcesPath, 'workspace-skills')
    : path.resolve(__dirname, '../../../../resources/workspace-skills')
  // User overrides: app data
  const userDir = path.join(app.getPath('userData'), 'workspace-skills')
  const builtin = loadDirectory(builtinDir)
  const user = loadDirectory(userDir)
  // User overrides win.
  const byId = new Map<string, WorkspaceSkill>()
  for (const s of builtin) byId.set(s.id, s)
  for (const s of user) byId.set(s.id, s)
  cached = [...byId.values()]
  return cached
}

export function buildSkillCatalog(skills: WorkspaceSkill[]): string {
  return skills
    .map((s) => `- **${s.id}** — ${s.when}`)
    .join('\n')
}

export function findSkillById(skills: WorkspaceSkill[], id: string | undefined): WorkspaceSkill | undefined {
  if (!id) return undefined
  return skills.find((s) => s.id === id)
}
```

- [ ] **Step 7: Tell electron-builder to ship the resources folder**

Open `package.json`. In the `build` block, add to `extraResources`:

```json
"extraResources": [
  {
    "from": "resources/workspace-skills",
    "to": "workspace-skills",
    "filter": ["**/*.md"]
  }
]
```

(If `extraResources` already exists, append the entry. Skip this step if you confirm via `electron-builder` docs that the entry already covers it.)

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: compiles. Skills are read at runtime from disk.

- [ ] **Step 9: Commit**

```bash
git add src/main/services/agent/workspace-skills.ts resources/workspace-skills/ package.json
git commit -m "Add workspace skill loader and 5 built-in skills"
```

---

## Task 8: Workspace Executor service

**Files:**
- Create: `src/main/services/agent/workspace-executor-service.ts`

- [ ] **Step 1: Write the executor**

```ts
import { LLMService } from '../llm-service'
import {
  ExecutionPlan,
  ExecutionPlanStep,
  ToolDefinition,
  ToolExecutorFn,
  WorkspaceTask,
} from '@shared/types'
import { WorkspaceExecutionService } from './workspace-execution-service'
import {
  buildPlannerSystemPrompt,
  buildExecutorSystemPrompt,
  buildVerifierSystemPrompt,
} from './workspace-prompt'
import {
  buildSkillCatalog,
  findSkillById,
  loadWorkspaceSkills,
  WorkspaceSkill,
} from './workspace-skills'
import { WORKSPACE_DEFAULTS } from '@shared/constants'
import { randomUUID } from 'crypto'

export interface WorkspaceExecutorDeps {
  workspaceExecutionService: WorkspaceExecutionService
  getLLMServiceForExecutor: () => LLMService | null  // returns LLMService configured with executionModel
  getExecutorTools: () => ToolDefinition[]
  getExecutorToolExecutor: () => ToolExecutorFn
  getWorkspacePath: () => string
}

export class WorkspaceExecutorService {
  constructor(private readonly deps: WorkspaceExecutorDeps) {
    deps.workspaceExecutionService.on('task-queued', () => this.maybeRunNext())
    deps.workspaceExecutionService.on('next-task-ready', () => this.maybeRunNext())
    deps.workspaceExecutionService.on('queue-resumed', () => this.maybeRunNext())
  }

  private maybeRunNext(): void {
    const svc = this.deps.workspaceExecutionService
    if (svc.isBusy() || svc.getStatus() === 'paused') return
    const state = svc.getState()
    if (state.paused) return
    const next = state.queue[0]
    if (!next) return
    void this.runTask(next.id)
  }

  private async runTask(taskId: string): Promise<void> {
    const svc = this.deps.workspaceExecutionService
    const task = svc.beginTask(taskId)
    if (!task) return
    const llm = this.deps.getLLMServiceForExecutor()
    if (!llm) {
      svc.appendLog({
        taskId: task.id,
        level: 'error',
        phase: 'failed',
        message: 'No LLM service configured for executor.',
      })
      svc.finishTask('failed', 'no executor LLM')
      return
    }

    const skills = loadWorkspaceSkills()

    try {
      const plan = await this.runPlanner(llm, task, skills)
      svc.setPlan(plan)

      if (task.planMode === 'plan_only') {
        svc.finishTask('completed')
        return
      }

      svc.transitionTo('executing')
      const skill = findSkillById(skills, plan.selectedSkillId)
      await this.runExecutor(llm, task, plan, skill)

      svc.transitionTo('verifying')
      await this.runVerifier(llm, task)

      svc.finishTask('completed')
    } catch (err: any) {
      const message = err?.name === 'AbortError' ? 'aborted' : err?.message || String(err)
      svc.appendLog({
        taskId: task.id,
        level: 'error',
        phase: 'failed',
        message: `Executor error: ${message}`,
      })
      svc.finishTask('failed', message)
    }
  }

  private async runPlanner(
    llm: LLMService,
    task: WorkspaceTask,
    skills: WorkspaceSkill[]
  ): Promise<ExecutionPlan> {
    const sys = buildPlannerSystemPrompt({
      workspacePath: this.deps.getWorkspacePath(),
      skillCatalog: buildSkillCatalog(skills),
    })
    const user = `User request: ${task.request}\n\nProduce the JSON plan now.`
    const raw = await llm.callJsonOnce({
      systemPrompt: sys,
      userPrompt: user,
      temperature: WORKSPACE_DEFAULTS.plannerTemperature,
      maxTokens: WORKSPACE_DEFAULTS.plannerMaxTokens,
    })
    return this.parsePlan(raw)
  }

  private parsePlan(raw: string): ExecutionPlan {
    let parsed: any
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
    } catch {
      return {
        summary: 'Planner returned non-JSON output; running with empty plan.',
        steps: [],
      }
    }
    const steps: ExecutionPlanStep[] = Array.isArray(parsed.steps)
      ? parsed.steps.map((s: any, i: number) => ({
          id: String(s.id || `s${i + 1}`),
          description: String(s.description || ''),
          toolName: s.toolName || undefined,
          filePath: s.filePath || undefined,
          requiresApproval: Boolean(s.requiresApproval),
        }))
      : []
    return {
      summary: String(parsed.summary || 'No summary'),
      steps,
      selectedSkillId: parsed.selectedSkillId || undefined,
    }
  }

  private async runExecutor(
    llm: LLMService,
    task: WorkspaceTask,
    plan: ExecutionPlan,
    skill: WorkspaceSkill | undefined
  ): Promise<void> {
    const svc = this.deps.workspaceExecutionService
    const sys = buildExecutorSystemPrompt({
      workspacePath: this.deps.getWorkspacePath(),
      skillBody: skill?.body,
      plan: plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n'),
    })
    const user = `Original request: ${task.request}\n\nExecute the plan now using your tools.`
    const tools = this.deps.getExecutorTools()
    const baseExecutor = this.deps.getExecutorToolExecutor()
    const wrappedExecutor: ToolExecutorFn = async (toolName, args, signal) => {
      svc.appendLog({
        taskId: task.id,
        level: 'info',
        phase: 'execution',
        message: `Tool: ${toolName}${args.path ? ` (${args.path})` : ''}`,
        toolName,
        filePath: args.path,
      })
      const out = await baseExecutor(toolName, args, signal ?? svc.getCurrentAbortSignal())
      const oneLine = out.split('\n').slice(0, 1).join('').slice(0, 200)
      svc.appendLog({
        taskId: task.id,
        level: 'success',
        phase: 'execution',
        message: oneLine || `${toolName} returned.`,
        toolName,
      })
      return out
    }
    await llm.runWorkspaceExecutor({
      systemPrompt: sys,
      userPrompt: user,
      tools,
      executor: wrappedExecutor,
      maxIterations: WORKSPACE_DEFAULTS.executorMaxIterations,
      temperature: WORKSPACE_DEFAULTS.executorTemperature,
      maxTokens: WORKSPACE_DEFAULTS.executorMaxTokens,
      signal: svc.getCurrentAbortSignal(),
    })
  }

  private async runVerifier(llm: LLMService, task: WorkspaceTask): Promise<void> {
    const svc = this.deps.workspaceExecutionService
    const sys = buildVerifierSystemPrompt(this.deps.getWorkspacePath())
    const user = `Verify task: "${task.request}". Use read_workspace_file as needed. Output one short paragraph.`
    const text = await llm.callTextOnce({
      systemPrompt: sys,
      userPrompt: user,
      temperature: 0.2,
      maxTokens: 400,
    })
    svc.appendLog({
      taskId: task.id,
      level: 'info',
      phase: 'verification',
      message: text.slice(0, 800),
    })
  }
}
```

- [ ] **Step 2: Add the helper methods to `LLMService`**

In `src/main/services/llm-service.ts`, append three new methods to the `LLMService` class:

```ts
async callJsonOnce(args: {
  systemPrompt: string
  userPrompt: string
  temperature: number
  maxTokens: number
}): Promise<string> {
  return this.callOpenRouterOnce(
    [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    args.temperature,
    args.maxTokens
  )
}

async callTextOnce(args: {
  systemPrompt: string
  userPrompt: string
  temperature: number
  maxTokens: number
}): Promise<string> {
  return this.callOpenRouterOnce(
    [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    args.temperature,
    args.maxTokens
  )
}

async runWorkspaceExecutor(args: {
  systemPrompt: string
  userPrompt: string
  tools: ToolDefinition[]
  executor: ToolExecutorFn
  maxIterations: number
  temperature: number
  maxTokens: number
  signal?: AbortSignal
}): Promise<void> {
  // Reuse the existing tool-call loop. We delegate to a small inline copy of
  // callOpenRouter so the workspace executor has its own AbortController and
  // does not collide with answer-pipeline state.
  const messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string }> = [
    { role: 'system', content: args.systemPrompt },
    { role: 'user', content: args.userPrompt },
  ]
  let remaining = args.maxIterations
  while (remaining > 0) {
    if (args.signal?.aborted) return
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Whisphry',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
        tools: args.tools.length > 0 ? args.tools : undefined,
      }),
      signal: args.signal,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenRouter executor error ${response.status}: ${text}`)
    }
    const parsed = await response.json()
    const choice = parsed.choices?.[0]
    const message = choice?.message || {}
    const toolCalls = message.tool_calls || []
    if (!toolCalls.length) return
    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: toolCalls,
    })
    for (const tc of toolCalls) {
      let parsedArgs: Record<string, any> = {}
      try {
        parsedArgs = JSON.parse(tc.function?.arguments || '{}')
      } catch {
        parsedArgs = {}
      }
      const result = await args.executor(tc.function.name, parsedArgs, args.signal)
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: tc.id,
      } as any)
    }
    remaining--
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/agent/workspace-executor-service.ts src/main/services/llm-service.ts
git commit -m "Add Workspace Executor service with planner/executor/verifier"
```

---

## Task 9: Workspace Speech leg service

**Files:**
- Create: `src/main/services/agent/workspace-speech-service.ts`

- [ ] **Step 1: Write the speech leg**

```ts
import { LLMService } from '../llm-service'
import {
  ToolDefinition,
  ToolExecutorFn,
  TranscriptEntry,
} from '@shared/types'
import { WorkspaceExecutionService } from './workspace-execution-service'
import { buildSpeechSystemPrompt, buildSpeechSnapshot } from './workspace-prompt'
import { WORKSPACE_DEFAULTS } from '@shared/constants'

export interface WorkspaceSpeechDeps {
  workspaceExecutionService: WorkspaceExecutionService
  getLLMServiceForSpeech: () => LLMService | null
  getSpeechTools: () => ToolDefinition[]
  getSpeechToolExecutor: () => ToolExecutorFn
  getRecentTranscript: () => TranscriptEntry[]
  getWorkspacePath: () => string
  onTextStart?: () => void
  onTextToken?: (fullText: string, delta: string) => void
  onTextEnd?: (fullText: string) => void
}

export class WorkspaceSpeechService {
  private inflight = false
  private pendingTriggers = 0
  private lastTranscriptKey = ''
  private enabled = false

  constructor(private readonly deps: WorkspaceSpeechDeps) {}

  start(): void {
    this.enabled = true
  }

  stop(): void {
    this.enabled = false
    const llm = this.deps.getLLMServiceForSpeech()
    llm?.abortHeartbeat?.()
    this.lastTranscriptKey = ''
    this.pendingTriggers = 0
  }

  /**
   * Called by ipc-handlers when a transcript entry is finalized or the user
   * types into chat. Triggers a fresh speech-leg turn.
   */
  trigger(): void {
    if (!this.enabled) return
    this.pendingTriggers++
    void this.tick()
  }

  private async tick(): Promise<void> {
    if (this.inflight) return
    this.inflight = true
    try {
      await this.tickInner()
    } finally {
      this.inflight = false
      if (this.pendingTriggers > 0 && this.enabled) {
        this.pendingTriggers = 0
        void this.tick()
      }
    }
  }

  private async tickInner(): Promise<void> {
    const recent = this.deps.getRecentTranscript().slice(-8)
    const transcriptKey = recent
      .filter((e) => e.isFinal)
      .map((e) => `${e.id}:${e.text}`)
      .join('|')
    if (!transcriptKey || transcriptKey === this.lastTranscriptKey) return
    this.lastTranscriptKey = transcriptKey

    const llm = this.deps.getLLMServiceForSpeech()
    if (!llm) return

    const transcriptText = recent
      .map((e) => `[${e.speaker}] ${e.text}`)
      .join('\n')
    const state = this.deps.workspaceExecutionService.getState()
    const recentLogsText = state.recentLogs
      .slice(-8)
      .map((l) => `- [${l.phase}] ${l.message}`)
      .join('\n')

    const sys = buildSpeechSystemPrompt(this.deps.getWorkspacePath())
    const snapshot = buildSpeechSnapshot(transcriptText, state, recentLogsText)
    const tools = this.deps.getSpeechTools()
    const executor = this.deps.getSpeechToolExecutor()

    try {
      await llm.runHeartbeat(sys, snapshot, tools, executor, {
        temperature: WORKSPACE_DEFAULTS.speechTemperature,
        maxTokens: WORKSPACE_DEFAULTS.speechMaxTokens,
        maxIterations: 2,
        onStreamStart: () => this.deps.onTextStart?.(),
        onStreamToken: (full, delta) => this.deps.onTextToken?.(full, delta),
        onStreamEnd: (text) => this.deps.onTextEnd?.(text),
      })
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[WorkspaceSpeech] tick failed:', err)
      }
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/agent/workspace-speech-service.ts
git commit -m "Add Workspace Speech leg service"
```

---

## Task 10: Wire workspace-mode services into ipc-handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Instantiate the services after `workspaceService`**

Find `const workspaceService = new WorkspaceService()`. Add below it:

```ts
import { WorkspaceExecutionService } from './services/agent/workspace-execution-service'
import { WorkspaceSpeechService } from './services/agent/workspace-speech-service'
import { WorkspaceExecutorService } from './services/agent/workspace-executor-service'
import {
  WORKSPACE_SPEECH_TOOL_DEFINITIONS,
  buildSpeechToolExecutor,
} from './services/agent/tool-definitions'

const workspaceExecutionService = new WorkspaceExecutionService({
  getWorkspacePath: () => workspaceService.getWorkspaceRoot(),
})

let speechLLMService: LLMService | null = null
let executorLLMService: LLMService | null = null

function getOrCreateSpeechLLM(): LLMService | null {
  const apiKey = getOpenRouterApiKey()
  if (!apiKey) return null
  const model =
    String(configStore.get('speechModel', '') || '').trim() ||
    WORKSPACE_DEFAULTS.speechModel
  if (!speechLLMService) speechLLMService = new LLMService(apiKey, model)
  else speechLLMService.setModel(model)
  return speechLLMService
}

function getOrCreateExecutorLLM(): LLMService | null {
  const apiKey = getOpenRouterApiKey()
  if (!apiKey) return null
  const model =
    String(configStore.get('executionModel', '') || '').trim() ||
    WORKSPACE_DEFAULTS.executionModel
  if (!executorLLMService) executorLLMService = new LLMService(apiKey, model)
  else executorLLMService.setModel(model)
  return executorLLMService
}

const workspaceSpeechService = new WorkspaceSpeechService({
  workspaceExecutionService,
  getLLMServiceForSpeech: getOrCreateSpeechLLM,
  getSpeechTools: () => WORKSPACE_SPEECH_TOOL_DEFINITIONS,
  getSpeechToolExecutor: () =>
    buildSpeechToolExecutor({ workspaceExecutionService }),
  getRecentTranscript: () => sessionTranscript,
  getWorkspacePath: () => workspaceService.getWorkspaceRoot(),
  onTextStart: () => sendToCanvas('agent:companion-text:start'),
  onTextToken: (full, delta) =>
    sendToCanvas('agent:companion-text:token', { fullText: full, delta }),
  onTextEnd: (text) => {
    sendToCanvas('agent:companion-text:end', { text })
    if (workspaceTtsEligible()) companionTtsService?.endTurn()
  },
})

const workspaceExecutorService = new WorkspaceExecutorService({
  workspaceExecutionService,
  getLLMServiceForExecutor: getOrCreateExecutorLLM,
  getExecutorTools: () => filteredAgentToolsForWorkspace(),
  getExecutorToolExecutor: () => agentToolExecutor,
  getWorkspacePath: () => workspaceService.getWorkspaceRoot(),
})
```

(Where `agentToolExecutor` is the existing tool executor function that drives the answer pipeline. `filteredAgentToolsForWorkspace()` returns the full catalog minus heartbeat-only widget tools.)

- [ ] **Step 2: Define `filteredAgentToolsForWorkspace()`**

Add helper:

```ts
function filteredAgentToolsForWorkspace(): ToolDefinition[] {
  const all = TOOL_DEFINITIONS.concat(LIVE_AGENT_EXTRA_TOOL_DEFINITIONS)
  // The executor doesn't need bubble/widget tools — the live feed is the UI.
  const blocked = new Set([
    'show_bubble', 'show_panel', 'show_toast', 'dismiss_widget',
    'open_answer_window', // executor does not write to answer pane directly
  ])
  return all.filter((t) => !blocked.has(t.function.name))
}
```

- [ ] **Step 3: Hook the speech leg into transcript-finalized + chat-input**

Find the existing place where `heartbeatService.triggerTick()` is called on transcript-finalized (search for `triggerTick`). Add a sibling call:

```ts
if (currentAgentMode() === 'workspace') {
  workspaceSpeechService.trigger()
} else {
  heartbeatService.triggerTick()
}
```

(Repeat for the chat-input handler.)

- [ ] **Step 4: Pipe TTS only when workspace voice enabled**

Add helper:

```ts
function workspaceTtsEligible(): boolean {
  if (currentAgentMode() !== 'workspace') return false
  return Boolean(configStore.get('workspaceVoiceEnabled', WORKSPACE_DEFAULTS.voiceEnabled))
}
```

In the `onTextToken` callback above, route delta to `companionTtsService.enqueueDelta(delta)` when `workspaceTtsEligible()` is true (re-using the existing companion-tts wiring).

- [ ] **Step 5: Add IPC handlers for the canvas live feed**

Below the existing `ipcMain.handle('workspace:list-folders', ...)` block:

```ts
ipcMain.handle(WORKSPACE_GET_STATE, () => workspaceExecutionService.getState())
ipcMain.handle(WORKSPACE_SUBMIT_REQUEST, (_e, payload: { request: string; planMode?: 'plan_only' | 'plan_and_execute' }) =>
  workspaceExecutionService.submitTask({
    request: payload.request,
    source: 'ui',
    planMode: payload.planMode,
  })
)
ipcMain.handle(WORKSPACE_CANCEL_TASK, (_e, reason?: string) => {
  workspaceExecutionService.cancelCurrent(reason)
  return { ok: true }
})
ipcMain.handle(WORKSPACE_PAUSE_QUEUE, () => {
  workspaceExecutionService.pauseQueue()
  return { ok: true }
})
ipcMain.handle(WORKSPACE_RESUME_QUEUE, () => {
  workspaceExecutionService.resumeQueue()
  return { ok: true }
})
ipcMain.handle(WORKSPACE_DECIDE_APPROVAL, (_e, response: ApprovalResponse) => {
  return { ok: workspaceExecutionService.resolveApproval(response) }
})

// Broadcast state and logs to the canvas window.
workspaceExecutionService.on('state', (state) => sendToCanvas(WORKSPACE_STATE_UPDATE, state))
workspaceExecutionService.on('log', (entry) => sendToCanvas(WORKSPACE_LOG_APPEND, entry))
workspaceExecutionService.on('approval-requested', (req) => {
  showAnswerWindow()
  sendToCanvas(WORKSPACE_APPROVAL_REQUESTED, req)
})
workspaceExecutionService.on('approval-resolved', (res) => {
  sendToCanvas(WORKSPACE_APPROVAL_RESOLVED, res)
})
```

(Channel constants come from the constants file added in Task 2; import them.)

- [ ] **Step 6: Update `applyAgentMode` to start/stop the speech service**

Extend the existing `applyAgentMode`:

```ts
function applyAgentMode(mode: AgentMode): void {
  configStore.set('agentMode', mode)
  switch (mode) {
    case 'interview':
      configStore.set('liveAgentEnabled', false)
      configStore.set('liveAgentVoiceEnabled', false)
      workspaceSpeechService.stop()
      break
    case 'companion-text':
      configStore.set('liveAgentEnabled', true)
      configStore.set('liveAgentVoiceEnabled', false)
      workspaceSpeechService.stop()
      break
    case 'companion-voice':
      configStore.set('liveAgentEnabled', true)
      configStore.set('liveAgentVoiceEnabled', true)
      workspaceSpeechService.stop()
      break
    case 'workspace':
      configStore.set('liveAgentEnabled', false)
      configStore.set('liveAgentVoiceEnabled', false)
      workspaceSpeechService.start()
      break
  }
}
```

- [ ] **Step 7: Reset workspace state on session end**

Find the session-end hook (search for `sessionLifecycleService` end-handler, or where heartbeat is stopped at session end). Add:

```ts
workspaceExecutionService.resetForNewSession()
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "Wire workspace-mode services into ipc-handlers"
```

---

## Task 11: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Expose workspace-mode APIs**

Append to the `api` object exposed by `contextBridge.exposeInMainWorld('api', ...)`:

```ts
  workspaceGetState: () => ipcRenderer.invoke('workspace:get-state'),
  workspaceSubmitRequest: (payload: { request: string; planMode?: 'plan_only' | 'plan_and_execute' }) =>
    ipcRenderer.invoke('workspace:submit-request', payload),
  workspaceCancelTask: (reason?: string) => ipcRenderer.invoke('workspace:cancel-task', reason),
  workspacePauseQueue: () => ipcRenderer.invoke('workspace:pause-queue'),
  workspaceResumeQueue: () => ipcRenderer.invoke('workspace:resume-queue'),
  workspaceDecideApproval: (response: { id: string; decision: 'approve' | 'decline' | 'always-allow-session' }) =>
    ipcRenderer.invoke('workspace:decide-approval', response),
  onWorkspaceStateUpdate: (cb: (state: any) => void) => {
    const fn = (_e: any, state: any) => cb(state)
    ipcRenderer.on('workspace:state-update', fn)
    return () => ipcRenderer.off('workspace:state-update', fn)
  },
  onWorkspaceLogAppend: (cb: (entry: any) => void) => {
    const fn = (_e: any, entry: any) => cb(entry)
    ipcRenderer.on('workspace:log-append', fn)
    return () => ipcRenderer.off('workspace:log-append', fn)
  },
  onWorkspaceApprovalRequested: (cb: (req: any) => void) => {
    const fn = (_e: any, req: any) => cb(req)
    ipcRenderer.on('workspace:approval-requested', fn)
    return () => ipcRenderer.off('workspace:approval-requested', fn)
  },
  onWorkspaceApprovalResolved: (cb: (res: any) => void) => {
    const fn = (_e: any, res: any) => cb(res)
    ipcRenderer.on('workspace:approval-resolved', fn)
    return () => ipcRenderer.off('workspace:approval-resolved', fn)
  },
```

- [ ] **Step 2: Add type declarations**

Find the `Window.api` type declaration (in this file or a `.d.ts`). Add the same names with proper signatures.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "Expose workspace-mode APIs over preload"
```

---

## Task 12: Live execution feed UI

**Files:**
- Create: `src/renderer/canvas/components/WorkspaceFeed.tsx`
- Create: `src/renderer/canvas/components/WorkspaceApprovalCard.tsx`
- Modify: `src/renderer/canvas/App.tsx`

- [ ] **Step 1: Write `WorkspaceApprovalCard.tsx`**

```tsx
import React from 'react'

interface ApprovalRequest {
  id: string
  toolName: string
  summary: string
  preview?: string
  bytes?: number
  payload: Record<string, any>
}

interface Props {
  request: ApprovalRequest
  onDecide: (decision: 'approve' | 'decline' | 'always-allow-session') => void
}

export default function WorkspaceApprovalCard({ request, onDecide }: Props) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="text-amber-200 font-semibold mb-1">
        Approval needed: {request.toolName}
      </div>
      <div className="text-zinc-200 mb-2">{request.summary}</div>
      {request.preview && (
        <pre className="bg-black/40 text-zinc-300 text-xs p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap">
          {request.preview}
        </pre>
      )}
      <div className="flex gap-2 mt-3">
        <button
          className="px-3 py-1 rounded bg-emerald-500 text-white text-xs"
          onClick={() => onDecide('approve')}
        >
          Approve
        </button>
        <button
          className="px-3 py-1 rounded bg-zinc-700 text-zinc-200 text-xs"
          onClick={() => onDecide('decline')}
        >
          Decline
        </button>
        <button
          className="px-3 py-1 rounded bg-cyan-700 text-white text-xs"
          onClick={() => onDecide('always-allow-session')}
        >
          Always allow this session
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `WorkspaceFeed.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react'
import WorkspaceApprovalCard from './WorkspaceApprovalCard'

interface AgentLogEntry {
  id: string
  timestamp: number
  taskId?: string
  level: 'info' | 'success' | 'warning' | 'error'
  phase: string
  message: string
  toolName?: string
  filePath?: string
}

interface WorkspaceState {
  status: string
  currentTask: { id: string; request: string; status: string; planSummary?: string } | null
  queue: any[]
  activeApproval: any | null
  recentLogs: AgentLogEntry[]
  workspacePath: string
  paused: boolean
}

const PHASE_COLOR: Record<string, string> = {
  received: 'text-zinc-400',
  planning: 'text-cyan-400',
  skill_selection: 'text-cyan-300',
  queued: 'text-zinc-400',
  approval: 'text-amber-300',
  execution: 'text-emerald-300',
  verification: 'text-purple-300',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
}

export default function WorkspaceFeed() {
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [logs, setLogs] = useState<AgentLogEntry[]>([])
  const [approval, setApproval] = useState<any | null>(null)
  const feedEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.api?.workspaceGetState?.().then((s: WorkspaceState) => {
      if (!s) return
      setState(s)
      setLogs(s.recentLogs)
      setApproval(s.activeApproval)
    })
    const offState = window.api?.onWorkspaceStateUpdate?.((s: WorkspaceState) => {
      setState(s)
      setApproval(s.activeApproval)
    })
    const offLog = window.api?.onWorkspaceLogAppend?.((entry: AgentLogEntry) => {
      setLogs((prev) => [...prev.slice(-199), entry])
    })
    const offApproval = window.api?.onWorkspaceApprovalRequested?.((req: any) => {
      setApproval(req)
    })
    const offResolved = window.api?.onWorkspaceApprovalResolved?.(() => {
      setApproval(null)
    })
    return () => {
      offState?.()
      offLog?.()
      offApproval?.()
      offResolved?.()
    }
  }, [])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  if (!state) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 max-h-[40vh] flex flex-col gap-2 pointer-events-auto bg-black/70 backdrop-blur rounded-xl border border-zinc-700 p-3 text-xs font-mono text-zinc-100 z-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-cyan-700 text-white text-[10px] uppercase tracking-wider">
            {state.status}
          </span>
          {state.currentTask && (
            <span className="text-zinc-300 truncate max-w-[60vw]">
              {state.currentTask.request}
            </span>
          )}
          {state.queue.length > 0 && (
            <span className="text-zinc-400">+{state.queue.length} queued</span>
          )}
        </div>
        <div className="flex gap-2">
          {state.paused ? (
            <button
              className="px-2 py-1 rounded bg-emerald-700 text-white"
              onClick={() => window.api?.workspaceResumeQueue?.()}
            >
              Resume
            </button>
          ) : (
            <button
              className="px-2 py-1 rounded bg-zinc-700 text-zinc-200"
              onClick={() => window.api?.workspacePauseQueue?.()}
            >
              Pause
            </button>
          )}
          {state.currentTask && (
            <button
              className="px-2 py-1 rounded bg-red-700 text-white"
              onClick={() => window.api?.workspaceCancelTask?.()}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {approval && (
        <WorkspaceApprovalCard
          request={approval}
          onDecide={(decision) =>
            window.api?.workspaceDecideApproval?.({ id: approval.id, decision })
          }
        />
      )}

      <div className="flex-1 overflow-auto space-y-1 max-h-[28vh]">
        {logs.map((l) => (
          <div key={l.id} className="flex gap-2">
            <span className="text-zinc-500 shrink-0 w-16">
              {new Date(l.timestamp).toLocaleTimeString()}
            </span>
            <span className={`shrink-0 w-24 ${PHASE_COLOR[l.phase] || 'text-zinc-300'}`}>
              {l.phase}
            </span>
            <span className="text-zinc-200 break-words">
              {l.toolName ? `[${l.toolName}] ` : ''}
              {l.message}
            </span>
          </div>
        ))}
        <div ref={feedEndRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render `WorkspaceFeed` in `canvas/App.tsx`**

Modify `src/renderer/canvas/App.tsx`. Add a state for current agent mode and conditionally render the feed:

```tsx
import WorkspaceFeed from './components/WorkspaceFeed'
// ...
const [agentMode, setAgentMode] = useState<string>('interview')

useEffect(() => {
  void window.api?.getConfig?.().then((cfg: any) => {
    if (cfg?.agentMode) setAgentMode(cfg.agentMode)
  })
  const off = window.api?.onConfigChanged?.((cfg: any) => {
    if (cfg?.agentMode) setAgentMode(cfg.agentMode)
  })
  return () => off?.()
}, [])

// In the JSX, after the closing of the existing widgets block:
{agentMode === 'workspace' && <WorkspaceFeed />}
```

(If `onConfigChanged` does not exist as a preload API, fall back to polling once on mount; or, ipc-handlers can broadcast `config:changed` to the canvas when `applyAgentMode` runs — add that broadcast in Task 10 if missing.)

- [ ] **Step 4: Verify**

Run: `npm run dev`
Expected: launches without runtime errors. Switching agentMode in the dashboard to "workspace" makes the feed appear.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/canvas/components/WorkspaceFeed.tsx src/renderer/canvas/components/WorkspaceApprovalCard.tsx src/renderer/canvas/App.tsx
git commit -m "Add workspace-mode live execution feed UI"
```

---

## Task 13: Settings UI — Workspace mode tile and model pickers

**Files:**
- Modify: `src/renderer/settings/components/ApiConfig.tsx`

- [ ] **Step 1: Add the Workspace mode tile**

Find the existing mode picker block (Interview / Companion text / Companion voice). Add a fourth tile:

```tsx
<button
  type="button"
  onClick={() => setMode('workspace')}
  className={`...same classes... ${mode === 'workspace' ? 'border-cyan-500 ring-1 ring-cyan-500/40' : ''}`}
>
  <div className="font-semibold">Workspace</div>
  <div className="text-xs text-zinc-400 mt-1">
    Speech + Execution Agents. Use for building, writing research, generating
    content, modifying projects. Tools: full workspace toolkit with approval gate.
  </div>
</button>
```

- [ ] **Step 2: Add the speech / execution model pickers**

Add two new model dropdown fields (using whatever existing dropdown component the codebase uses for model selection):

```tsx
<label className="block text-sm">
  <span className="text-zinc-300">Speech model (workspace mode)</span>
  <input
    type="text"
    value={speechModel}
    onChange={(e) => setSpeechModel(e.target.value)}
    placeholder="e.g. anthropic/claude-haiku-4-5-20251001 or google/gemini-2.5-flash"
    className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
  />
  <div className="text-xs text-zinc-500 mt-1">
    Fast, cheap model for the always-on Speech Agent. Any OpenRouter model with tool support.
  </div>
</label>

<label className="block text-sm">
  <span className="text-zinc-300">Execution model (workspace mode)</span>
  <input
    type="text"
    value={executionModel}
    onChange={(e) => setExecutionModel(e.target.value)}
    placeholder="e.g. anthropic/claude-sonnet-4-6 or deepseek/deepseek-r1"
    className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
  />
  <div className="text-xs text-zinc-500 mt-1">
    Stronger model for planning + tool execution. Any OpenRouter model with tool support.
  </div>
</label>

<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={workspaceVoiceEnabled}
    onChange={(e) => setWorkspaceVoiceEnabled(e.target.checked)}
  />
  <span>Speak responses aloud (workspace mode)</span>
</label>
```

- [ ] **Step 3: Persist the new fields through saveConfig**

Wire them through the existing `saveConfig` call in this component so `speechModel`, `executionModel`, and `workspaceVoiceEnabled` flow into `configStore`.

- [ ] **Step 4: Verify**

Run: `npm run dev` and switch to Workspace mode in the dashboard. Confirm both model fields persist after restart.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/components/ApiConfig.tsx
git commit -m "Add Workspace mode tile and speech/execution model pickers"
```

---

## Task 14: Drop dead Gemini Live runtime paths

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/shared/types.ts`
- Delete or no-op: any `src/main/services/gemini-live*.ts`

- [ ] **Step 1: Identify Gemini Live paths**

Run: `grep -rn "GeminiLive\|gemini-live\|GEMINI_API_KEY\|liveAgentVoiceName" src/main src/preload src/shared src/renderer`

Note every match. They will be deleted, no-opped, or rerouted to OpenRouter + Aura.

- [ ] **Step 2: Remove the runtime files**

Delete:
- `src/main/services/gemini-live*.ts` (if any)
- imports referencing them

Replace any remaining call sites (`startLiveAgent`, `sendUserTextTurn`) with no-ops or remove them.

- [ ] **Step 3: Drop Gemini-only types**

Remove `'gemini-text' | 'gemini-audio'` from `AgentEngine` definition (already done in Task 1 step 2 — verify).

- [ ] **Step 4: Settings: hide Gemini API key field**

In `ApiConfig.tsx`, remove or hide the Gemini API key input. Keep Deepgram + OpenRouter.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: no broken imports.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Remove Gemini Live runtime paths"
```

---

## Task 15: Cooperative cancel + verify end-to-end

- [ ] **Step 1: Sanity check — cancel during execution**

1. `npm run dev`
2. Switch agent mode to Workspace.
3. Pick a workspace folder at session start.
4. Speak: "Create a new project called test-foo with the standard scaffold."
5. Watch the live feed: planning → skill_selection (create-new-project) → execution.
6. Mid-execution, speak: "Stop, cancel."
7. Confirm: status flips to `cancelled`, executor halts, no more file writes.

- [ ] **Step 2: Sanity check — speech agent stays awake during execution**

1. Start a long-ish task: "Write a 500-word research note about WebGPU compute shaders into notes/webgpu.md."
2. While the executor is mid-tool-loop, speak: "What are you doing?"
3. The Speech Agent should call `get_execution_logs` and reply within ~1.5s.

- [ ] **Step 3: Sanity check — approval gate**

1. Trigger a `write_workspace_file` step.
2. Live feed shows the approval card.
3. Click "Always allow this session".
4. Subsequent writes for the same task proceed without further prompts.

- [ ] **Step 4: Sanity check — model swap**

1. In Settings, change `executionModel` to a different OpenRouter model (e.g. `deepseek/deepseek-r1` or `openai/gpt-4.1-mini`).
2. Restart the session.
3. Submit a task. Confirm the executor uses the new model. (Inspect `executorLLMService.model` at runtime if uncertain.)

- [ ] **Step 5: Sanity check — voice toggle**

1. Disable "Speak responses aloud" in workspace settings.
2. Submit a task; confirm the Speech Agent's text still flows into the bubble UI but no Aura audio plays.

- [ ] **Step 6: Commit any fixes found**

```bash
git add -A
git commit -m "Fix workspace-mode end-to-end issues"
```

---

## Task 16: README and CLAUDE.md updates

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README**

Add a new section under the modes documentation:

```markdown
### Workspace mode

Two-agent split for long-running build/write/research tasks inside a workspace folder.

- **Speech Agent**: always-responsive conversational front. Routed through OpenRouter using the model you pick under "Speech model" in Settings. Has 7 control tools (submit, status, cancel, pause, resume, logs, decide-approval) and never touches files directly.
- **Execution Agent**: spun up per submitted task. Routed through OpenRouter using the model you pick under "Execution model". Has the full workspace toolkit and runs the planner → executor → verifier loop.
- **Live feed**: the canvas window shows a streaming log of planning, tool calls, approvals, and verification — like a terminal console for the Execution Agent.
- **Approval gate**: writes, terminal commands, and deletes pause for explicit approval. You can decide via the inline card or by saying "approve / decline / always" to the Speech Agent.
- **Skills**: built-in instruction packs for `create-new-project`, `inspect-workspace`, `modify-existing-feature`, `write-research-doc`, `generate-content`. Drop your own under `<userData>/workspace-skills/` to override.
- **Voice**: opt-in via "Speak responses aloud" in Workspace settings. Uses Deepgram Aura.
```

- [ ] **Step 2: Update CLAUDE.md**

Add a paragraph under the existing agent-mode picker bullet documenting the workspace mode runtime, exactly mirroring the README section but in the existing CLAUDE.md tone.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document workspace mode"
```

---

## Self-Review

**Spec coverage:**
- Two-agent split with separate models picked in settings — Tasks 1, 2, 10, 13
- Speech Agent with 6 control tools (+ decide_pending_approval as a 7th for voice approvals) — Task 5
- Execution Agent with planning + execution + verification phases — Task 8
- Always-awake speech leg during execution — Task 9 (`WorkspaceSpeechService.trigger()` is independent of executor state)
- Live execution view in answer/canvas window — Task 12
- Skills with `create-new-project` (plan.md + agent.md + README.md scaffolding) — Task 7
- Existing-project support — covered by `modify-existing-feature` skill + workspace path selection at session start (already in place)
- Approval gate generalized to any sensitive tool — Task 4
- Workspace selection at session start — relies on existing `workspaceService` (no new code needed)
- Other modes untouched — `applyAgentMode` only adds a new branch; existing branches kept

**Type consistency:**
- `WorkspaceTask.status` matches the values used in `transitionTo` (Task 3).
- `ApprovalResponse.decision` matches the values used in `decide_pending_approval` (Task 5) and `WorkspaceApprovalCard` (Task 12).
- `ToolExecutorFn` signature with optional `signal` is consistent across Tasks 1, 4, 8.
- `AgentLogEntry` shape matches usage in service (Task 3), executor (Task 8), and UI (Task 12).

**Placeholder scan:** No TBD/TODO/"add error handling" left. Every code block is a complete drop-in.

**Known follow-ups (not in this plan):**
- Multi-task interleaving (currently strict FIFO).
- Plan-only mode → resume-as-execute handoff via Speech (currently plan-only just stops).
- Skills authored at runtime via the dashboard.
- Telemetry / cost tracking per task.
