// Verifies that explicit "save/write a report to notes" requests create a
// real session report artifact rendered into notes.md, not just a chat bubble.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

const typesSource = read('src/shared/types.ts')
const runtimeSource = read('src/main/services/session-runtime-store.ts')
const persistenceSource = read('src/main/services/session-persistence-service.ts')
const contextSource = read('src/main/services/context-manager.ts')
const ipcSource = read('src/main/ipc-handlers.ts')

assert.match(
  typesSource,
  /export\s+interface\s+SessionReport[\s\S]*markdown:\s*string/,
  'shared types must define a SessionReport with persisted markdown content'
)

assert.match(
  typesSource,
  /sessionReport\?:\s*SessionReport/,
  'SessionRecord must persist an optional sessionReport'
)

assert.match(
  runtimeSource,
  /currentSessionReport:\s*SessionReport\s*\|\s*null\s*=\s*null/,
  'runtime store must keep the current session report separately from meeting notes'
)

assert.match(
  persistenceSource,
  /sessionReport:\s*options\.sessionReport\s*\?\?\s*undefined/,
  'session persistence must copy the runtime session report into the saved record'
)

assert.match(
  contextSource,
  /## Session Report/,
  'notes.md must render a visible "## Session Report" section'
)

assert.match(
  ipcSource,
  /isSessionReportRequest/,
  'ipc flow must detect explicit session-report requests deterministically'
)

assert.match(
  ipcSource,
  /createSessionReportArtifact/,
  'ipc flow must create a concrete report artifact instead of relying only on LLM confirmation'
)

assert.match(
  ipcSource,
  /Saved report to notes\.md: Session Report/,
  'the deterministic confirmation must reference the saved report section'
)

console.log('check-session-report-artifact: session report artifact guardrails OK')
