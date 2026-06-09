# Phase 8: Proactive Agent with Canvas Window System

## Overview

Transform Whisphry from a reactive assistant into a proactive desktop agent with its own identity, configurable personality, and a unified transparent canvas that replaces the current multi-window architecture.

This phase introduces:
- A core identity document (Soul.md) and selectable personality presets
- A full-screen transparent canvas window replacing the overlay, answer, and preview windows
- A widget-based rendering system on the canvas
- A heartbeat loop that proactively detects, saves, and surfaces knowledge
- Expanded agent tools for canvas interaction
- Configurable interruption policies

## Soul.md & Personality System

### Soul.md

Located at `src/shared/soul.md`. Loaded at app startup, injected into every LLM call as the base system identity.

Contents:
- **Core identity**: Who Whisphry is -- a local memory-native desktop companion that captures, remembers, and recalls knowledge for its user.
- **Values**: User privacy (everything local), helpful without being noisy, grows smarter over time through accumulated context.
- **Behavioral boundaries**: Never fabricate memories. Never act without confidence. Always respect the current interruption policy. Silence is better than noise.
- **Voice principles**: First-person, concise, natural tone. Not robotic or overly formal.

Soul.md is constant -- it does not change based on settings. It is who Whisphry *is* at its core.

### Personality Presets

Defined in `src/shared/personalities.ts` as structured objects. Each preset shapes the communication style and proactive behavior thresholds.

| Preset | Style | Auto Selection Signals |
|--------|-------|----------------------|
| **Focused** | Minimal, direct, code-friendly. Only speaks when confidence is very high. | Coding sessions, technical interview type, high transcript activity rate |
| **Balanced** | Friendly but concise. Surfaces context, occasionally suggests. | General sessions, moderate activity, default fallback |
| **Curious** | Asks questions, makes connections, more conversational. | Brainstorming, first sessions with new topics/companies, low-activity periods |

**Auto mode** selects a personality based on runtime signals:
- Interview type (coding/technical -> Focused, behavioral -> Balanced, general -> Curious)
- Transcript activity rate (high -> Focused, low -> Curious)
- Memory density for current context (many existing memories -> Focused, few -> Curious)
- Time since last user interaction (long gap -> Curious on resume)

Personality selection is persisted in config store. Exposed in dashboard Settings under "Agent Behavior."

## Canvas Window & Widget System

### Canvas Architecture

A single full-screen transparent `BrowserWindow` replaces the current overlay, answer, and preview windows.

Properties:
- Full-screen dimensions matching primary display work area
- Transparent background, no frame
- `alwaysOnTop: true`, `skipTaskbar: true`
- `setIgnoreMouseEvents(true, { forward: true })` by default -- all clicks pass through
- Content protection enabled (single call covers all widgets)
- Interactive regions toggled dynamically as widgets render/dismiss

When a widget renders, its bounding rectangle is registered as an interactive region. Hit-testing uses Electron's `setIgnoreMouseEvents(true, { forward: true })` which forwards mouse events to the window -- the canvas renderer then checks on `mousemove` whether the cursor is over any active widget region. If it is, the renderer calls `setIgnoreMouseEvents(false)` via IPC to make the canvas interactive. When the cursor leaves all widget regions, it calls `setIgnoreMouseEvents(true, { forward: true })` again. This approach uses the OS-level forwarding to track the cursor position even while click-through is active.

### WidgetManager (Main Process)

`src/main/services/canvas/widget-manager.ts`

Manages the lifecycle of all widgets on the canvas.

```typescript
interface Widget {
  id: string
  type: 'control-bar' | 'panel' | 'bubble' | 'toast'
  anchor: 'top-left' | 'top-right' | 'bottom-right' | 'center' | 'near-control-bar' | 'cursor'
  position: { x: number; y: number }
  size: { width: number; height: number }
  priority: number
  dismissable: boolean
  ttl: number | null  // ms, null = manual dismiss only
  props: Record<string, unknown>
}

class WidgetManager {
  register(type, id, anchor, props): Widget
  update(id, props): void
  dismiss(id): void
  dismissByType(type): void
  listActive(): Widget[]
  getInteractiveRegions(): Rect[]
}
```

Widget state is sent to the canvas renderer via IPC. The React layer renders all active widgets in a single composition.

### Widget Types

#### ControlBar
- Persistent top-left widget. Always visible when canvas is shown.
- Contains: drag handle, dropdown menu, chat input, transcript strip (expandable), presence indicator.
- Migrated from current overlay functionality.
- Not dismissable.

#### Panel
- Scrollable, draggable, resizable content surface.
- Subtypes via props: `answer`, `preview`, `context`.
- Multiple panels can be open simultaneously.
- Replaces current answer window and preview window.
- Dismissable. No TTL (manual close only).
- Adjustable font size (preserved from current answer/preview windows).

