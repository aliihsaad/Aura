// Verifies the profile-md parser/renderer + the profile-merger delta logic
// against fixtures. Style mirrors check-session-brain-merger.mjs but with
// real assertions on behavior, not just exports.
//
// We compile the two pure modules (src/shared/profile-md.ts +
// src/main/services/agent/profile-merger.ts) on the fly into a temp dir
// using the local typescript and load the .js output. No Electron.

import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const sources = [
  ['src/shared/profile-md.ts', 'profile-md.js'],
  ['src/main/services/agent/profile-merger.ts', 'profile-merger.js'],
]

// ── Compile the two modules ──────────────────────────────────────
const require = createRequire(import.meta.url)
const ts = require(path.join(repoRoot, 'node_modules', 'typescript'))

const outDir = path.join(tmpdir(), `whisphry-profile-merger-check-${process.pid}-${Date.now()}`)
mkdirSync(outDir, { recursive: true })

for (const [srcRel, outName] of sources) {
  const srcPath = path.join(repoRoot, srcRel)
  const src = readFileSync(srcPath, 'utf8')
  // Rewrite the merger's @shared/profile-md import to a relative path that
  // resolves inside the temp dir.
  const rewritten = src.replace(/from\s+'@shared\/profile-md'/g, "from './profile-md.js'")
  const result = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: false,
    },
  })
  writeFileSync(path.join(outDir, outName), result.outputText, 'utf8')
}

// Tell Node to treat the temp .js files as ESM.
writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')

const profileMd = await import(pathToFileURL(path.join(outDir, 'profile-md.js')).href)
const merger = await import(pathToFileURL(path.join(outDir, 'profile-merger.js')).href)

// ── Tests ────────────────────────────────────────────────────────
let passed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    process.exit(1)
  }
}

console.log('check-profile-merger:')

test('parseProfileMd splits sections and span kinds', () => {
  const md = `# About Ali
<!-- agent:start -->
- Web dev student at Ironhack
<!-- agent:end -->

<!-- user:start -->
hand-written note
<!-- user:end -->

# Communication
<!-- agent:start -->
- Prefers terse fix-first
<!-- agent:end -->
`
  const parsed = profileMd.parseProfileMd(md)
  assert.equal(parsed.sections.length, 2, 'expected 2 sections')
  assert.equal(parsed.sections[0].title, 'About Ali')
  assert.equal(parsed.sections[1].title, 'Communication')

  const aboutSpans = parsed.sections[0].spans
  assert.ok(aboutSpans.some((s) => s.kind === 'agent'), 'about should have agent span')
  assert.ok(aboutSpans.some((s) => s.kind === 'user'), 'about should have user span')
})

test('renderProfileMd round-trips parseProfileMd', () => {
  const original = `# About Ali
<!-- agent:start -->
- Web dev student at Ironhack
<!-- agent:end -->

<!-- user:start -->
hand-written note
<!-- user:end -->
`
  const parsed = profileMd.parseProfileMd(original)
  const rendered = profileMd.renderProfileMd(parsed)
  // Re-parse the rendered output; sections should match.
  const reparsed = profileMd.parseProfileMd(rendered)
  assert.equal(reparsed.sections.length, parsed.sections.length)
  assert.equal(reparsed.sections[0].title, parsed.sections[0].title)
})

test('applyProfileDelta replaces agent content but preserves user span', () => {
  const md = `# About Ali
<!-- agent:start -->
- Old fact
<!-- agent:end -->

<!-- user:start -->
DO NOT TOUCH ME
<!-- user:end -->
`
  const next = merger.applyProfileDelta(md, {
    section_updates: [{ section_title: 'About Ali', agent_content: '- New fact' }],
  })
  assert.match(next, /- New fact/, 'agent content should be updated')
  assert.doesNotMatch(next, /Old fact/, 'old agent content should be gone')
  assert.match(next, /DO NOT TOUCH ME/, 'user span must be preserved verbatim')
})

test('applyProfileDelta appends new sections at the end', () => {
  const md = `# About Ali
<!-- agent:start -->
- Existing
<!-- agent:end -->
`
  const next = merger.applyProfileDelta(md, {
    new_sections: [{ title: 'Active Threads', agent_content: '- Whisphry profile.md auto-merge' }],
  })
  assert.match(next, /# Active Threads/, 'new heading should be present')
  assert.match(next, /Whisphry profile.md auto-merge/, 'new agent body should be present')
  // Ordering: About Ali must come before Active Threads.
  assert.ok(next.indexOf('About Ali') < next.indexOf('Active Threads'))
})

test('applyProfileDelta is idempotent for repeated new_sections (no duplicates)', () => {
  const md = `# About Ali
<!-- agent:start -->
- Existing
<!-- agent:end -->
`
  const delta = {
    new_sections: [{ title: 'Active Threads', agent_content: '- thread A' }],
  }
  const once = merger.applyProfileDelta(md, delta)
  const twice = merger.applyProfileDelta(once, delta)
  // The second pass should *update* (not duplicate) the section.
  const occurrences = (twice.match(/# Active Threads/g) || []).length
  assert.equal(occurrences, 1, 'Active Threads heading should appear exactly once')
})

test('applyProfileDelta creates a new section when section_update target is missing', () => {
  const md = `# About Ali
<!-- agent:start -->
- Existing
<!-- agent:end -->
`
  const next = merger.applyProfileDelta(md, {
    section_updates: [{ section_title: 'Brand new', agent_content: '- created' }],
  })
  assert.match(next, /# Brand new/)
  assert.match(next, /- created/)
})

test('section_update title matching is case-insensitive', () => {
  const md = `# About Ali
<!-- agent:start -->
- Old
<!-- agent:end -->
`
  const next = merger.applyProfileDelta(md, {
    section_updates: [{ section_title: 'about ali', agent_content: '- New' }],
  })
  assert.doesNotMatch(next, /- Old/)
  assert.match(next, /- New/)
})

test('empty agent_content clears the agent span without dropping the section', () => {
  const md = `# About Ali
<!-- agent:start -->
- stale info
<!-- agent:end -->
`
  const next = merger.applyProfileDelta(md, {
    section_updates: [{ section_title: 'About Ali', agent_content: '' }],
  })
  assert.match(next, /# About Ali/, 'heading must remain')
  assert.doesNotMatch(next, /stale info/, 'stale agent content must be cleared')
})

test('buildInitialProfileMd creates a clean file with one agent span per section', () => {
  const md = merger.buildInitialProfileMd([
    { title: 'About Ali', agent_content: '- new user' },
    { title: 'Communication', agent_content: '- terse' },
  ])
  const parsed = profileMd.parseProfileMd(md)
  assert.equal(parsed.sections.length, 2)
  for (const section of parsed.sections) {
    const agentSpans = section.spans.filter((s) => s.kind === 'agent')
    assert.equal(agentSpans.length, 1, `section ${section.title} should have exactly one agent span`)
  }
})

// ── Cleanup ──────────────────────────────────────────────────────
rmSync(outDir, { recursive: true, force: true })

console.log(`check-profile-merger: ${passed} tests passed`)
