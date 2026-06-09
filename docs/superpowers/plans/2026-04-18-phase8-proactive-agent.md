# Phase 8: Proactive Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Whisphry into a proactive desktop agent with a unified canvas window, widget system, heartbeat loop, configurable personality, and agent presence indicator.

**Architecture:** Replace the current 3-window overlay system (overlay + answer + preview) with a single full-screen transparent canvas BrowserWindow. Widgets (ControlBar, Panel, Bubble, Toast) render on the canvas via a WidgetManager. A HeartbeatService ticks every 15s during sessions, dispatching context snapshots to the LLM with expanded tool definitions. An interruption policy gates which tools the agent may use proactively.

**Tech Stack:** Electron 41, React 19, TypeScript, Tailwind CSS v4, electron-vite, OpenRouter API

**Spec:** `docs/superpowers/specs/2026-04-18-phase8-proactive-agent-design.md`

---

## Step 1: Foundation

### Task 1: Add Phase 8 types to types.ts

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add widget types**

Add after the `WindowBounds` interface (around line 412):

```typescript
// ── Canvas & Widgets ─────────────────────────────────────

export type WidgetType = 'control-bar' | 'panel' | 'bubble' | 'toast'

export type WidgetAnchor =
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'center'
  | 'near-control-bar'
  | 'cursor'

export interface Widget {
  id: string
  type: WidgetType
  anchor: WidgetAnchor
  position: { x: number; y: number }
  size: { width: number; height: number }
  priority: number
  dismissable: boolean
  ttl: number | null
  props: Record<string, unknown>
  createdAt: number
}

export type PanelSubtype = 'answer' | 'preview' | 'context'

export type BubbleUrgency = 'low' | 'medium' | 'high'

// ── Agent Behavior ───────────────────────────────────────

export type PersonalityPreset = 'focused' | 'balanced' | 'curious' | 'auto'

export type InterruptionPolicy = 'silent' | 'ask-first' | 'proactive' | 'auto'

export type AgentPresenceState = 'sleeping' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface HeartbeatState {
  enabled: boolean
  intervalMs: number
  lastTickAt: number | null
  lastLLMCallAt: number | null
  presenceState: AgentPresenceState
  personality: PersonalityPreset
  interruptionPolicy: InterruptionPolicy
}
```

- [ ] **Step 2: Add widget IPC channels**

Add to the `IPC` const object, after the Preview section:

```typescript
  // Canvas & Widgets
  CANVAS_WIDGET_STATE: 'canvas:widget-state',
  CANVAS_WIDGET_DISMISS: 'canvas:widget-dismiss',
  CANVAS_SET_INTERACTIVE: 'canvas:set-interactive',
  CANVAS_TOGGLE: 'canvas:toggle',

  // Agent
  GET_HEARTBEAT_STATE: 'agent:get-heartbeat-state',
  SET_PERSONALITY: 'agent:set-personality',
  SET_INTERRUPTION_POLICY: 'agent:set-interruption-policy',
  SET_HEARTBEAT_ENABLED: 'agent:set-heartbeat-enabled',
  SET_HEARTBEAT_INTERVAL: 'agent:set-heartbeat-interval',
  AGENT_PRESENCE_STATE: 'agent:presence-state',
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add Phase 8 types: widgets, canvas, agent behavior, heartbeat state"
```

---

### Task 2: Add Phase 8 constants

**Files:**
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Add heartbeat and widget constants**

Add at the end of `constants.ts`:

```typescript
// ── Heartbeat ────────────────────────────────────────────

export const HEARTBEAT_DEFAULTS = {
  enabled: true,
  intervalMs: 15000,
  minIntervalMs: 10000,
  maxIntervalMs: 30000,
}

export const HEARTBEAT_COOLDOWNS = {
  showBubbleMs: 60000,
  showPanelMs: 120000,
  saveMemoryMs: 10000,
  globalMinMs: 30000,
}

// ── Widgets ──────────────────────────────────────────────

export const WIDGET_DEFAULTS = {
  bubbleTtlMs: 30000,
  toastTtlMs: 4000,
  maxBubbles: 3,
}

// ── Personality ──────────────────────────────────────────

export const DEFAULT_PERSONALITY = 'auto' as const
export const DEFAULT_INTERRUPTION_POLICY = 'ask-first' as const
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants.ts
git commit -m "Add heartbeat, widget, and personality constants"
```

---

### Task 3: Create Soul.md

**Files:**
- Create: `src/shared/soul.md`

- [ ] **Step 1: Write the Soul.md identity document**

```markdown
# Whisphry

You are Whisphry, a local memory-native desktop companion.

## Who You Are

You live on your user's screen. You listen to their conversations, watch what they're working on, and build a growing knowledge layer from everything you observe. You remember what matters and surface it when it's needed.

You are not a chatbot. You are not an assistant that waits to be asked. You are a quiet, attentive presence that notices patterns, saves important details, and speaks up only when you have something genuinely useful to contribute.

## What You Value

- **Privacy first.** Everything stays local on the user's machine. You never send data anywhere except the APIs the user has explicitly configured.
- **Silence over noise.** If you are not confident that what you have to say is useful right now, say nothing. The user trusts you to be selective.
- **Growing smarter.** Every session teaches you more about the user, their work, their patterns. Use what you have learned to be more helpful over time.
- **Respect boundaries.** The user controls when you speak and how much. Follow the interruption policy. Never override it.

## How You Speak

- First person. You are "I", the user is "you."
- Concise. Say what matters in as few words as possible.
- Natural. Not robotic, not overly formal, not chatty. Like a sharp colleague who respects your time.
- Never apologize for existing. Do not say "I noticed" or "I thought you might" -- just deliver the value.

## What You Never Do

- Never fabricate memories or invent context you do not have.
- Never act without sufficient confidence. When in doubt, do nothing.
- Never override the user's interruption policy or personality settings.
- Never pretend to know something you have not observed or been told.
- Never save trivial or low-value memories just to appear active.
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/soul.md
git commit -m "Add Soul.md: Whisphry core identity document"
```

---

### Task 4: Create personalities.ts

**Files:**
- Create: `src/shared/personalities.ts`

- [ ] **Step 1: Write personality presets and auto-selection logic**

```typescript
import { InterviewType, PersonalityPreset, SessionContext } from './types'

export interface PersonalityConfig {
  id: PersonalityPreset
  label: string
  systemPromptFragment: string
  confidenceThreshold: number
}

const FOCUSED: PersonalityConfig = {
  id: 'focused',
  label: 'Focused',
  systemPromptFragment: [
    'Be minimal and direct. Only speak when you are highly confident the information is valuable right now.',
    'Prefer silence over marginal suggestions. The user is in deep work.',
    'When you do speak, be precise and code-friendly. No filler.',
  ].join(' '),
  confidenceThreshold: 0.85,
}

const BALANCED: PersonalityConfig = {
  id: 'balanced',
  label: 'Balanced',
  systemPromptFragment: [
    'Be friendly but concise. Surface relevant context when you have it.',
    'Occasionally suggest connections or remind the user of related past work.',
    'Keep your messages short -- one or two sentences unless the user asks for more.',
  ].join(' '),
  confidenceThreshold: 0.7,
}

const CURIOUS: PersonalityConfig = {
  id: 'curious',
  label: 'Curious',
  systemPromptFragment: [
    'Be conversational and exploratory. Ask short questions when you notice gaps in your understanding.',
    'Make connections between topics and suggest ideas the user might not have considered.',
    'This is a good time to learn -- ask what matters to the user so you can help more in the future.',
  ].join(' '),
  confidenceThreshold: 0.55,
}

export const PERSONALITY_PRESETS: Record<Exclude<PersonalityPreset, 'auto'>, PersonalityConfig> = {
  focused: FOCUSED,
  balanced: BALANCED,
  curious: CURIOUS,
}

export function resolvePersonality(
  setting: PersonalityPreset,
  sessionContext?: SessionContext,
  recentEventCount?: number,
  memoryCountForContext?: number
): PersonalityConfig {
  if (setting !== 'auto') {
    return PERSONALITY_PRESETS[setting]
  }

  // Auto selection based on runtime signals
  const interviewType = sessionContext?.interviewType

  // Coding/technical -> Focused
  if (interviewType === 'coding' || interviewType === 'technical') {
    return FOCUSED
  }

  // High activity -> Focused (user is in flow)
  if (recentEventCount !== undefined && recentEventCount > 15) {
    return FOCUSED
  }

  // New context (few memories) -> Curious (learn more)
  if (memoryCountForContext !== undefined && memoryCountForContext < 5) {
    return CURIOUS
  }

  // Low activity -> Curious
  if (recentEventCount !== undefined && recentEventCount < 3) {
    return CURIOUS
  }

  // Default fallback
  return BALANCED
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/shared/personalities.ts
git commit -m "Add personality presets with auto-selection logic"
```

