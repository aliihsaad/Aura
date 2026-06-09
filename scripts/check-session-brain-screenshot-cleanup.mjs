// Verifies that timer-based session-brain screenshots are privacy-cleaned
// when a session stops, while caption/index metadata stays available.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const servicePath = path.resolve(here, '../src/main/services/agent/session-brain-service.ts')
const typesPath = path.resolve(here, '../src/shared/session-brain-types.ts')

const serviceSource = readFileSync(servicePath, 'utf8')
const typesSource = readFileSync(typesPath, 'utf8')

assert.match(
  serviceSource,
  /async\s+stop\(\):\s*Promise<void>\s*{[\s\S]*await\s+this\.cleanupBrainScreenshotImages\(\)/,
  'SessionBrainService.stop() must clean timer-based brain screenshot images at session end'
)

assert.match(
  serviceSource,
  /private\s+async\s+cleanupBrainScreenshotImages\(\):\s*Promise<void>/,
  'SessionBrainService must define cleanupBrainScreenshotImages()'
)

assert.match(
  serviceSource,
  /brainScreenshotsFolderPath\(this\.sessionFolderName\)/,
  'cleanup must target the brain screenshots folder, not top-level session screenshots'
)

assert.match(
  serviceSource,
  /await\s+fs\.unlink\(imagePath\)/,
  'cleanup must delete stored brain screenshot JPG files'
)

assert.match(
  serviceSource,
  /image_path:\s*null/,
  'cleanup must remove image_path references from index entries after deleting files'
)

assert.doesNotMatch(
  serviceSource,
  /Remove-Item|rm\s+-rf|rmdir|fs\.rm\([^)]*brainScreenshotsFolderPath/s,
  'cleanup must not recursively delete the screenshots folder or index.json'
)

assert.match(
  typesSource,
  /image_deleted_at\?:\s*number/,
  'BrainScreenshotEntry must record when a retained image was deleted'
)

console.log('check-session-brain-screenshot-cleanup: brain screenshot cleanup guardrails OK')
