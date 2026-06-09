// Verifies study-note timestamp, code extraction, and targeted resource quality.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const serviceSource = readFileSync(path.join(root, 'src/main/services/agent/session-brain-service.ts'), 'utf8')
const promptSource = readFileSync(path.join(root, 'src/main/services/agent/session-brain-prompts.ts'), 'utf8')

assert.match(
  serviceSource,
  /function\s+formatLocalBrainTime\(/,
  'brain transcript windows must use a local-time formatter'
)

assert.doesNotMatch(
  serviceSource,
  /toISOString\(\)\.slice\(11,\s*19\)/,
  'brain transcript timestamps must not use UTC ISO time'
)

assert.match(
  promptSource,
  /obtainInstruction|Promise\.all|function names/i,
  'summary prompt must explicitly preserve visible/heard code identifiers and Promise.all-style code facts'
)

assert.match(
  serviceSource,
  /MDN Promise/,
  'study resources must include a targeted MDN Promise reference'
)

assert.match(
  serviceSource,
  /MDN Promise\.all/,
  'study resources must include a targeted MDN Promise.all reference'
)

assert.match(
  serviceSource,
  /MDN async function/,
  'study resources must include a targeted MDN async function reference'
)

assert.match(
  serviceSource,
  /reactScore\s*>=\s*promiseScore/,
  'React docs should only outrank Promise resources when React-specific terms dominate'
)

console.log('check-study-notes-quality: study-note quality guardrails OK')
