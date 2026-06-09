# Whisphry App Master Plan

## Purpose

This document turns the high-level second-brain vision in [master-plan.md](./master-plan.md) into a build plan for the codebase that currently exists in this repo.

The app is **not** starting from scratch. It is starting from a functional Electron scaffold that already has:

- multi-window desktop UI
- live audio capture and transcription
- screenshot capture
- local file persistence
- LLM calls
- session history
- settings/profile/context management

The goal is to transform that scaffold into **Whisphry**, a local memory-native desktop agent.

Whisphry is a fully independent product. The reused codebase is an implementation shortcut only; it should not constrain app identity, storage boundaries, domain terminology, or long-term architecture.

## Product Direction

Whisphry should evolve from:

- a live interview assistant that captures transcript and generates answers

Into:

- a local second-brain agent that captures events
- stores artifacts and structured memory
- recalls context when relevant
- surfaces assistance through UI, voice, and tools

This means the current codebase should be treated as an **operational shell**, not as the final product model.

The practical rule is:

- keep whatever infrastructure is useful
- rename or replace anything that still reflects the old app model
- do not preserve the old app's concepts unless they remain technically useful for Whisphry

## Current Baseline

### What the codebase already gives us

- `src/main/main.ts`
  - app bootstrap
  - Electron permission setup
  - window creation
  - global shortcuts
  - tray wiring

- `src/main/windows.ts`
  - overlay, answer, preview, and settings windows
  - content protection
  - always-on-top behavior
  - window bounds helpers

- `src/main/ipc-handlers.ts`
  - main orchestration layer
  - session lifecycle
  - transcript accumulation
  - answer generation flow
  - screenshot capture flow
  - config/context IPC

- `src/main/audio/capture.ts`
  - renderer-to-main audio transport

- `src/main/services/stt-service.ts`
  - real-time Deepgram transcription

- `src/main/services/screen-capture.ts`
  - screenshot capture service

- `src/main/services/llm-service.ts`
  - answer generation
  - screenshot analysis
  - transcript cleanup
  - resume and PDF conversion support

- `src/main/services/context-manager.ts`
  - profile/session context
  - local app-data folders
  - file context loading
  - session save/list/export/delete
  - screenshot file persistence

- `src/renderer/overlay/*`
  - compact live UI shell
  - transcript display
  - answer display
  - manual controls

- `src/renderer/settings/*`
  - settings/dashboard shell
  - profile/context management
  - session history UI

### What is missing for Whisphry

- canonical event model
- canonical artifact model
- canonical memory model
- entities and relationships
- recall ranking engine
- embeddings and semantic retrieval
- tool-oriented agent layer
- proactive heartbeat loop
- bubble / voice delivery modes
- app identity aligned to Whisphry instead of interview coaching

## Transformation Principles

1. Do not do a big-bang rewrite.
2. Preserve the working Electron shell and incrementally replace the product logic inside it.
3. Stabilize the current runtime before adding autonomous behavior.
4. Move from ad hoc session-centric state to canonical event/artifact/memory storage.
5. Keep local-first architecture as the default.
6. Favor modular extraction over growing `ipc-handlers.ts` further.

## Architectural Mapping

The current code maps to the target system like this:

### Existing -> Future

- `stt-service.ts` -> event ingestion for spoken/audio events
- `screen-capture.ts` -> artifact ingestion for screenshots
- `llm-service.ts` -> extraction/summarization/rewrite engine
- `context-manager.ts` -> temporary storage layer that should be split into dedicated stores
- overlay window -> future live capture/control surface
- answer window -> future bubble / assistant response surface
- preview window -> future artifact viewer
- settings window -> future memory browser, entity manager, and system config

### Required new domain layers

- `events`
  - raw observations from transcript, screenshots, input, and tool calls

- `artifacts`
  - screenshots, transcripts, exported files, OCR text, derived docs

- `memories`
  - summaries, facts, tasks, notes, insights, linked references

- `entities`
  - people, projects, companies, tools, topics, routines

- `tools`
  - app-internal commands used by the assistant instead of direct ad hoc state mutation

## Target Module Shape

This is the direction the codebase should move toward:

```text
src/main/
  main.ts
  windows.ts
  ipc/
    app-ipc.ts
    capture-ipc.ts
    memory-ipc.ts
    settings-ipc.ts
  services/
    capture/
      stt-service.ts
      screen-capture.ts
      ocr-service.ts
    memory/
      event-store.ts
      artifact-store.ts
      memory-store.ts
      entity-store.ts
      recall-service.ts
      embedding-service.ts
      extraction-service.ts
      heartbeat-service.ts
    agent/
      tool-registry.ts
      tool-executor.ts
      response-orchestrator.ts
    app/
      config-service.ts
      profile-service.ts
      session-service.ts
```