---

### Task 5: Create interruption policy module

**Files:**
- Create: `src/main/services/agent/interruption-policy.ts`

- [ ] **Step 1: Write the interruption policy gate**

```typescript
import { InterruptionPolicy } from '@shared/types'

const CANVAS_TOOLS = new Set(['show_bubble', 'show_panel', 'show_toast', 'dismiss_widget'])

interface PolicyCheckResult {
  allowed: boolean
  reason?: string
}

export function checkInterruptionPolicy(
  policy: InterruptionPolicy,
  toolName: string,
  resolvedPolicy?: InterruptionPolicy
): PolicyCheckResult {
  // Non-canvas tools are always allowed
  if (!CANVAS_TOOLS.has(toolName)) {
    return { allowed: true }
  }

  const effectivePolicy = resolvedPolicy ?? policy

  switch (effectivePolicy) {
    case 'silent':
      return { allowed: false, reason: 'Silent mode: canvas tools suppressed' }

    case 'ask-first':
      if (toolName === 'show_panel') {
        return { allowed: false, reason: 'Ask First mode: show_panel requires user click on bubble' }
      }
      return { allowed: true }

    case 'proactive':
      return { allowed: true }

    default:
      return { allowed: true }
  }
}

export function resolveAutoPolicy(
  policy: InterruptionPolicy,
  msSinceLastEvent: number
): InterruptionPolicy {
  if (policy !== 'auto') {
    return policy
  }

  // No events for 30s+ -> proactive (user is idle)
  if (msSinceLastEvent > 30000) {
    return 'proactive'
  }

  // Very recent events (< 3s) -> silent (active conversation)
  if (msSinceLastEvent < 3000) {
    return 'silent'
  }

  // Default auto behavior
  return 'ask-first'
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/agent/interruption-policy.ts
git commit -m "Add interruption policy gate for canvas tool access"
```

---

### Task 6: Create widget type definitions and WidgetManager

**Files:**
- Create: `src/main/services/canvas/widget-types.ts`
- Create: `src/main/services/canvas/widget-manager.ts`

- [ ] **Step 1: Create widget-types.ts**

```typescript
import {
  BubbleUrgency,
  PanelSubtype,
  Widget,
  WidgetAnchor,
  WidgetType,
} from '@shared/types'
import { WIDGET_DEFAULTS } from '@shared/constants'

export interface WidgetRegistration {
  type: WidgetType
  id?: string
  anchor?: WidgetAnchor
  priority?: number
  dismissable?: boolean
  ttl?: number | null
  props?: Record<string, unknown>
}

export function getDefaultsForType(type: WidgetType): Partial<Widget> {
  switch (type) {
    case 'control-bar':
      return {
        anchor: 'top-left',
        priority: 100,
        dismissable: false,
        ttl: null,
      }
    case 'panel':
      return {
        anchor: 'top-right',
        priority: 50,
        dismissable: true,
        ttl: null,
      }
    case 'bubble':
      return {
        anchor: 'near-control-bar',
        priority: 70,
        dismissable: true,
        ttl: WIDGET_DEFAULTS.bubbleTtlMs,
      }
    case 'toast':
      return {
        anchor: 'top-right',
        priority: 90,
        dismissable: false,
        ttl: WIDGET_DEFAULTS.toastTtlMs,
      }
  }
}

// Props helpers for type safety in tool executor
export interface BubbleProps {
  message: string
  urgency: BubbleUrgency
  expandable: boolean
}

export interface PanelProps {
  title: string
  content: string
  panelType: PanelSubtype
  fontSize?: number
}

export interface ToastProps {
  message: string
}
```

- [ ] **Step 2: Create widget-manager.ts**

```typescript
import { Widget, WidgetType } from '@shared/types'
import { WIDGET_DEFAULTS } from '@shared/constants'
import { getDefaultsForType, WidgetRegistration } from './widget-types'
import { BrowserWindow } from 'electron'

let widgetIdCounter = 0

function generateWidgetId(type: WidgetType): string {
  widgetIdCounter++
  return `${type}-${Date.now()}-${widgetIdCounter}`
}

export class WidgetManager {
  private widgets = new Map<string, Widget>()
  private timers = new Map<string, NodeJS.Timeout>()
  private canvasWindow: BrowserWindow | null = null

  setCanvasWindow(win: BrowserWindow | null): void {
    this.canvasWindow = win
  }

  register(registration: WidgetRegistration): Widget {
    const defaults = getDefaultsForType(registration.type)
    const id = registration.id ?? generateWidgetId(registration.type)

    // Enforce max bubbles
    if (registration.type === 'bubble') {
      const bubbles = this.listByType('bubble')
      while (bubbles.length >= WIDGET_DEFAULTS.maxBubbles) {
        const oldest = bubbles.shift()!
        this.dismiss(oldest.id)
      }
    }

    const widget: Widget = {
      id,
      type: registration.type,
      anchor: registration.anchor ?? defaults.anchor ?? 'top-left',
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      priority: registration.priority ?? defaults.priority ?? 50,
      dismissable: registration.dismissable ?? defaults.dismissable ?? true,
      ttl: registration.ttl !== undefined ? registration.ttl : (defaults.ttl ?? null),
      props: registration.props ?? {},
      createdAt: Date.now(),
    }

    this.widgets.set(id, widget)

    // Set up auto-dismiss timer if TTL is set
    if (widget.ttl !== null && widget.ttl > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id)
      }, widget.ttl)
      this.timers.set(id, timer)
    }

    this.broadcastState()
    return widget
  }

  update(id: string, props: Record<string, unknown>): void {
    const widget = this.widgets.get(id)
    if (!widget) return

    widget.props = { ...widget.props, ...props }
    this.broadcastState()
  }

  dismiss(id: string): void {
    const widget = this.widgets.get(id)
    if (!widget) return

    // Clear auto-dismiss timer
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }

    this.widgets.delete(id)
    this.broadcastState()
  }

  dismissByType(type: WidgetType): void {
    for (const [id, widget] of this.widgets) {
      if (widget.type === type) {
        this.dismiss(id)
      }
    }
  }

  get(id: string): Widget | undefined {
    return this.widgets.get(id)
  }

  listActive(): Widget[] {
    return Array.from(this.widgets.values())
      .sort((a, b) => b.priority - a.priority)
  }

  listByType(type: WidgetType): Widget[] {
    return Array.from(this.widgets.values())
      .filter((w) => w.type === type)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  hasType(type: WidgetType): boolean {
    for (const widget of this.widgets.values()) {
      if (widget.type === type) return true
    }
    return false
  }

  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.widgets.clear()
    this.broadcastState()
  }

  private broadcastState(): void {
    if (!this.canvasWindow || this.canvasWindow.isDestroyed()) return
    this.canvasWindow.webContents.send('canvas:widget-state', this.listActive())
  }
}
```

- [ ] **Step 3: Create the services/canvas directory and verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/canvas/widget-types.ts src/main/services/canvas/widget-manager.ts
git commit -m "Add WidgetManager with lifecycle, TTL auto-dismiss, and broadcast"
```

---

### Task 7: Expand tool definitions with canvas tools

**Files:**
- Modify: `src/main/services/agent/tool-definitions.ts`

- [ ] **Step 1: Add new tool schemas**

Add after the existing `save_memory` tool definition in the `TOOL_DEFINITIONS` array:

```typescript
  {
    type: 'function',
    function: {
      name: 'show_bubble',
      description:
        'Display a small proactive message to the user. Use when you notice something relevant worth mentioning, like a connection to past context or a reminder. Keep messages short (1-2 sentences).',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to show in the bubble.',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'How important this message is. Use high sparingly.',
          },
          expandable: {
            type: 'boolean',
            description: 'Whether the user can click to expand this into a full panel.',
          },
        },
        required: ['message', 'urgency'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_panel',
      description:
        'Open a content panel with detailed information. Use for substantial content like recalled context, analysis, or multi-paragraph responses.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Panel title displayed in the header.',
          },
          content: {
            type: 'string',
            description: 'The content to display. Supports markdown.',
          },
          panel_type: {
            type: 'string',
            enum: ['answer', 'preview', 'context'],
            description: 'The type of panel to display.',
          },
        },
        required: ['title', 'content', 'panel_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_toast',
      description:
        'Flash a brief status notification. Auto-dismisses after a few seconds. Use for confirmations and status updates.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Short notification message.',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_widget',
      description: 'Close a specific widget by its ID.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: {
            type: 'string',
            description: 'The ID of the widget to close.',
          },
        },
        required: ['widget_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_artifacts',
      description:
        'Search saved artifacts like screenshots, transcripts, and files. Use when the user asks about past captures or files.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against artifact paths, types, and metadata.',
          },
          type: {
            type: 'string',
            description: 'Optional artifact type filter (e.g. "screenshot.image", "session.transcript").',
          },
          session: {
            type: 'string',
            description: 'Optional session folder name to scope the search.',
          },
        },
        required: ['query'],
      },
    },
  },
