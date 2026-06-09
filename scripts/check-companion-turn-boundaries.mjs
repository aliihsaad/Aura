// Verifies that Companion heartbeat trigger timing treats fragments/open
// clauses differently from closed turns, with telemetry for tuning.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const ipcSource = readFileSync(path.join(root, 'src/main/ipc-handlers.ts'), 'utf8')

assert.match(
  ipcSource,
  /type\s+TurnBoundaryClass\s*=\s*'closed'\s*\|\s*'open-clause'\s*\|\s*'fragment'\s*\|\s*'continuation'/,
  'ipc-handlers must classify turn boundaries as closed/open-clause/fragment/continuation'
)

assert.match(
  ipcSource,
  /function\s+classifyTurnBoundary\(/,
  'scheduleHeartbeatTrigger must use an explicit classifyTurnBoundary() helper'
)

assert.match(
  ipcSource,
  /HEARTBEAT_TRIGGER_DEBOUNCE_OPEN_MS\s*=\s*(?:2[0-9]{3}|[3-9][0-9]{3,})/,
  'open-clause debounce must wait at least 2000ms'
)

assert.match(
  ipcSource,
  /boundaryClass:\s*boundary\.kind/,
  'trigger telemetry must record the selected boundary class'
)

assert.match(
  ipcSource,
  /reason:\s*'fragment'/,
  'short fragments must be dropped instead of triggering answer generation'
)

assert.match(
  ipcSource,
  /reason:\s*'acknowledgement'/,
  'short acknowledgements like "Okay" and "Cool" must be dropped'
)

assert.match(
  ipcSource,
  /latest final turn looks open-ended/,
  'the open-clause path should be documented so future changes keep the wait behavior'
)

assert.match(
  ipcSource,
  /can\s*\|\s*could\s*\|\s*would\s*\|\s*should/,
  'open-clause detection must cover modal request starters like "can you"'
)

assert.match(
  ipcSource,
  /function\s+getFreshLocalVisionContext\(/,
  'Heartbeat local vision context callback must resolve to a defined helper.'
)

console.log('check-companion-turn-boundaries: heartbeat turn-boundary guardrails OK')