This does **not** need to be created all at once. It is the target structure for phased extraction.

## Storage Plan

### Near-term

Keep the current filesystem-backed app data working while restructuring the app.

Current strengths:

- session folders already exist
- screenshots already persist to disk
- transcript and answer exports already exist

Current limitation:

- storage is session-oriented and not suitable yet for cross-session recall
- current folder names and store file names are temporary bootstrap internals, not stable public architecture

### Independence requirement

Whisphry must own its storage model completely.

That means:

- the current `electron-store` layout is transitional
- the current app-data directory shape is transitional
- the final database and artifact directory structure should be designed for Whisphry directly, not adapted around the old app's assumptions
- migration support should exist, but compatibility with the bootstrap layout is not a product goal by itself

### Medium-term

Introduce a local database as the canonical memory layer.

Recommended choice:

- SQLite for structured tables and indexes
- filesystem for large binary artifacts

Recommended split:

- database
  - events
  - artifacts metadata
  - memories
  - entities
  - links
  - embeddings metadata

- filesystem
  - images
  - transcripts
  - imported documents
  - cached derivatives

## Canonical Data Model

### Phase target tables

- `sessions`
  - session metadata and lifecycle

- `events`
  - raw transcript chunks
  - screenshots captured
  - manual inputs
  - tool calls

- `artifacts`
  - screenshot files
  - transcript exports
  - imported docs
  - generated markdown/text outputs

- `memories`
  - facts
  - notes
  - tasks
  - summaries
  - insights

- `entities`
  - person
  - project
  - company
  - tool
  - routine
  - topic

- `entity_attributes`
  - flexible metadata for entities

- `memory_links`
  - memory-to-memory and memory-to-entity relations

- `embeddings`
  - vectors or vector references for recall

## Phased Build Plan

## Phase 0 - Identity Reset

### Goal

Stop treating the app as an interview product at the naming and documentation layer.

### Work

- rename package/app metadata from `interview-assistant` to `whisphry`
- update README and packaging text
- replace interview-specific framing in docs with scaffold-to-Whisphry framing
- explicitly state that the old folder layout and store/database logic are temporary bootstrap infrastructure
- keep current feature behavior intact

### Files most affected

- `package.json`
- `README.md`
- `PACKAGING.md`
- `src/main/main.ts`
- `src/main/windows.ts`
- renderer labels and copy

## Phase 1 - Platform Stabilization

### Goal

Finish hardening the inherited shell before adding new product layers.

### Why this comes first

The current app already has the capture and window foundation we need. If window state, capture, or IPC reliability is weak, every new memory feature will be harder to trust.

### Work

- verify overlay, answer, preview, and settings window behavior
- reduce central orchestration risk inside `ipc-handlers.ts`
- improve error surfaces for capture and LLM failures
- persist critical window state cleanly
- ensure repeated session start/stop does not leak listeners or stale state
- identify inherited storage assumptions that should be isolated behind Whisphry-owned services

### Exit criteria

- sessions can start/stop repeatedly without breakage
- screenshot flow is reliable
- transcript flow is reliable
- window interaction is predictable

## Phase 2 - Capture Model Refactor

### Goal

Convert current interview-session logic into a general event ingestion layer.

### Conceptual change

Current model:

- transcript -> infer interview question -> generate answer

Future model:

- capture raw event -> store event -> derive meaning -> optionally surface response

### Work

- define `EventRecord` types for transcript, screenshot, manual input, tool call, and system event
- write all raw observations into an event store
- make the current session transcript an event-backed view rather than the primary source of truth
- separate capture from response generation
- start renaming inherited domain terminology where it blocks the new model

### Files likely affected

- `src/shared/types.ts`
- `src/main/ipc-handlers.ts`
- new `src/main/services/memory/event-store.ts`

## Phase 3 - Artifact Layer

### Goal

Turn existing saved files into first-class artifacts with metadata and provenance.

### Work

- register screenshots as artifacts instead of just filenames
- register transcript exports and imported docs as artifacts
- add artifact type, source event, timestamp, tags, and path metadata
- add artifact browsing support in the settings window

### Reuse from current code

- screenshot saving in `context-manager.ts`
- session export logic in `context-manager.ts`
- preview window as an artifact viewer base

## Phase 4 - Memory Extraction Layer

### Goal

Generate structured memories from captured events and artifacts.

### Work

- create a memory extraction service
- produce typed memories such as:
  - note
  - task
  - summary
  - fact
  - insight
- assign confidence and importance
- link memories to source events and artifacts
- store extraction outputs independently from UI state

