# Whisphry

> A local-first desktop companion that listens, watches, remembers, and helps in real time.

[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows--first-lightgrey)]()

## Overview

Whisphry is an always-on-top desktop agent built around three ideas:

- capture what is happening around the user in real time
- keep a local, structured memory of sessions, screenshots, artifacts, and extracted signals
- provide grounded help through overlays, bubbles, answer windows, and a live voice/text agent

The app still contains a strong interview-assistant workflow today, but it is no longer just an interview helper. The current codebase supports broader desktop-assistant behavior: live context capture, screen inspection, artifact preview, memory recall, proactive nudges, and configurable companion text/voice modes.

## What It Does

### Real-time session capture

- Captures system/interviewer audio and optional user mic audio
- Streams transcription through Deepgram
- Stores session transcript, generated answers, screenshots, and session metadata
- Saves sessions automatically on stop, including screenshot-heavy sessions

### Grounded on-screen help

- Captures screenshots on demand
- Runs screenshot analysis through vision-capable LLM paths
- Supports proactive screen tracking when the interruption policy resolves to proactive
- Keeps the latest grounded screen summary in runtime context for the agent

### Agent modes

Two modes, both powered by OpenRouter:

- **Interview / Meeting**: the standard answer pipeline. Live transcript → utterance-end → grounded answer in the answer window. Optional proactive nudges from the heartbeat.
- **Companion** (text + optional voice): the heartbeat replies as short floating bubbles on the canvas window. Enable voice from the overlay control bar and Deepgram Aura speaks the replies aloud.
- Companion tools can use memory recall, screen analysis, web search, image generation, preview, answer-window routing, clipboard handoff, and more — but **not** terminal commands or workspace file edits (Workspace mode was removed; the app is focused on the ambient memory-companion layer, not coding-agent execution).

### Shared conversation memory

Every agent surface — heartbeat bubbles, the answer window, and the overlay chat input — reads from and writes to one shared per-session dialog log (`ConversationLogService`). Each heartbeat tick assembles a real multi-turn messages array (`system + recent dialog alternations + context snapshot`) instead of re-deriving an answer from a flat transcript snapshot, so the agent can see its own prior replies and the user's recent turns as a genuine conversation. The log is cleared on session start and dumped to `sessions/{folder}/conversation.jsonl` on stop.

### Local memory system

- Stores events, artifacts, memories, entities, relations, and embeddings locally
- Builds recall context from recent transcript, session metadata, prior memories, and artifacts
- Exposes memory-aware tools such as `recall_memory`, `save_memory`, `search_artifacts`, and `get_session_context`

### Multi-window desktop UI

- Compact live control overlay
- Floating answer window for detailed output
- Preview window for files, transcripts, PDFs, saved images, and script playback
- Teleprompter-style script player with timer playback, mic-follow mode, large line-by-line text, next-word highlighting, and emoji-safe script parsing
- Full-screen transparent canvas for proactive bubbles, toasts, and panels
- Settings / control center for sessions, memory, profile, and configuration

### Privacy and control

- Content-protected windows can be hidden from screen capture
- API keys are stored locally and encrypted at rest with Electron `safeStorage` when available
- Core state is stored in local Electron app data

## Current Product Shape

Whisphry is best described today as a local desktop copilot with an interview-ready workflow built in.

That means:

- it is not only an "interview answer generator"
- it is not only a "chat overlay"
- it is not yet a generic OS automation agent

The strongest current flows are:

- live sessions with transcript + answer generation
- screen-aware help
- proactive reminders/bubbles
- memory recall across sessions
- Companion text/voice guidance

## Windows and Surfaces

The app currently runs across five Electron windows:

| Surface | Purpose |
| --- | --- |
| Overlay | Main control bar, transcript, session controls |
| Answer Window | Detailed structured answer output |
| Preview Window | In-app preview for text, markdown, PDFs, saved images, and teleprompter-style script playback |
| Canvas Window | Transparent bubble/panel/toast layer and companion voice playback |
| Settings Window | Control center for sessions, memory, profile, and app configuration |

## Script Player

The Preview Window includes a script player for presentation or rehearsal workflows.

- Drop in a `.txt`, `.md`, or converted PDF script.
- Click `Script`, then use play for timed line-by-line playback.
- Use mic tracking to follow your spoken words through the script.
- Presentation mode hides the preview chrome and shows large floating text, highlights the next word, and shows the next line underneath at lower opacity.
- Emoji and symbol-only content are ignored for voice tracking so scripts with decorative icons do not block progression.

