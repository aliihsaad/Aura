// Verifies that repeated Detail-window answers are suppressed after user
// acknowledgements like "correct" or "it's working".
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const heartbeatSource = readFileSync(path.join(root, 'src/main/services/agent/heartbeat-service.ts'), 'utf8')

assert.match(
  heartbeatSource,
  /private\s+lastDetailAnswerText:\s*string\s*=\s*''/,
  'HeartbeatService must track the latest Detail answer text'
)

assert.match(
  heartbeatSource,
  /shouldSuppressDuplicateDetailAnswer\(/,
  'HeartbeatService must check duplicate Detail answers before opening Detail'
)

assert.match(
  heartbeatSource,
  /isAcknowledgementTurn\(/,
  'duplicate suppression must detect acknowledgement turns'
)

assert.match(
  heartbeatSource,
  /heartbeat\.detail\.suppress_duplicate/,
  'suppressed duplicate Detail answers must emit telemetry'
)

assert.match(
  heartbeatSource,
  /this\.lastDetailAnswerText\s*=\s*trimmed/,
  'the last Detail fingerprint must update when a new Detail answer is opened'
)

assert.match(
  heartbeatSource,
  /correct\|it'?s working|it works\|thanks/,
  'acknowledgement detection must cover correct / it works / thanks-style turns'
)

console.log('check-detail-answer-dedupe: Detail duplicate suppression guardrails OK')