### Reuse from current code

- `llm-service.ts` for summarization/rewrite calls
- prompt building patterns in `src/shared/prompts.ts`

## Phase 5 - Entity Graph

### Goal

Introduce durable cross-session context centered on entities rather than isolated sessions.

### Work

- create entity types for user, project, company, tool, routine, topic
- derive entity references from memories and artifacts
- support links such as:
  - memory -> entity
  - memory -> memory
  - artifact -> entity
  - session -> project

### Why this matters

This is what allows Whisphry to behave like a second brain instead of a session logger.

## Phase 6 - Recall Engine

### Goal

Retrieve relevant context on demand using more than simple recency.

### Ranking inputs

- semantic similarity
- recency
- importance
- tag overlap
- entity overlap
- session/project match

### Work

- add embeddings pipeline
- index recallable memories and artifacts
- implement recall ranking service
- expose recall in the UI and internal tool layer

## Phase 7 - Tool System

### Goal

Replace direct ad hoc orchestration with an internal tool-driven assistant model.

### Core tools

- `save_memory`
- `recall_memory`
- `search_artifacts`
- `open_artifact`
- `show_bubble`
- `speak_text`

### Work

- define tool registry and tool contracts
- route assistant actions through tool execution
- keep tools as the only write path for agent-side memory actions

## Phase 8 - Proactive Assistant Loop

### Goal

Add the heartbeat behavior described in the transformation plan.

### Work

- periodic scan every 10-30 seconds
- detect likely memories, notes, and tasks
- assign confidence
- save or stage candidate memories
- enforce cooldowns and interruption rules

### Future product idea

Whisphry may occasionally ask the user short, well-timed discovery questions while they are working in order to learn preferences, fill missing context, or improve future assistance.

Examples:

- clarifying what a current project is about
- asking how the user prefers certain types of help
- confirming whether a repeated pattern is important enough to remember
- collecting lightweight profile information that would improve recall and responses

Constraints:

- questions must be infrequent and interruption-aware
- only ask when confidence is high that the answer would materially improve Whisphry's usefulness
- allow the user to defer, mute, or permanently disable this behavior
- store answers as structured profile/entity/memory data rather than leaving them as loose chat text

### Important constraint

This phase should only begin after events, artifacts, memories, and recall are stable enough to trust.

## Phase 9 - New Delivery Surfaces

### Goal

Evolve the current answer window into Whisphry-native delivery modes.

### Modes

- silent
- bubble
- voice

### Reuse from current UI

- current answer window -> bubble surface
- current overlay -> capture and quick-action surface
- current settings window -> control center and memory browser

## First Implementation Sequence

This is the recommended order for actual work starting now.

1. Rebrand the app at the repo and UI level.
2. Finish stabilization and refactor pressure points in `ipc-handlers.ts`.
3. Define shared domain types for events, artifacts, memories, and entities.
4. Introduce a first event store without removing current session functionality.
5. Register screenshots and transcripts as artifacts.
6. Add a first extraction pipeline that produces draft memories from transcripts and screenshots.
7. Add a simple recall panel in settings before attempting proactive behavior.
8. Only after recall is working, add heartbeat and voice/bubble automation.

## Immediate Sprint

### Sprint goal

Create the minimum Whisphry foundation without breaking the existing app shell.

### Sprint scope

- rename app identity
- reduce interview-specific naming where it blocks new architecture
- split storage concerns out of `context-manager.ts`
- define first domain models in `src/shared/types.ts`
- add a basic event store service
- make the storage plan explicitly independent from the bootstrap app's folder/database assumptions
- keep existing session save/list behavior working during the transition

### Explicitly not in this sprint

- full autonomous loop
- full entity graph
- production-grade embeddings
- full voice system

## Risks

### Risk 1

`ipc-handlers.ts` is currently too central. If new product logic keeps landing there, the codebase will become harder to untangle.

### Risk 2

Interview-specific terminology is embedded in prompts, types, UI copy, and persistence. Renaming without defining replacement concepts will create confusion.

### Risk 3

If a database is added too early without a clear domain model, the app will simply move current coupling into new tables.

### Risk 4

If proactive features land before recall quality is good, the app will feel noisy instead of intelligent.

## Definition of Success

Whisphry is on the right track when:

- the app is still stable as a desktop shell
- capture is event-based instead of only session-based
- screenshots and transcripts are artifacts with metadata
- extracted memories exist independently from UI sessions
- recall works across sessions and projects
- the assistant can surface help through tools instead of direct hard-coded flows

At that point, the inherited interview-assistant scaffold has been successfully converted into a real Whisphry foundation.