## Agent Tooling

Whisphry currently exposes two classes of agent tools.

### Core tools

These are available to the main answer pipeline and internal agent behavior.

- `recall_memory`
- `save_memory`
- `get_session_context`
- `analyze_current_screen`
- `show_bubble`
- `show_panel`
- `show_toast`
- `dismiss_widget`
- `search_artifacts`

### Companion tools

These are available to companion text and voice modes when enabled.

- `insert_solution_into_editor`
- `run_code_analysis_on_screen`
- `summarize_current_task`
- `preview_recent_artifact`
- `open_answer_window`
- `solve_with_openrouter`
- `open_recent_artifact`
- `save_answer_as_memory`

The Settings page shows the current tool catalog. Core tools are locked; companion tools can be toggled on or off.

## Architecture

### Runtime flow

```text
Audio + screen + session context
  -> event capture
  -> artifact persistence
  -> memory extraction
  -> entity / relation updates
  -> recall context assembly
  -> answer pipeline or companion tool use
  -> overlay / canvas / answer / preview surfaces
```

### Main subsystems

- `SessionRuntimeStore`: in-memory runtime state for active sessions
- `ContextManager`: profile, context, sessions, and app-data file handling
- `ConversationLogService`: the shared per-session dialog log read/written by the heartbeat, answer pipeline, and chat input
- `MemoryPipelineService`: event + artifact -> memory pipeline
- `RecallService`: hybrid retrieval across local memories and artifacts
- `HeartbeatService`: proactive and companion background review loop using OpenRouter; builds its messages array from the ConversationLog
- `CompanionTtsService`: Deepgram Aura text-to-speech output for Companion Voice mode
- `WidgetManager`: canvas widgets such as bubbles, toasts, and panels

## Setup

### Prerequisites

- Node.js 20+
- An OpenRouter API key for answer generation, screen analysis, and PDF conversion
- A Deepgram API key for transcription
- A Deepgram API key for optional Companion Voice audio

### Install

```bash
git clone https://github.com/aliihsaad/whisphry.git
cd whisphry
npm install
```

### Run in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Package

```bash
npm run package
```

Additional packaging scripts exist for macOS:

```bash
npm run package:mac
npm run package:all
```

## First Run

1. Launch the app.
2. Open the Settings / Control Center.
3. Add your API keys.
4. Choose your default model and optional coding model.
5. Choose Interview / Meeting or Companion mode (toggle Companion voice from the overlay control bar).
6. Start a session.

The settings window includes:

- Session control and history
- Memory browser
- Profile / context upload
- API keys and agent behavior
- Companion tool controls

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+O` | Toggle overlay visibility |
| `Ctrl+Shift+S` | Start / stop session |
| `Ctrl+Shift+C` | Capture screen |
| `Ctrl+Shift+R` | Regenerate answer |
| `Ctrl+Shift+H` | Hide overlay |

## Configuration

Most configuration is managed from the Settings UI and stored locally with `electron-store`.

Environment variables are optional fallbacks:

```env
# OPENROUTER_API_KEY=...
# DEEPGRAM_API_KEY=...
DEFAULT_MODEL=google/gemini-3-flash-preview
```

Important runtime settings include:

- default model
- coding model
- companion mode and optional Aura voice
- bubble size and typography
- interruption policy and personality
- content protection
- companion tool toggles

## Tech Stack

- Electron 41
- React 19
- TypeScript 5.9
- Tailwind CSS 4
- electron-vite
- Deepgram SDK
- OpenRouter API
- `@xenova/transformers` for local embeddings
- `electron-store` for local persistence

## Project Structure

```text
src/
  main/
    main.ts
    windows.ts
    ipc-handlers.ts
    audio/
    services/
      agent/
      canvas/
      memory/
      conversation-log-service.ts
      stt-service.ts
      llm-service.ts
      screenshot-analysis-service.ts
      session-persistence-service.ts
      session-runtime-store.ts
  preload/
    index.ts
  renderer/
    overlay/
    canvas/
    settings/
  shared/
    types.ts
    prompts.ts
    soul.md
    personalities.ts
    agent-tool-catalog.ts
```

## Notes and Limitations

- The product language in a few parts of the app still reflects its interview-assistant roots.
- The standard answer flow is still optimized for interview-style session support.
- Companion Voice is optional and depends on the Deepgram key already used for transcription.
- Windows is the primary supported environment in day-to-day use.

## License

MIT