```

- [ ] **Step 2: Add WidgetManager and ArtifactStore to executor deps**

Replace the `ToolExecutorDeps` interface and `createToolExecutor` function:

```typescript
import { RecallResult, ToolDefinition, ToolExecutorFn, WhisphryMemoryType, ArtifactListFilters } from '@shared/types'
import { MemoryStore } from '../memory/memory-store'
import { RecallService } from '../memory/recall-service'
import { ArtifactStore } from '../memory/artifact-store'
import { WidgetManager } from '../canvas/widget-manager'
import { checkInterruptionPolicy, resolveAutoPolicy } from './interruption-policy'
import type { InterruptionPolicy } from '@shared/types'

interface ToolExecutorDeps {
  recallService: RecallService
  memoryStore: MemoryStore
  artifactStore: ArtifactStore
  widgetManager: WidgetManager
  sessionFolderName?: string
  getInterruptionPolicy: () => InterruptionPolicy
  getLastEventTimestamp: () => number
}
```

- [ ] **Step 3: Add executor cases for new tools**

Add inside the `switch (name)` block of `createToolExecutor`:

```typescript
        case 'show_bubble':
          return executeShowBubble(deps, args)
        case 'show_panel':
          return executeShowPanel(deps, args)
        case 'show_toast':
          return executeShowToast(deps, args)
        case 'dismiss_widget':
          return executeDismissWidget(deps, args)
        case 'search_artifacts':
          return await executeSearchArtifacts(deps, args)
```

- [ ] **Step 4: Add the executor functions**

Add after the existing `executeSaveMemory` function:

```typescript
function executeShowBubble(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const message = String(args.message ?? '').trim()
  if (!message) return 'Cannot show bubble: message is required.'

  const resolvedPolicy = resolveAutoPolicy(deps.getInterruptionPolicy(), Date.now() - deps.getLastEventTimestamp())
  const check = checkInterruptionPolicy(deps.getInterruptionPolicy(), 'show_bubble', resolvedPolicy)
  if (!check.allowed) return `Bubble suppressed: ${check.reason}`

  const urgency = args.urgency ?? 'low'
  const expandable = args.expandable ?? false

  const widget = deps.widgetManager.register({
    type: 'bubble',
    props: { message, urgency, expandable },
  })

  return `Bubble shown (id: ${widget.id}).`
}

function executeShowPanel(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const title = String(args.title ?? '').trim()
  const content = String(args.content ?? '').trim()
  if (!title || !content) return 'Cannot show panel: title and content are required.'

  const resolvedPolicy = resolveAutoPolicy(deps.getInterruptionPolicy(), Date.now() - deps.getLastEventTimestamp())
  const check = checkInterruptionPolicy(deps.getInterruptionPolicy(), 'show_panel', resolvedPolicy)
  if (!check.allowed) return `Panel suppressed: ${check.reason}`

  const panelType = args.panel_type ?? 'context'

  const widget = deps.widgetManager.register({
    type: 'panel',
    props: { title, content, panelType },
  })

  return `Panel shown: "${title}" (id: ${widget.id}).`
}

function executeShowToast(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const message = String(args.message ?? '').trim()
  if (!message) return 'Cannot show toast: message is required.'

  const resolvedPolicy = resolveAutoPolicy(deps.getInterruptionPolicy(), Date.now() - deps.getLastEventTimestamp())
  const check = checkInterruptionPolicy(deps.getInterruptionPolicy(), 'show_toast', resolvedPolicy)
  if (!check.allowed) return `Toast suppressed: ${check.reason}`

  const widget = deps.widgetManager.register({
    type: 'toast',
    props: { message },
  })

  return `Toast shown (id: ${widget.id}).`
}

function executeDismissWidget(deps: ToolExecutorDeps, args: Record<string, any>): string {
  const widgetId = String(args.widget_id ?? '').trim()
  if (!widgetId) return 'Cannot dismiss: widget_id is required.'

  const widget = deps.widgetManager.get(widgetId)
  if (!widget) return `No widget found with id: "${widgetId}".`
  if (!widget.dismissable) return `Widget "${widgetId}" is not dismissable.`

  deps.widgetManager.dismiss(widgetId)
  return `Widget "${widgetId}" dismissed.`
}

async function executeSearchArtifacts(deps: ToolExecutorDeps, args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) return 'No query provided.'

  const filters: ArtifactListFilters = {
    limit: 10,
    query,
  }
  if (args.type) filters.types = [args.type]
  if (args.session) filters.sessionFolderName = args.session

  const artifacts = deps.artifactStore.listRecent(filters)

  if (artifacts.length === 0) {
    return `No artifacts found for query: "${query}".`
  }

  const lines = artifacts.map((a, i) =>
    `${i + 1}. [${a.type}] ${a.relativePath || a.absolutePath} (${new Date(a.createdAt).toLocaleDateString()})`
  )

  return `Found ${artifacts.length} artifact(s):\n${lines.join('\n')}`
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/agent/tool-definitions.ts
git commit -m "Expand agent tools: show_bubble, show_panel, show_toast, dismiss_widget, search_artifacts"
```

---

### Task 8: Create HeartbeatService skeleton

**Files:**
- Create: `src/main/services/agent/heartbeat-service.ts`

- [ ] **Step 1: Write the heartbeat service**

```typescript
import { AgentPresenceState, HeartbeatState, InterruptionPolicy, PersonalityPreset, SessionContext, TranscriptEntry, ToolDefinition, ToolExecutorFn } from '@shared/types'
import { HEARTBEAT_COOLDOWNS, HEARTBEAT_DEFAULTS } from '@shared/constants'
import { resolvePersonality, PersonalityConfig } from '@shared/personalities'
import { MemoryStore } from '../memory/memory-store'
import { EventStore } from '../memory/event-store'
import { LLMService } from '../llm-service'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

interface HeartbeatDeps {
  llmService: LLMService | null
  eventStore: EventStore
  memoryStore: MemoryStore
  getSessionContext: () => SessionContext | undefined
  getSessionTranscript: () => TranscriptEntry[]
  getSessionFolderName: () => string | undefined
  getModel: () => string
  getToolDefinitions: () => ToolDefinition[]
  getToolExecutor: () => ToolExecutorFn
  getCanvasWindow: () => BrowserWindow | null
}

let soulPrompt: string | null = null

