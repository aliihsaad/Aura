import {
  ParsedProfileMd,
  ProfileMdSection,
  ProfileMdSpan,
  parseProfileMd,
  renderProfileMd,
} from '@shared/profile-md'

/**
 * Delta the LLM emits at session end. Each section_update replaces the
 * *agent-managed* content in a named section, leaving user-locked spans and
 * surrounding prose untouched. New sections are appended at the bottom.
 *
 * Section matching is case-insensitive on the title only; the heading level
 * (`#` vs `##`) on existing sections is preserved.
 */
export interface ProfileMergeDelta {
  /** Update agent-managed content in existing sections. */
  section_updates?: ProfileSectionUpdate[]
  /** Append entirely new sections at the end of the file. */
  new_sections?: ProfileNewSection[]
}

export interface ProfileSectionUpdate {
  section_title: string
  agent_content: string
}

export interface ProfileNewSection {
  title: string
  /** Heading level. Defaults to 1 (`#`). */
  level?: 1 | 2 | 3 | 4 | 5 | 6
  agent_content: string
}

const DEFAULT_NEW_SECTION_LEVEL = 1

/**
 * Apply a delta to the current profile.md text. Pure function — no I/O.
 *
 * Rules:
 *   - User-locked spans (`<!-- user:start --> … <!-- user:end -->`) are
 *     preserved verbatim. The merger never reads or rewrites them.
 *   - Prose outside any marker is preserved verbatim.
 *   - Agent spans in updated sections are collapsed into a single span
 *     containing the new content. If the section had multiple agent spans
 *     interleaved with user spans, only the first agent span keeps the new
 *     content; later agent spans are emptied. (Profile sections are flat in
 *     practice; this only matters for hand-edited files.)
 *   - Sections referenced in `section_updates` that don't exist are appended
 *     as new sections at the end (so the merger is forgiving about LLM drift).
 *   - Empty `agent_content` is treated as "clear the agent block, keep the
 *     section heading intact" — a deliberate way for the merger to retract
 *     stale info without dropping the section.
 */
export function applyProfileDelta(currentMd: string, delta: ProfileMergeDelta): string {
  const parsed = parseProfileMd(currentMd)
  const sections = parsed.sections.map((s) => cloneSection(s))

  for (const update of delta.section_updates ?? []) {
    const idx = findSectionIndexByTitle(sections, update.section_title)
    if (idx >= 0) {
      replaceAgentSpans(sections[idx], update.agent_content)
    } else {
      sections.push(makeSection(update.section_title, DEFAULT_NEW_SECTION_LEVEL, update.agent_content))
    }
  }

  for (const created of delta.new_sections ?? []) {
    const level = created.level ?? DEFAULT_NEW_SECTION_LEVEL
    // If the LLM emits a new section that already exists, treat it as an
    // update — avoids duplicate headings on repeated end-of-session runs.
    const idx = findSectionIndexByTitle(sections, created.title)
    if (idx >= 0) {
      replaceAgentSpans(sections[idx], created.agent_content)
    } else {
      sections.push(makeSection(created.title, level, created.agent_content))
    }
  }

  const merged: ParsedProfileMd = { sections }
  return renderProfileMd(merged)
}

/**
 * Build a starter profile.md from scratch. Used the very first time we
 * persist a profile — single agent span per section, no user-locked content.
 */
export function buildInitialProfileMd(sections: ProfileNewSection[]): string {
  const parsed: ParsedProfileMd = {
    sections: sections.map((s) =>
      makeSection(s.title, s.level ?? DEFAULT_NEW_SECTION_LEVEL, s.agent_content)
    ),
  }
  return renderProfileMd(parsed)
}

// ─────────────────────────── internals ───────────────────────────

function findSectionIndexByTitle(sections: ProfileMdSection[], title: string): number {
  const normalized = title.trim().toLowerCase()
  return sections.findIndex((s) => s.title.toLowerCase() === normalized)
}

function replaceAgentSpans(section: ProfileMdSection, newAgentContent: string): void {
  const trimmed = newAgentContent.trim()
  let replaced = false
  const nextSpans: ProfileMdSpan[] = []
  for (const span of section.spans) {
    if (span.kind !== 'agent') {
      nextSpans.push(span)
      continue
    }
    if (!replaced) {
      nextSpans.push({ kind: 'agent', content: trimmed })
      replaced = true
    } else {
      nextSpans.push({ kind: 'agent', content: '' })
    }
  }
  if (!replaced) {
    // Section existed but had no agent span — prepend one so future merges
    // have something to update.
    nextSpans.unshift({ kind: 'agent', content: trimmed })
  }
  section.spans = nextSpans
}

function makeSection(title: string, level: number, agentContent: string): ProfileMdSection {
  const safeLevel = Math.max(1, Math.min(6, level))
  return {
    heading: `${'#'.repeat(safeLevel)} ${title.trim()}`,
    level: safeLevel,
    title: title.trim(),
    spans: [{ kind: 'agent', content: agentContent.trim() }],
  }
}

function cloneSection(s: ProfileMdSection): ProfileMdSection {
  return {
    heading: s.heading,
    level: s.level,
    title: s.title,
    spans: s.spans.map((span) => ({ ...span })),
  }
}
