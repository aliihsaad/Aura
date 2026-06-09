// Verifies live session-brain screenshot dedupe/pruning before session stop.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const serviceSource = readFileSync(path.join(root, 'src/main/services/agent/session-brain-service.ts'), 'utf8')
const typesSource = readFileSync(path.join(root, 'src/shared/session-brain-types.ts'), 'utf8')
const constantsSource = readFileSync(path.join(root, 'src/shared/constants.ts'), 'utf8')

assert.match(
  serviceSource,
  /findDuplicateBrainScreenshot\(/,
  'session brain must check caption-level duplicate screenshots before saving another JPG'
)

assert.match(
  serviceSource,
  /duplicate_of:\s*duplicateOf/,
  'duplicate screenshots must be tracked in index.json with duplicate_of metadata'
)

assert.match(
  serviceSource,
  /image_skipped_reason:\s*skipReason/,
  'skipped screenshots must explain why no image was written'
)

assert.match(
  serviceSource,
  /const\s+kept\s*=\s*rating\.relevance_score\s*>=\s*this\.deps\.config\.brainScreenshotKeepThreshold\s*&&\s*!duplicateOf/,
  'a screenshot image should be kept only when relevant and meaningfully changed'
)

assert.match(
  typesSource,
  /duplicate_of\?:\s*string/,
  'BrainScreenshotEntry must include duplicate_of metadata'
)

assert.match(
  typesSource,
  /image_skipped_reason\?:\s*'low-relevance'\s*\|\s*'duplicate'/,
  'BrainScreenshotEntry must include low-relevance/duplicate skip reasons'
)

assert.match(
  constantsSource,
  /brainScreenshotMaxKept:\s*(?:[1-9]|[1-5][0-9]|60),/,
  'default live kept screenshot cap should be lowered to 60 or less'
)

console.log('check-session-brain-screenshot-dedupe: live screenshot dedupe guardrails OK')