#### Bubble
- Small floating message near the ControlBar.
- Whisphry's proactive voice -- how the heartbeat communicates with the user.
- Click to expand into a Panel or dismiss.
- TTL: 30 seconds, then auto-dismisses. Dismissable manually.
- Stacks vertically if multiple bubbles are active (max 3, oldest dismissed first).

#### Toast
- Minimal notification bar. Appears near the top of the screen.
- Auto-fades after 3-4 seconds. Not interactive.
- Used for status updates: "Session started", "Memory saved", "Personality: Focused".
- No dismiss button needed.

### Canvas Renderer

Single React application replacing the current separate overlay renderer.

```
src/renderer/canvas/
  index.html
  main.tsx
  styles.css
  App.tsx                    # Root compositor
  components/
    ControlBar.tsx           # Migrated overlay controls + presence indicator
    Panel.tsx                # Answer/preview/context panels
    Bubble.tsx               # Proactive agent messages
    Toast.tsx                # Ephemeral notifications
    PresenceIndicator.tsx    # Animated agent state indicator
    WidgetShell.tsx          # Shared wrapper: drag, dismiss, resize handles
```

`App.tsx` receives widget state via IPC and renders all active widgets. Each widget component is wrapped in `WidgetShell` for consistent drag/dismiss/resize behavior.

## Agent Presence Indicator

A small animated element in the ControlBar reflecting Whisphry's current state.

| State | Animation | Trigger |
|-------|-----------|---------|
| **Idle** | Gentle slow pulse (breathing rhythm) | Session active, no recent events |
| **Listening** | Subtle waveform ripple | Audio is being transcribed |
| **Thinking** | Faster pulse, slightly brighter | Heartbeat LLM call in progress |
| **Speaking** | Animated voice waveform (mini equalizer) | Whisphry is surfacing a bubble or panel |
| **Sleeping** | Static dot, dim | No active session |

Positioned in the ControlBar, left side near the drag handle. Driven by state changes from HeartbeatService and audio capture pipeline. No extra LLM calls needed.

## Agent Tools

### Existing Tools (unchanged)

| Tool | Purpose |
|------|---------|
| `recall_memory` | Search past memories by query |
| `save_memory` | Save a memory with title, summary, type |

### New Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `show_bubble` | Display a proactive bubble message | `message: string`, `urgency: 'low' | 'medium' | 'high'`, `expandable: boolean` |
| `show_panel` | Open a panel with content | `title: string`, `content: string`, `panel_type: 'answer' | 'preview' | 'context'` |
| `show_toast` | Flash a brief notification | `message: string` |
| `dismiss_widget` | Close a widget by id | `widget_id: string` |
| `search_artifacts` | Search screenshots, transcripts, files | `query: string`, `type?: string`, `session?: string` |

### Tool Boundaries

The agent does NOT get tools for:
- Direct window manipulation (move, resize, hide canvas) -- user territory
- `capture_screenshot` -- user-initiated via keyboard shortcut
- `start_session` / `stop_session` -- user controls session lifecycle
- Dashboard control -- separate window, user-managed

## Interruption Policy

Controls which canvas tools the agent is allowed to use proactively. Acts as a gate between the HeartbeatService and the WidgetManager.

Defined in `src/main/services/agent/interruption-policy.ts`.

| Policy | Behavior |
|--------|----------|
| **Silent** | Agent can `save_memory` and `recall_memory` but all canvas tools (`show_bubble`, `show_panel`, `show_toast`) are suppressed. Memories are staged silently. |
| **Ask First** | `show_bubble` is allowed (minimal nudge). `show_panel` requires user click on the bubble to expand. `show_toast` allowed for confirmations. |
| **Proactive** | All tools allowed. Agent can open panels directly when confidence is high. |
| **Auto** | Adapts based on activity. During active conversation -> Ask First. During pauses (>30s no new events) -> Proactive. During high-frequency input -> Silent. |

Persisted in config store. Default: **Ask First**.

## Heartbeat Service

`src/main/services/agent/heartbeat-service.ts`

### Tick Loop

Runs in the main process. Ticks every 15 seconds during an active session (configurable 10-30s range). Paused when no session is active.

```
tick()
  1. Collect recent events since last tick
  2. If nothing new -> skip (no LLM call)
  3. Build context snapshot:
     - Last N transcript entries (since last tick or last 10, whichever is smaller)
     - Current session context (company, role, interview type, subject)
     - Active personality preset
     - Recent memories from this session (last 5)
     - Current interruption policy
  4. Send snapshot to LLM with Soul.md + personality instructions + tool definitions
  5. LLM decides:
     - Do nothing (most ticks -- silence is the default)
     - save_memory (spotted something worth remembering)
     - show_bubble (noticed something relevant to surface)
     - recall_memory -> show_panel (proactively pull up past context)
  6. Execute returned tool calls through interruption policy gate
  7. Update cooldown timers
```

### Cooldowns

