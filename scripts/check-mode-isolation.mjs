#!/usr/bin/env node
/**
 * Mode-isolation lint guard — Phase 0.
 *
 * Hard rule from the plan: outside `src/main/pipelines/` (and the
 * legacy ipc-handlers.ts shim during the migration), no code may
 * branch on the agent mode. We can't delete every existing branch
 * yet — they get migrated phase by phase — so this script counts
 * violations per file and compares against a baseline.
 *
 * - If a file has FEWER violations than baseline → ok (we're shrinking).
 * - If a file has MORE violations than baseline → fail.
 * - To rebaseline (only after deletions): `node scripts/check-mode-isolation.mjs --update`.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(ROOT, 'scripts', 'mode-isolation-baseline.json')

// Files / directories whose mode branches are *allowed* (they are the router
// and shim code that owns the legacy switch logic during the migration).
const ALLOWED_DIRS = [
  'src/main/pipelines/', // the router and pipelines branch on mode by design
]

const PATTERNS = [
  // `if (... mode === ...)` style branches on AgentMode
  /\b(if|else if)\s*\([^)]*\bmode\s*===/g,
  // `currentAgentMode === ...`
  /\bcurrentAgentMode\s*===\s*/g,
  // The legacy compound that ORs sessionIntent and agentMode
  /\bisWorkspaceRuntimeMode\s*\(/g,
]

const EXTENSIONS = new Set(['.ts', '.tsx'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full, out)
    } else if (EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

function isAllowed(relPath) {
  return ALLOWED_DIRS.some((p) => relPath.replace(/\\/g, '/').startsWith(p))
}

function countViolations(file) {
  const text = readFileSync(file, 'utf8')
  let count = 0
  for (const pat of PATTERNS) {
    const matches = text.match(pat)
    if (matches) count += matches.length
  }
  return count
}

function buildCounts() {
  const counts = {}
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (isAllowed(rel)) continue
    const n = countViolations(file)
    if (n > 0) counts[rel] = n
  }
  return counts
}

const args = new Set(process.argv.slice(2))
const counts = buildCounts()

if (args.has('--update')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n', 'utf8')
  console.log(`Baseline updated: ${Object.keys(counts).length} files, ${Object.values(counts).reduce((a, b) => a + b, 0)} violations.`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error('No baseline file found. Run `node scripts/check-mode-isolation.mjs --update` once to seed it.')
  process.exit(2)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const failures = []

for (const [file, count] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0
  if (count > allowed) {
    failures.push(`  ${file}: ${count} (baseline ${allowed}, +${count - allowed})`)
  }
}

if (failures.length > 0) {
  console.error('Mode-isolation lint guard: NEW mode-branch violations introduced.')
  console.error('Move the branch into src/main/pipelines/ (the router) or extend the active pipeline.')
  console.error('')
  for (const line of failures) console.error(line)
  process.exit(1)
}

console.log(`Mode-isolation lint guard: ok (${Object.values(counts).reduce((a, b) => a + b, 0)} pre-existing violations across ${Object.keys(counts).length} files).`)
