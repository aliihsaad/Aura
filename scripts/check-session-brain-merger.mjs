// Verifies the brain merger pure functions. Style mirrors check-session-pause-surface.mjs.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const modulePath = path.resolve(here, '../src/main/services/agent/session-brain-merger.ts')

const src = readFileSync(modulePath, 'utf8')

const required = ['emptySummaryDoc', 'mergeSummaryDelta', 'renderSummaryMarkdown', 'applySubjectDrift']
for (const name of required) {
  assert.match(src, new RegExp(`export\\s+function\\s+${name}\\b`), `expected export ${name}`)
}

console.log('check-session-brain-merger: all exports present')
