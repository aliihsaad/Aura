# Session Quality Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 2026-05-16 normal-conversation test findings into a sequence of small, verifiable quality fixes.

**Architecture:** Keep session persistence, companion heartbeat, Detail answer routing, and session-brain output as separate work areas. Each phase adds one focused regression check before changing behavior, then verifies with the saved test session and a fresh live smoke session.

**Tech Stack:** Electron main process, TypeScript, static `scripts/check-*.mjs` regression guards, session artifacts under `%APPDATA%/whisphry/sessions`.

---

## Phase 0: Brain Screenshot Storage Cleanup

**Status:** Implemented in this branch.

**Files:**
- Modify: `src/main/services/agent/session-brain-service.ts`
- Modify: `src/shared/session-brain-types.ts`
- Create: `scripts/check-session-brain-screenshot-cleanup.mjs`
- Modify: `package.json`

- [x] Add a regression guard that requires `SessionBrainService.stop()` to clean `brain/screenshots/*.jpg`.
- [x] Delete only timer-based brain screenshot image files at session end.
- [x] Keep `brain/screenshots/index.json` with captions, timestamps, relevance scores, and `image_deleted_at`.
- [x] Leave top-level `screenshots/` untouched.
- [x] Wire the guard into `npm run check:release`.

**Acceptance:**
- A ended session has no `brain/screenshots/*.jpg`.
- `brain/screenshots/index.json`, `brain/summary.md`, `brain/final-summary.md`, `notes.md`, `answers.md`, and `transcript.md` remain.

## Phase 1: Real “Save Report To Notes” Artifact

**Status:** Implemented in this branch.

**Problem:** In the test session, the agent claimed it saved a detailed report, but `sessionNotes` was empty and `notes.md` contained only a short study-note extract.

**Files:**
- Modify: `src/main/services/session-runtime-store.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/services/context-manager.ts`
- Add or extend: `scripts/check-session-report-artifact.mjs`

- [x] Add an explicit session-report field in runtime state, separate from meeting notes and brain study notes.
- [x] Route user requests like “write/save a report to this session’s notes” to a deterministic writer, not a vague memory/save confirmation.
- [x] Render that report into `notes.md` under a `## Session Report` section.
- [x] Add a guard that fails if report commands can only produce a bubble confirmation.

**Acceptance:**
- Saying “write and save a detailed report for this session” creates visible report content in `notes.md`.
- The agent confirmation references the saved report title or section.

## Phase 2: Stronger Companion Turn Boundaries

**Status:** Implemented in this branch.

**Problem:** The companion answered incomplete turns such as “I want you...” and “Can you check the bonus...” before the user finished.

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/services/agent/heartbeat-service.ts`
- Add or extend: `scripts/check-companion-turn-boundaries.mjs`

- [x] Add a stricter “open clause” detector for phrases ending in connectors, requests without objects, and short continuations.
- [x] Increase debounce for open clauses and reset it when the next final transcript chunk arrives.
- [x] Keep fast replies for clear questions ending with `?`.
- [x] Record telemetry for the selected boundary class: `closed`, `open-clause`, `fragment`, or `continuation`.

**Acceptance:**
- The companion waits for “iteration five on my screen...” before answering “Can you check the bonus...”
- Short acknowledgements like “Okay” and “Cool” do not trigger answer generation.

## Phase 3: Detail Answer Duplicate Suppression

**Status:** Implemented in this branch.

**Problem:** Detail-window answers repeated after acknowledgements like “Correct. And it’s working.”

**Files:**
- Modify: `src/main/services/agent/heartbeat-service.ts`
- Modify: `src/main/ipc-handlers.ts`
- Add or extend: `scripts/check-detail-answer-dedupe.mjs`

- [x] Track the latest Detail answer fingerprint.
- [x] Treat “correct”, “it works”, “thanks”, and similar acknowledgements as non-regeneration turns.
- [x] Suppress a Detail route when the candidate answer overlaps heavily with the previous Detail answer and the latest user turn is an acknowledgement.
- [x] Emit telemetry when a duplicate Detail answer is suppressed.

**Acceptance:**
- After a full Iteration 5 answer, “Correct. And it’s working” produces at most a short bubble, not another full code block.

## Phase 4: Live Brain Screenshot Deduping

**Status:** Implemented in this branch.

**Problem:** Before end cleanup, a 23-minute session kept 131 near-duplicate brain screenshots and spent unnecessary disk while the session was active.

**Files:**
- Modify: `src/main/services/agent/session-brain-service.ts`
- Modify: `src/shared/session-brain-types.ts`
- Add or extend: `scripts/check-session-brain-screenshot-dedupe.mjs`

- [x] Add caption-level dedupe before saving a brain screenshot image.
- [x] Keep a new image only when relevance is high and caption/content meaningfully changed.
- [x] Track skipped duplicate screenshots in `index.json` without writing another JPG.
- [x] Lower the default max kept count after real-session verification.

**Acceptance:**
- A similar 20-25 minute coding session keeps a small representative set during the session, then deletes JPGs at stop.
- Captions remain enough to ground summaries.

## Phase 5: Study Notes Polish

**Status:** Implemented in this branch.

**Problem:** Study notes used UTC-like timestamps, missed visible code under `Code Shown`, and suggested generic React resources for a Promises lesson.

**Files:**
- Modify: `src/main/services/agent/session-brain-service.ts`
- Modify: `src/main/services/agent/session-brain-prompts.ts`
- Modify: `src/main/services/context-manager.ts`
- Add or extend: `scripts/check-study-notes-quality.mjs`

- [x] Render timestamps in the same local time as `transcript.md`.
- [x] Teach the brain summary prompt to extract visible function names and short code facts into `code_shown`.
- [x] Prefer targeted MDN Promise, async function, and Promise.all resources when those terms dominate the session.
- [x] Keep generic React docs only when React-specific terms dominate.

**Acceptance:**
- Notes from the async/promises test session show local `15:xx` times, include `obtainInstruction`, and recommend Promise/async resources before React.

## Execution Order

1. Ship Phase 0 immediately with release verification.
2. Implement Phase 1 next because it addresses a user-visible trust issue.
3. Implement Phase 2 before more live testing because it reduces noisy replies and token waste.
4. Implement Phase 3 after Phase 2 so duplicate suppression does not hide turn-boundary bugs.
5. Implement Phase 4 after Phase 0 has reduced privacy/storage risk at rest.
6. Implement Phase 5 last because it improves artifacts after the core behavior is stable.

## Verification Set

- `npm run check:session-brain-cleanup`
- `npm run check:session-intents`
- `npm run check:release`
- Manual live smoke: start a quick-help session, keep screen visible, end session, confirm `brain/screenshots/index.json` remains and brain JPGs are gone.