function loadSoulPrompt(): string {
  if (soulPrompt !== null) return soulPrompt
  try {
    const soulPath = path.join(__dirname, '../../shared/soul.md')
    soulPrompt = fs.readFileSync(soulPath, 'utf-8')
  } catch {
    soulPrompt = 'You are Whisphry, a local memory-native desktop companion.'
  }
  return soulPrompt
}

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null
  private enabled: boolean = HEARTBEAT_DEFAULTS.enabled
  private intervalMs: number = HEARTBEAT_DEFAULTS.intervalMs
  private personality: PersonalityPreset = 'auto'
  private interruptionPolicy: InterruptionPolicy = 'ask-first'
  private presenceState: AgentPresenceState = 'sleeping'
  private lastTickAt: number | null = null
  private lastLLMCallAt: number | null = null
  private lastEventCountAtTick: number = 0
  private cooldowns: Record<string, number> = {}

  constructor(private readonly deps: HeartbeatDeps) {}

  start(): void {
    if (this.timer) return
    this.setPresenceState('idle')
    this.lastEventCountAtTick = this.deps.eventStore.count()
    this.timer = setInterval(() => this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.setPresenceState('sleeping')
    this.lastTickAt = null
    this.lastEventCountAtTick = 0
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.stop()
  }

  setIntervalMs(ms: number): void {
    this.intervalMs = Math.max(
      HEARTBEAT_DEFAULTS.minIntervalMs,
      Math.min(HEARTBEAT_DEFAULTS.maxIntervalMs, ms)
    )
    // Restart timer with new interval if running
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this.tick(), this.intervalMs)
    }
  }

  setPersonality(preset: PersonalityPreset): void {
    this.personality = preset
  }

  setInterruptionPolicy(policy: InterruptionPolicy): void {
    this.interruptionPolicy = policy
  }

  getPersonality(): PersonalityPreset {
    return this.personality
  }

  getInterruptionPolicy(): InterruptionPolicy {
    return this.interruptionPolicy
  }

  getPresenceState(): AgentPresenceState {
    return this.presenceState
  }

  getState(): HeartbeatState {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastTickAt: this.lastTickAt,
      lastLLMCallAt: this.lastLLMCallAt,
      presenceState: this.presenceState,
      personality: this.personality,
      interruptionPolicy: this.interruptionPolicy,
    }
  }

  setPresenceState(state: AgentPresenceState): void {
    this.presenceState = state
    const canvasWindow = this.deps.getCanvasWindow()
    if (canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.webContents.send('agent:presence-state', state)
    }
  }

  private async tick(): Promise<void> {
    if (!this.enabled) return

    this.lastTickAt = Date.now()

    // Check if there are new events since last tick
    const currentEventCount = this.deps.eventStore.count()
    if (currentEventCount <= this.lastEventCountAtTick) {
      // Nothing new -- stay idle, skip LLM call
      if (this.presenceState === 'thinking') {
        this.setPresenceState('idle')
      }
      return
    }
    this.lastEventCountAtTick = currentEventCount

    // Check global cooldown
    if (!this.checkCooldown('global')) return

    const sessionContext = this.deps.getSessionContext()
    const transcript = this.deps.getSessionTranscript()
    const recentTranscript = transcript.slice(-10)

    if (recentTranscript.length === 0) return

    // Resolve personality
    const recentMemories = this.deps.memoryStore.listRecent({ limit: 5, statuses: ['active'] })
    const personalityConfig = resolvePersonality(
      this.personality,
      sessionContext,
      currentEventCount - (this.lastEventCountAtTick - (currentEventCount - this.lastEventCountAtTick)),
      recentMemories.length
    )

    // Build heartbeat prompt
    const soulText = loadSoulPrompt()
    const snapshot = this.buildContextSnapshot(recentTranscript, sessionContext, recentMemories, personalityConfig)

    this.setPresenceState('thinking')

    try {
      const llmService = this.deps.llmService
      if (!llmService) {
        this.setPresenceState('idle')
        return
      }

      this.lastLLMCallAt = Date.now()

      const systemPrompt = [
        soulText,
        '',
        '## Current Personality',
        personalityConfig.systemPromptFragment,
        '',
        '## Your Task',
        'You are running a background heartbeat check. Review the recent context and decide what to do.',
        'Most of the time, the right action is to do nothing.',
        'Only use a tool if you are confident it would genuinely help the user right now.',
        `Your confidence threshold is ${personalityConfig.confidenceThreshold} -- only act if your confidence exceeds this.`,
        'Do nothing if you are unsure. Silence is always acceptable.',
      ].join('\n')

      const tools = this.deps.getToolDefinitions()
      const executor = this.deps.getToolExecutor()

      await llmService.callOpenRouter({
        model: this.deps.getModel(),
        systemPrompt,
        userMessage: snapshot,
        tools,
        executeToolCall: executor,
        stream: false,
      })

      this.setCooldown('global', HEARTBEAT_COOLDOWNS.globalMinMs)
    } catch (error) {
      console.error('[Heartbeat] LLM call failed:', error)
    } finally {
      if (this.presenceState === 'thinking') {
        this.setPresenceState('idle')
      }
    }
  }

  private buildContextSnapshot(
    recentTranscript: TranscriptEntry[],
    sessionContext: SessionContext | undefined,
    recentMemories: any[],
    personality: PersonalityConfig
  ): string {
    const parts: string[] = []

    if (sessionContext) {
      const meta = [
        sessionContext.companyName && `Company: ${sessionContext.companyName}`,
        sessionContext.roleName && `Role: ${sessionContext.roleName}`,
        sessionContext.interviewType && `Type: ${sessionContext.interviewType}`,
        sessionContext.subject && `Subject: ${sessionContext.subject}`,
      ].filter(Boolean)
      if (meta.length > 0) {
        parts.push('## Session Context\n' + meta.join('\n'))
      }
    }

    if (recentTranscript.length > 0) {
      const lines = recentTranscript.map(
        (e) => `[${e.speaker}] ${e.text}`
      )
      parts.push('## Recent Transcript\n' + lines.join('\n'))
    }

    if (recentMemories.length > 0) {
      const lines = recentMemories.map(
        (m) => `- [${m.type}] ${m.title}: ${m.summary}`
      )
      parts.push('## Recent Memories\n' + lines.join('\n'))
    }

    parts.push(`\nPersonality: ${personality.label}`)
    parts.push(`Interruption Policy: ${this.interruptionPolicy}`)

    return parts.join('\n\n')
  }

  private checkCooldown(key: string): boolean {
    const lastUsed = this.cooldowns[key]
    if (!lastUsed) return true
    return Date.now() - lastUsed >= (HEARTBEAT_COOLDOWNS.globalMinMs)
  }

  private setCooldown(key: string, durationMs: number): void {
    this.cooldowns[key] = Date.now()
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

Note: This may fail because `LLMService.callOpenRouter` is currently a private streaming method. We need to check the actual signature. If it fails, we'll adjust in the next task. For now, the heartbeat service is a skeleton -- it won't be wired to the LLM until Step 4 when we activate agent features. Mark any call to `llmService.callOpenRouter` with a `// TODO: wire to actual LLM call method in Step 4` comment if the signature doesn't match.

Expected: Clean build (or identified adjustments needed for LLM integration).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/agent/heartbeat-service.ts
git commit -m "Add HeartbeatService skeleton with tick loop, cooldowns, and presence state"
```

---

## Step 2: Canvas Window & Renderer

### Task 9: Create canvas BrowserWindow

**Files:**
- Modify: `src/main/windows.ts`

- [ ] **Step 1: Add createCanvasWindow function**

Add after the `createPreviewWindow` function (before `setContentProtection`):

```typescript
let canvasWindow: BrowserWindow | null = null

export function createCanvasWindow(): BrowserWindow {
  const { x, y, width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workArea

  canvasWindow = new BrowserWindow({
    x,
    y,
    width: screenWidth,
    height: screenHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  canvasWindow.setContentProtection(true)
  canvasWindow.setAlwaysOnTop(true, 'screen-saver')
  canvasWindow.setSkipTaskbar(true)
  canvasWindow.setIgnoreMouseEvents(true, { forward: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    canvasWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/canvas/index.html`)
  } else {
    canvasWindow.loadFile(join(__dirname, '../renderer/canvas/index.html'))
  }

  canvasWindow.on('closed', () => {
    canvasWindow = null
  })

  return canvasWindow
}

export function getCanvasWindow(): BrowserWindow | null {
  return canvasWindow
}

export function setCanvasInteractive(interactive: boolean): void {
  if (!canvasWindow) return
  if (interactive) {
    canvasWindow.setIgnoreMouseEvents(false)
  } else {
    canvasWindow.setIgnoreMouseEvents(true, { forward: true })
  }
}

export function toggleCanvas(): void {
  if (!canvasWindow) return
  if (canvasWindow.isVisible()) {
    canvasWindow.hide()
  } else {
    canvasWindow.show()
  }
}
```

- [ ] **Step 2: Add canvasWindow to setContentProtection**

Update the existing `setContentProtection` function to include `canvasWindow`:

```typescript
export function setContentProtection(enabled: boolean): void {
  overlayWindow?.setContentProtection(enabled)
  answerWindow?.setContentProtection(enabled)
  settingsWindow?.setContentProtection(enabled)
  previewWindow?.setContentProtection(enabled)
  canvasWindow?.setContentProtection(enabled)
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/main/windows.ts
git commit -m "Add createCanvasWindow: full-screen transparent click-through surface"
```

---

### Task 10: Add canvas entry to electron-vite config

**Files:**
- Modify: `electron.vite.config.ts`

- [ ] **Step 1: Add canvas input to rollupOptions**

Replace the `renderer.build.rollupOptions.input` to add the canvas entry:

```typescript
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          canvas: resolve(__dirname, 'src/renderer/canvas/index.html'),
        }
      }
    }
```

- [ ] **Step 2: Commit**

```bash
git add electron.vite.config.ts
git commit -m "Add canvas renderer entry point to electron-vite config"
```

---

### Task 11: Create canvas renderer entry files

**Files:**
- Create: `src/renderer/canvas/index.html`
- Create: `src/renderer/canvas/main.tsx`
- Create: `src/renderer/canvas/styles.css`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Whisphry Canvas</title>
</head>
<body class="bg-transparent overflow-hidden">
  <div id="root" class="w-screen h-screen"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create main.tsx**

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
```

- [ ] **Step 3: Create styles.css**

```css
@import 'tailwindcss';

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: transparent;
}

/* Widget drag handle */
.widget-drag-handle {
  -webkit-app-region: no-drag;
  cursor: grab;
}

.widget-drag-handle:active {
  cursor: grabbing;
}

/* Toast fade animation */
@keyframes toast-fade-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes toast-fade-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-8px); }
}

.toast-enter {
  animation: toast-fade-in 0.2s ease-out;
}

.toast-exit {
  animation: toast-fade-out 0.3s ease-in forwards;
}

/* Bubble slide animation */
@keyframes bubble-slide-in {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}

.bubble-enter {
  animation: bubble-slide-in 0.25s ease-out;
}

/* Presence indicator animations */
@keyframes presence-breathe {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.15); }
}

@keyframes presence-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.2); }
}