| Action | Cooldown |
|--------|----------|
| `show_bubble` | 60 seconds between bubbles |
| `show_panel` | 120 seconds between unsolicited panels |
| `save_memory` | 10 seconds between saves |
| Any proactive action | 30 seconds global minimum |

### Confidence Gating

The heartbeat prompt instructs the LLM:
- "Do nothing if you are unsure. Silence is always acceptable."
- "Only surface something if you are confident it would genuinely help the user right now."
- Personality adjusts the threshold: Focused = very high bar, Balanced = moderate, Curious = slightly lower.

### Cost Control

- Most ticks skip (no new events = no LLM call)
- Context snapshots are short (recent events only, not full history)
- Uses the same model as answer generation (user's configured model)
- Estimated: 2-5 LLM calls per minute during active conversation, near-zero during pauses
- Heartbeat can be disabled entirely via settings toggle

## Settings Integration

New settings group in Dashboard Settings tab: **"Agent Behavior"**

| Setting | Type | Default | Range |
|---------|------|---------|-------|
| Personality | Dropdown | Auto | Focused / Balanced / Curious / Auto |
| Interruption Policy | Dropdown | Ask First | Silent / Ask First / Proactive / Auto |
| Heartbeat Interval | Slider | 15s | 10s - 30s |
| Enable Heartbeat | Toggle | On | On / Off |

Persisted in config store alongside existing settings. No new settings window -- just a new section in the existing Settings tab.

## File & Module Structure

### New Files

```
src/shared/
  soul.md                              # Core agent identity
  personalities.ts                     # Presets + Auto selection logic

src/main/services/
  agent/
    heartbeat-service.ts               # Tick loop, snapshot, LLM dispatch
    interruption-policy.ts             # Canvas tool gate logic

  canvas/
    widget-manager.ts                  # Widget lifecycle and registry
    widget-types.ts                    # Type definitions, anchor rules, defaults

src/renderer/canvas/
  index.html                           # Canvas entry point
  main.tsx                             # React bootstrap
  styles.css
  App.tsx                              # Root widget compositor
  components/
    ControlBar.tsx                     # Overlay controls + presence indicator
    Panel.tsx                          # Answer/preview/context surface
    Bubble.tsx                         # Proactive messages
    Toast.tsx                          # Ephemeral notifications
    PresenceIndicator.tsx              # Animated state indicator
    WidgetShell.tsx                    # Shared drag/dismiss/resize wrapper
```

### Modified Files

- `windows.ts` -- replace `createOverlayWindow` + `createAnswerWindow` + `createPreviewWindow` with `createCanvasWindow`
- `ipc-handlers.ts` -- add widget IPC channels, heartbeat control, personality/interruption config reads/writes
- `agent/tool-definitions.ts` -- add `show_bubble`, `show_panel`, `show_toast`, `dismiss_widget`, `search_artifacts`
- `types.ts` -- add Widget, HeartbeatState, Personality, InterruptionPolicy types
- `preload/index.ts` -- expose widget IPC to canvas renderer
- `constants.ts` -- heartbeat defaults, cooldown values, widget TTLs
- `electron.vite.config.ts` -- swap overlay entry for canvas entry

### Removed After Migration

- `src/renderer/overlay/` -- fully replaced by canvas renderer
- Overlay/answer/preview window creation functions in `windows.ts`

### Untouched

- `src/renderer/settings/` -- Dashboard stays, gains Agent Behavior section
- All memory layer files (stores, recall, embeddings, extraction, entities, relations)

## Migration Strategy

Four steps, each independently testable and committable. The app is never in a broken state between steps.

### Step 1: Foundation (no visible changes)
- Add Soul.md, personalities.ts, widget type definitions, interruption policy module
- Add HeartbeatService (disabled by default, no canvas wiring yet)
- Expand tool definitions (new tools are no-ops until canvas exists)
- Add new types to types.ts and constants to constants.ts

### Step 2: Canvas window + WidgetManager
- Create canvas BrowserWindow in windows.ts
- Build WidgetManager in main process
- Build canvas React app: App.tsx, WidgetShell, ControlBar, Panel, Bubble, Toast, PresenceIndicator
- Wire WidgetManager <-> canvas renderer IPC
- Canvas exists but is not active -- old windows still used

### Step 3: Swap windows
- Route overlay -> ControlBar widget on canvas
- Route answer window -> Panel widget (answer type)
- Route preview window -> Panel widget (preview type)
- Update all IPC handlers to target canvas/WidgetManager instead of old windows
- Remove old overlay/answer/preview window creation code
- Remove `src/renderer/overlay/`
- At this point the app works exactly as before, rendered on the canvas

### Step 4: Activate agent features
- Wire HeartbeatService to canvas tools via WidgetManager
- Connect interruption policy gating to tool executor
- Connect personality selection to LLM prompt construction
- Add Agent Behavior section to dashboard Settings tab
- Activate presence indicator animations driven by HeartbeatService state
- End-to-end testing of proactive behavior