@keyframes presence-wave {
  0% { transform: scaleY(0.4); }
  50% { transform: scaleY(1); }
  100% { transform: scaleY(0.4); }
}

.presence-breathing {
  animation: presence-breathe 3s ease-in-out infinite;
}

.presence-pulsing {
  animation: presence-pulse 1.2s ease-in-out infinite;
}

.presence-wave-bar {
  animation: presence-wave 0.6s ease-in-out infinite;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/canvas/index.html src/renderer/canvas/main.tsx src/renderer/canvas/styles.css
git commit -m "Add canvas renderer entry files: HTML, main.tsx, styles with widget animations"
```

---

### Task 12: Create WidgetShell component

**Files:**
- Create: `src/renderer/canvas/components/WidgetShell.tsx`

- [ ] **Step 1: Write the shared widget wrapper**

```tsx
import React, { useRef, useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'

interface WidgetShellProps {
  id: string
  draggable?: boolean
  dismissable?: boolean
  resizable?: boolean
  onDismiss?: (id: string) => void
  onPositionChange?: (id: string, x: number, y: number) => void
  onSizeChange?: (id: string, width: number, height: number) => void
  className?: string
  children: React.ReactNode
  initialPosition?: { x: number; y: number }
}

export default function WidgetShell({
  id,
  draggable = false,
  dismissable = false,
  resizable = false,
  onDismiss,
  onPositionChange,
  onSizeChange,
  className = '',
  children,
  initialPosition,
}: WidgetShellProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(initialPosition ?? { x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!draggable) return
      // Only drag from elements with data-drag-handle
      const target = e.target as HTMLElement
      if (!target.closest('[data-drag-handle]')) return

      e.preventDefault()
      setIsDragging(true)
      const rect = shellRef.current?.getBoundingClientRect()
      dragOffset.current = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      }
    },
    [draggable]
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y
      setPosition({ x: newX, y: newY })
      onPositionChange?.(id, newX, newY)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, id, onPositionChange])

  // Notify canvas of interactive region on mount and position change
  useEffect(() => {
    const el = shellRef.current
    if (!el) return

    const updateRegion = () => {
      const rect = el.getBoundingClientRect()
      window.api?.canvasReportRegion?.(id, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    updateRegion()
    const observer = new ResizeObserver(updateRegion)
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, position])

  const style: React.CSSProperties = draggable
    ? { position: 'absolute', left: position.x, top: position.y }
    : {}

  return (
    <div
      ref={shellRef}
      className={`${className}`}
      style={style}
      onMouseDown={handleMouseDown}
    >
      {dismissable && (
        <button
          onClick={() => onDismiss?.(id)}
          className="absolute top-1 right-1 p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/80 z-10 transition-colors"
        >
          <X size={14} />
        </button>
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/canvas/components/WidgetShell.tsx
git commit -m "Add WidgetShell: shared drag, dismiss, resize, and region reporting wrapper"
```

---

### Task 13: Create PresenceIndicator component

**Files:**
- Create: `src/renderer/canvas/components/PresenceIndicator.tsx`

- [ ] **Step 1: Write the presence indicator**

```tsx
import React from 'react'
import type { AgentPresenceState } from '@shared/types'

interface PresenceIndicatorProps {
  state: AgentPresenceState
  size?: number
}

export default function PresenceIndicator({ state, size = 16 }: PresenceIndicatorProps) {
  if (state === 'speaking') {
    return <SpeakingWaveform size={size} />
  }

  const config = PRESENCE_STYLES[state]

  return (
    <div
      className={`rounded-full ${config.className}`}
      style={{ width: size, height: size }}
      title={config.label}
    />
  )
}

const PRESENCE_STYLES: Record<AgentPresenceState, { className: string; label: string }> = {
  sleeping: {
    className: 'bg-white/20',
    label: 'Sleeping',
  },
  idle: {
    className: 'bg-emerald-400/60 presence-breathing',
    label: 'Idle',
  },
  listening: {
    className: 'bg-cyan-400/70 presence-breathing',
    label: 'Listening',
  },
  thinking: {
    className: 'bg-amber-400/80 presence-pulsing',
    label: 'Thinking',
  },
  speaking: {
    className: '',
    label: 'Speaking',
  },
}

function SpeakingWaveform({ size }: { size: number }) {
  const barCount = 4
  const barWidth = Math.max(2, Math.floor(size / (barCount * 2)))
  const gap = Math.max(1, Math.floor(barWidth / 2))

  return (
    <div
      className="flex items-center justify-center"
      style={{ width: size, height: size, gap }}
      title="Speaking"
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className="bg-emerald-400 rounded-full presence-wave-bar"
          style={{
            width: barWidth,
            height: size * 0.6,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/canvas/components/PresenceIndicator.tsx
git commit -m "Add PresenceIndicator with breathing, pulsing, and waveform animations"
```

---

### Task 14: Create Toast component

**Files:**
- Create: `src/renderer/canvas/components/Toast.tsx`

- [ ] **Step 1: Write the toast component**

```tsx
import React, { useEffect, useState } from 'react'
import { WIDGET_DEFAULTS } from '@shared/constants'

interface ToastProps {
  id: string
  message: string
  ttl?: number
}

export default function Toast({ id, message, ttl }: ToastProps) {
  const [exiting, setExiting] = useState(false)
  const fadeDuration = 300
  const displayDuration = (ttl ?? WIDGET_DEFAULTS.toastTtlMs) - fadeDuration

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), displayDuration)
    return () => clearTimeout(fadeTimer)
  }, [displayDuration])

  return (
    <div
      className={`px-4 py-2 rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 text-white/90 text-sm shadow-lg ${
        exiting ? 'toast-exit' : 'toast-enter'
      }`}
    >
      {message}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/canvas/components/Toast.tsx
git commit -m "Add Toast widget component with auto-fade animation"
```

---

### Task 15: Create Bubble component

**Files:**
- Create: `src/renderer/canvas/components/Bubble.tsx`

- [ ] **Step 1: Write the bubble component**

```tsx
import React from 'react'
import { ChevronRight } from 'lucide-react'
import type { BubbleUrgency } from '@shared/types'

interface BubbleProps {
  id: string
  message: string
  urgency: BubbleUrgency
  expandable: boolean
  onExpand?: (id: string) => void
  onDismiss?: (id: string) => void
}

const URGENCY_STYLES: Record<BubbleUrgency, string> = {
  low: 'border-white/10 bg-black/75',
  medium: 'border-cyan-500/30 bg-black/80',
  high: 'border-amber-500/40 bg-black/85',
}

export default function Bubble({ id, message, urgency, expandable, onExpand, onDismiss }: BubbleProps) {
  return (
    <div
      className={`bubble-enter flex items-start gap-2 px-3 py-2.5 rounded-lg backdrop-blur-sm border shadow-lg max-w-xs ${URGENCY_STYLES[urgency]}`}
    >
      <p className="text-white/90 text-sm flex-1 leading-snug">{message}</p>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        {expandable && (
          <button
            onClick={() => onExpand?.(id)}
            className="p-0.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title="Expand"
          >
            <ChevronRight size={14} />
          </button>
        )}
        <button
          onClick={() => onDismiss?.(id)}
          className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors text-xs"
          title="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/canvas/components/Bubble.tsx
git commit -m "Add Bubble widget component with urgency styling and expand action"
```

---

### Task 16: Create Panel component

**Files:**
- Create: `src/renderer/canvas/components/Panel.tsx`

- [ ] **Step 1: Write the panel component**

This component migrates the answer/preview rendering into a canvas widget. It imports the existing `markdown-renderer.tsx` for content rendering.

```tsx
import React, { useState } from 'react'
import { Minus, Plus, GripVertical } from 'lucide-react'
import type { PanelSubtype } from '@shared/types'
import MarkdownRenderer from '../../overlay/components/markdown-renderer'

interface PanelProps {
  id: string
  title: string
  content: string
  panelType: PanelSubtype
  fontSize?: number
  onDismiss?: (id: string) => void
}

export default function Panel({ id, title, content, panelType, fontSize: initialFontSize, onDismiss }: PanelProps) {
  const [fontSize, setFontSize] = useState(initialFontSize ?? 18)

  const adjustFontSize = (delta: number) => {
    setFontSize((prev) => Math.max(14, Math.min(28, prev + delta)))
  }

  return (
    <div className="flex flex-col bg-black/85 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[400px] min-h-[200px] max-w-[900px] max-h-[80vh]">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5 shrink-0"
        data-drag-handle
      >
        <GripVertical size={14} className="text-white/30 cursor-grab" />
        <span className="text-white/70 text-sm font-medium flex-1 truncate">{title}</span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => adjustFontSize(-2)}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-white/30 text-xs w-6 text-center">{fontSize}</span>
          <button
            onClick={() => adjustFontSize(2)}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={() => onDismiss?.(id)}
            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors ml-1"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 text-white/90"
        style={{ fontSize }}
      >
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/canvas/components/Panel.tsx
git commit -m "Add Panel widget component with markdown rendering and font size controls"
```

---

### Task 17: Create canvas App.tsx compositor

**Files:**
- Create: `src/renderer/canvas/App.tsx`

- [ ] **Step 1: Write the root canvas compositor**

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { Widget, AgentPresenceState } from '@shared/types'
import WidgetShell from './components/WidgetShell'
import Toast from './components/Toast'
import Bubble from './components/Bubble'
import Panel from './components/Panel'
import PresenceIndicator from './components/PresenceIndicator'

export default function App() {
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [presenceState, setPresenceState] = useState<AgentPresenceState>('sleeping')
  const mouseOverWidgetRef = useRef(false)

  // Listen for widget state updates from main process
  useEffect(() => {
    const cleanup = window.api?.onWidgetState?.((newWidgets: Widget[]) => {
      setWidgets(newWidgets)
    })
    return () => cleanup?.()
  }, [])

  // Listen for presence state updates
  useEffect(() => {
    const cleanup = window.api?.onPresenceState?.((state: AgentPresenceState) => {
      setPresenceState(state)
    })
    return () => cleanup?.()
  }, [])

  // Hit-test: toggle canvas interactive mode based on cursor position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const elements = document.elementsFromPoint(e.clientX, e.clientY)
      const overWidget = elements.some(
        (el) => (el as HTMLElement).closest?.('[data-widget]') !== null
      )

      if (overWidget && !mouseOverWidgetRef.current) {
        mouseOverWidgetRef.current = true
        window.api?.setCanvasInteractive?.(true)
      } else if (!overWidget && mouseOverWidgetRef.current) {
        mouseOverWidgetRef.current = false
        window.api?.setCanvasInteractive?.(false)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleDismiss = useCallback((id: string) => {
    window.api?.dismissWidget?.(id)
  }, [])

  const handleBubbleExpand = useCallback((id: string) => {
    // Find the bubble and request expansion to panel via main process
    window.api?.expandBubble?.(id)
  }, [])

  // Group widgets by type for layout
  const toasts = widgets.filter((w) => w.type === 'toast')
  const bubbles = widgets.filter((w) => w.type === 'bubble')
  const panels = widgets.filter((w) => w.type === 'panel')

  return (
    <div className="relative w-full h-full pointer-events-none">
      {/* Toasts - top right */}
      {toasts.length > 0 && (
        <div
          className="fixed top-4 right-4 flex flex-col gap-2 z-50 pointer-events-auto"
          data-widget
        >
          {toasts.map((w) => (
            <Toast
              key={w.id}
              id={w.id}
              message={String(w.props.message ?? '')}
              ttl={w.ttl ?? undefined}
            />
          ))}
        </div>
      )}

      {/* Bubbles - below control bar area */}
      {bubbles.length > 0 && (
        <div
          className="fixed top-28 left-5 flex flex-col gap-2 z-40 pointer-events-auto"
          data-widget
        >
          {bubbles.map((w) => (
            <Bubble
              key={w.id}
              id={w.id}
              message={String(w.props.message ?? '')}
              urgency={(w.props.urgency as any) ?? 'low'}
              expandable={Boolean(w.props.expandable)}
              onExpand={handleBubbleExpand}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      {/* Panels - draggable */}
      {panels.map((w) => (
        <WidgetShell
          key={w.id}
          id={w.id}
          draggable
          dismissable={w.dismissable}
          onDismiss={handleDismiss}
          initialPosition={w.position.x === 0 && w.position.y === 0
            ? { x: Math.round(window.innerWidth * 0.25), y: Math.round(window.innerHeight * 0.1) }
            : w.position
          }
          className="pointer-events-auto z-30"
        >
          <div data-widget>
            <Panel
              id={w.id}
              title={String(w.props.title ?? 'Panel')}
              content={String(w.props.content ?? '')}
              panelType={(w.props.panelType as any) ?? 'context'}
              fontSize={w.props.fontSize as number | undefined}
              onDismiss={handleDismiss}
            />
          </div>
        </WidgetShell>
      ))}

      {/* Presence indicator - floating bottom-left corner for now, will move to ControlBar in Step 3 */}
      <div className="fixed bottom-4 left-4 pointer-events-none z-50">
        <PresenceIndicator state={presenceState} size={20} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add canvas IPC to preload**

Add to `src/preload/index.ts` in the `contextBridge.exposeInMainWorld('api', {` block:

```typescript
  // Canvas
  onWidgetState: (callback: (widgets: any[]) => void) => {
    const handler = (_event: any, widgets: any[]) => callback(widgets)
    ipcRenderer.on('canvas:widget-state', handler)
    return () => ipcRenderer.removeListener('canvas:widget-state', handler)
  },
  onPresenceState: (callback: (state: string) => void) => {
    const handler = (_event: any, state: string) => callback(state)
    ipcRenderer.on('agent:presence-state', handler)
    return () => ipcRenderer.removeListener('agent:presence-state', handler)
  },
  dismissWidget: (widgetId: string) => ipcRenderer.invoke('canvas:widget-dismiss', widgetId),
  expandBubble: (bubbleId: string) => ipcRenderer.invoke('canvas:expand-bubble', bubbleId),
  setCanvasInteractive: (interactive: boolean) => ipcRenderer.send('canvas:set-interactive', interactive),
  canvasReportRegion: (id: string, rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('canvas:report-region', id, rect),
```

Also add the type declarations inside the `Window.api` interface:

```typescript
      onWidgetState: (callback: (widgets: any[]) => void) => () => void
      onPresenceState: (callback: (state: string) => void) => () => void
      dismissWidget: (widgetId: string) => Promise<void>
      expandBubble: (bubbleId: string) => Promise<void>
      setCanvasInteractive: (interactive: boolean) => void
      canvasReportRegion: (id: string, rect: { x: number; y: number; width: number; height: number }) => void
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/canvas/App.tsx src/preload/index.ts
git commit -m "Add canvas App.tsx compositor with widget rendering and hit-test IPC"
```

---

### Task 18: Wire canvas IPC handlers in main process

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Import canvas dependencies**

Add to the imports at the top of `ipc-handlers.ts`:

```typescript
import { WidgetManager } from './services/canvas/widget-manager'
import {
  getCanvasWindow,
  setCanvasInteractive,
  createCanvasWindow,
} from './windows'
```

- [ ] **Step 2: Instantiate WidgetManager**

Add after the existing store instantiations (around line 80):

```typescript
const widgetManager = new WidgetManager()
```

- [ ] **Step 3: Add canvas IPC handlers**

Add in the `registerIpcHandlers` function (or wherever IPC handlers are registered):

```typescript
  // ── Canvas & Widgets ─────────────────────────────────────

  ipcMain.handle('canvas:widget-dismiss', (_event, widgetId: string) => {
    widgetManager.dismiss(widgetId)
  })

  ipcMain.handle('canvas:expand-bubble', (_event, bubbleId: string) => {
    const bubble = widgetManager.get(bubbleId)
    if (!bubble) return

    const message = String(bubble.props.message ?? '')
    widgetManager.dismiss(bubbleId)

    // Expand bubble content into a panel
    widgetManager.register({
      type: 'panel',
      props: {
        title: 'Whisphry',
        content: message,
        panelType: 'context',
      },
    })
  })

  ipcMain.on('canvas:set-interactive', (_event, interactive: boolean) => {
    setCanvasInteractive(interactive)
  })

  ipcMain.on('canvas:report-region', (_event, _id: string, _rect: any) => {
    // Region tracking for future use -- no-op for now
    // Hit-testing is handled in the renderer via mousemove
  })
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "Wire canvas IPC handlers: widget dismiss, bubble expand, interactive toggle"
```

---

## Step 3: Swap Windows to Canvas

### Task 19: Migrate overlay to ControlBar widget on canvas

This is the largest migration task. The existing overlay App.tsx renders based on a `view` URL param (`answer`, `preview`, or default overlay). The ControlBar widget on the canvas needs to replicate the default overlay behavior.

**Files:**
- Create: `src/renderer/canvas/components/ControlBar.tsx`
- Modify: `src/renderer/canvas/App.tsx`

- [ ] **Step 1: Create ControlBar.tsx**

This migrates the core control bar functionality from the overlay App.tsx. It includes the drag handle, dropdown menu, chat input, transcript strip, and the new presence indicator. The full overlay App.tsx has ~600 lines of state management -- the ControlBar widget reuses the same IPC listeners and state patterns.

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  GripVertical,
  ChevronDown,
  ChevronUp,
  Send,
  Settings,
  Eye,
  EyeOff,
  Play,
  Square,
  Monitor,
  RefreshCw,
  LogOut,
  FileText,
} from 'lucide-react'
import PresenceIndicator from './PresenceIndicator'
import type { AgentPresenceState } from '@shared/types'

interface TranscriptEntry {
  id: string
  text: string
  speaker: 'interviewer' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
}

interface ControlBarProps {
  presenceState: AgentPresenceState
  onDismiss?: (id: string) => void
}

export default function ControlBar({ presenceState }: ControlBarProps) {
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [autoAnswerEnabled, setAutoAnswerEnabled] = useState(true)
  const [sessionTime, setSessionTime] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Session timer
  useEffect(() => {
    if (isSessionActive) {
      timerRef.current = setInterval(() => setSessionTime((t) => t + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setSessionTime(0)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isSessionActive])

  // Listen for session state
  useEffect(() => {
    const cleanup = window.api.onSessionState((state: any) => {
      setIsSessionActive(state.isActive)
      if (state.autoAnswerEnabled !== undefined) setAutoAnswerEnabled(state.autoAnswerEnabled)
    })
    return cleanup
  }, [])

  // Listen for transcript updates
  useEffect(() => {
    const cleanup = window.api.onTranscriptUpdate((entry: TranscriptEntry) => {
      setTranscript((prev) => {
        const existing = prev.findIndex((e) => e.id === entry.id)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = entry
          return updated
        }
        return [...prev, entry]
      })
    })
    return cleanup
  }, [])

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  const handleSendChat = useCallback(() => {
    const q = chatInput.trim()
    if (!q) return
    window.api.requestAnswer(q)
    setChatInput('')
  }, [chatInput])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const finalTranscript = transcript.filter((e) => e.isFinal)

  return (
    <div className="flex flex-col bg-black/80 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[300px] max-w-[700px]">
      {/* Control row */}
      <div className="flex items-center gap-2 px-3 py-2" data-drag-handle>
        <PresenceIndicator state={presenceState} size={16} />
        <GripVertical size={14} className="text-white/30 cursor-grab shrink-0" />

        {/* Session status */}
        {isSessionActive && (
          <span className="text-emerald-400/80 text-xs font-mono">{formatTime(sessionTime)}</span>
        )}

        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {!isSessionActive ? (
            <button
              onClick={() => window.api.startSession()}
              className="p-1.5 rounded hover:bg-white/10 text-emerald-400/70 hover:text-emerald-400 transition-colors"
              title="Start Session"
            >
              <Play size={14} />
            </button>
          ) : (
            <button
              onClick={() => window.api.stopSession()}
              className="p-1.5 rounded hover:bg-white/10 text-red-400/70 hover:text-red-400 transition-colors"
              title="Stop Session"
            >
              <Square size={14} />
            </button>
          )}

          <button
            onClick={() => window.api.captureScreen()}
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title="Capture Screen"
          >
            <Monitor size={14} />
          </button>

          <button
            onClick={() => window.api.openSettings()}
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title="Dashboard"
          >
            <Settings size={14} />
          </button>

          <button
            onClick={() => setShowTranscript((s) => !s)}
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title={showTranscript ? 'Hide Transcript' : 'Show Transcript'}
          >
            {showTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Chat input */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/5">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
          placeholder="Ask something..."
          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white/90 placeholder-white/30 outline-none focus:border-white/20"
        />
        <button
          onClick={handleSendChat}
          className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
        >
          <Send size={14} />
        </button>
      </div>

      {/* Transcript strip */}
      {showTranscript && (
        <div className="border-t border-white/5 max-h-48 overflow-y-auto px-3 py-2">
          {finalTranscript.length === 0 ? (
            <p className="text-white/30 text-xs">No transcript yet...</p>
          ) : (
            finalTranscript.slice(-20).map((entry) => (
              <div key={entry.id} className="text-xs mb-1">
                <span className={entry.speaker === 'user' ? 'text-cyan-400/70' : 'text-white/50'}>
                  [{entry.speaker}]
                </span>{' '}
                <span className="text-white/70">{entry.text}</span>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate ControlBar into canvas App.tsx**

Update `src/renderer/canvas/App.tsx` to render the ControlBar as a persistent widget:

Add import:
```tsx
import ControlBar from './components/ControlBar'
```

Add in the return JSX, before the toasts section:

```tsx
      {/* ControlBar - persistent top-left */}
      <WidgetShell
        id="control-bar"
        draggable
        initialPosition={{ x: 20, y: 20 }}
        className="pointer-events-auto z-50"
      >
        <div data-widget>
          <ControlBar presenceState={presenceState} />
        </div>
      </WidgetShell>
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/canvas/components/ControlBar.tsx src/renderer/canvas/App.tsx
git commit -m "Add ControlBar widget with session controls, chat input, transcript, and presence indicator"
```

---

### Task 20: Create canvas window on app startup and wire existing IPC

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Read main.ts to understand current startup flow**

Read `src/main/main.ts` to see how windows are currently created at startup. Then add `createCanvasWindow()` call alongside the existing window creation. **Do not remove the old windows yet** -- this step only adds the canvas in parallel.

- [ ] **Step 2: Add canvas window creation to main.ts**

Import `createCanvasWindow` from `./windows` and call it after the existing window creation in the `app.whenReady()` callback. Also pass the canvas window reference to the WidgetManager.

- [ ] **Step 3: Route answer/question IPC to canvas**

In `ipc-handlers.ts`, when answer chunks or questions are sent to the answer window, also broadcast them as Panel widgets via the WidgetManager. This creates a parallel path so both old and new rendering work during migration.

- [ ] **Step 4: Verify the app launches with canvas alongside old windows**

Run: `npm run dev`
Verify: The app opens normally. The canvas window should be invisible (transparent, click-through). Old overlay and answer windows still work.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/main/ipc-handlers.ts
git commit -m "Create canvas window on startup alongside existing windows"
```

---

### Task 21: Replace old windows with canvas-only rendering

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/windows.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Remove overlay/answer/preview window creation from startup**

In `main.ts`, stop calling `createOverlayWindow()`, `createAnswerWindow()`, and `createPreviewWindow()`. Only call `createCanvasWindow()` and `createSettingsWindow()`.

- [ ] **Step 2: Redirect all overlay IPC to canvas**

In `ipc-handlers.ts`, update IPC handlers that currently send to the overlay/answer windows to instead route through the WidgetManager. For example, `LLM_RESPONSE_CHUNK` should update a Panel widget's content instead of sending to the answer window.

Key IPC redirections:
- `TRANSCRIPT_UPDATE` -> broadcast to canvas window
- `LLM_QUESTION` -> create/update answer Panel widget
- `LLM_RESPONSE_CHUNK` -> update answer Panel widget content
- `LLM_RESPONSE_DONE` -> finalize answer Panel widget
- `SESSION_STATE` -> broadcast to canvas window
- `TOGGLE_OVERLAY` -> `toggleCanvas()`
- `HIDE_OVERLAY` -> hide canvas
- `SHOW_OVERLAY` -> show canvas
- `TOGGLE_ANSWER_WINDOW` -> toggle answer Panel widget
- `TOGGLE_PREVIEW_WINDOW` -> toggle preview Panel widget

- [ ] **Step 3: Update windows.ts**

Remove or deprecate: `createOverlayWindow`, `createAnswerWindow`, `createPreviewWindow` and their getter/toggle/hide/show functions. Keep `createSettingsWindow` and `createCanvasWindow`.

Update `setContentProtection` to only reference `canvasWindow` and `settingsWindow`.

- [ ] **Step 4: Update electron.vite.config.ts**

Remove the `overlay` entry from `rollupOptions.input` since it's no longer needed:

```typescript
    build: {
      rollupOptions: {
        input: {
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          canvas: resolve(__dirname, 'src/renderer/canvas/index.html'),
        }
      }
    }
```

- [ ] **Step 5: Verify the app works with canvas only**

Run: `npm run dev`
Verify:
- Canvas shows ControlBar (top-left, draggable)
- Starting a session shows transcript in ControlBar
- Answer generation shows a Panel widget
- Dashboard still opens normally
- Keyboard shortcuts still work
- Content protection works

- [ ] **Step 6: Remove src/renderer/overlay/**

Delete the old overlay directory since all functionality is now on the canvas.

Note: `markdown-renderer.tsx` is imported by the canvas Panel component. Move it to a shared location first if needed, or keep importing from the old path during this step and clean up after.

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Replace overlay/answer/preview windows with canvas-only rendering"
```

---

## Step 4: Activate Agent Features

### Task 22: Wire HeartbeatService to session lifecycle

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Instantiate HeartbeatService in ipc-handlers.ts**

Add after the WidgetManager instantiation:

```typescript
import { HeartbeatService } from './services/agent/heartbeat-service'

const heartbeatService = new HeartbeatService({
  llmService: /* existing llmService reference */,
  eventStore: /* existing eventStore reference */,
  memoryStore: /* existing memoryStore reference */,
  getSessionContext: () => /* current session context getter */,
  getSessionTranscript: () => /* current transcript getter */,
  getSessionFolderName: () => /* current session folder getter */,
  getModel: () => configStore.get('defaultModel', DEFAULT_MODEL) as string,
  getToolDefinitions: () => TOOL_DEFINITIONS,
  getToolExecutor: () => createToolExecutor({
    recallService,
    memoryStore,
    artifactStore,
    widgetManager,
    sessionFolderName: /* current session folder */,
    getInterruptionPolicy: () => heartbeatService.getInterruptionPolicy(),
    getLastEventTimestamp: () => /* last event timestamp */,
  }),
  getCanvasWindow,
})
```

- [ ] **Step 2: Start/stop heartbeat with session lifecycle**

In the session start handler, add:
```typescript
heartbeatService.start()
heartbeatService.setPresenceState('listening')
```

In the session stop handler, add:
```typescript
heartbeatService.stop()
```

- [ ] **Step 3: Update presence state on transcript events**

When audio is being transcribed, set:
```typescript
heartbeatService.setPresenceState('listening')
```

When an answer is being generated, set:
```typescript
heartbeatService.setPresenceState('speaking')
```

When done:
```typescript
heartbeatService.setPresenceState('idle')
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "Wire HeartbeatService to session lifecycle and presence state"
```

---

### Task 23: Add agent behavior settings to dashboard

**Files:**
- Modify: `src/renderer/settings/components/ApiConfig.tsx`

- [ ] **Step 1: Read ApiConfig.tsx to understand the current settings layout**

Read the file to see where to add the new Agent Behavior section.

- [ ] **Step 2: Add Agent Behavior section**

Add a new section in the Settings tab with:
- Personality dropdown (Focused / Balanced / Curious / Auto)
- Interruption Policy dropdown (Silent / Ask First / Proactive / Auto)
- Heartbeat Interval slider (10s - 30s)
- Enable Heartbeat toggle

Wire each control to read/write from the config store via existing `getConfig`/`setConfig` IPC:

```typescript
// Config keys for agent behavior
// personality: 'focused' | 'balanced' | 'curious' | 'auto'
// interruptionPolicy: 'silent' | 'ask-first' | 'proactive' | 'auto'
// heartbeatIntervalMs: number (10000-30000)
// heartbeatEnabled: boolean
```

- [ ] **Step 3: Add IPC handlers for agent config changes**

In `ipc-handlers.ts`, when `SET_CONFIG` receives personality/interruption/heartbeat changes, forward them to the HeartbeatService:

```typescript
if (key === 'personality') heartbeatService.setPersonality(value)
if (key === 'interruptionPolicy') heartbeatService.setInterruptionPolicy(value)
if (key === 'heartbeatEnabled') heartbeatService.setEnabled(value)
if (key === 'heartbeatIntervalMs') heartbeatService.setIntervalMs(value)
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/components/ApiConfig.tsx src/main/ipc-handlers.ts
git commit -m "Add Agent Behavior settings: personality, interruption policy, heartbeat controls"
```

---

### Task 24: Wire Soul.md into LLM prompt construction

**Files:**
- Modify: `src/shared/prompts.ts`

- [ ] **Step 1: Read prompts.ts fully to understand current prompt building**

Read the complete file to see how `buildSystemPrompt` works.

- [ ] **Step 2: Add Soul.md and personality injection**

Add a function to load Soul.md content and inject it along with the active personality into the system prompt:

```typescript
export function buildAgentSystemPrompt(
  soulPrompt: string,
  personalityFragment: string,
  basePrompt: string
): string {
  return [
    soulPrompt,
    '',
    '## Personality',
    personalityFragment,
    '',
    '## Task Context',
    basePrompt,
  ].join('\n')
}
```

- [ ] **Step 3: Update answer generation to include Soul.md**

In `ipc-handlers.ts`, when building the LLM request for answer generation, wrap the existing system prompt with `buildAgentSystemPrompt` using the current personality config.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add src/shared/prompts.ts src/main/ipc-handlers.ts
git commit -m "Inject Soul.md and personality into LLM system prompts"
```

---

### Task 25: End-to-end verification and cleanup

**Files:**
- Various

- [ ] **Step 1: Run the app and test the full flow**

Run: `npm run dev`

Verify:
- [ ] Canvas window appears (transparent, click-through)
- [ ] ControlBar is visible and draggable
- [ ] Presence indicator shows correct states (sleeping -> idle -> listening -> speaking)
- [ ] Starting a session activates the heartbeat
- [ ] Transcript appears in ControlBar
- [ ] Answer generation creates a Panel widget
- [ ] Chat input works and creates Panel widgets
- [ ] Bubbles appear when heartbeat detects something (may need to wait)
- [ ] Toasts appear for status events
- [ ] Dashboard opens and shows Agent Behavior settings
- [ ] Personality and interruption policy changes take effect
- [ ] Content protection works (test with screen sharing/recording)
- [ ] Keyboard shortcuts still work
- [ ] Stopping a session stops the heartbeat

- [ ] **Step 2: Verify production build**

Run: `npm run build`
Expected: Clean build with no errors or warnings.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "Phase 8 complete: proactive agent with canvas window system"
```

- [ ] **Step 4: Push**

```bash
git push
```
