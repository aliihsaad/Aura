/**
 * Pure parse/render for profile.md. No I/O, no Electron — safe to import from
 * any process (main, renderer, Node verification scripts).
 *
 * Format: a flat markdown file divided into headed sections. Each section
 * body is split into agent-managed and user-locked spans:
 *
 *   <!-- agent:start -->
 *   ...content the merger may rewrite freely...
 *   <!-- agent:end -->
 *
 *   <!-- user:start -->
 *   ...content the merger MUST preserve verbatim...
 *   <!-- user:end -->
 *
 * Anything outside both marker pairs is treated as user-authored prose and
 * preserved verbatim too.
 */

export interface ProfileMdSection {
  /** Raw section heading line (e.g. `# About Ali`). Empty for the preamble. */
  heading: string
  /** Heading level (1 for `#`, 2 for `##`, …). 0 for the preamble. */
  level: number
  /** Section title without the leading `#`s. Empty for the preamble. */
  title: string
  /** Body of the section as a list of spans, in original order. */
  spans: ProfileMdSpan[]
}

export type ProfileMdSpan =
  | { kind: 'agent'; content: string }
  | { kind: 'user'; content: string }
  | { kind: 'prose'; content: string }

export interface ParsedProfileMd {
  sections: ProfileMdSection[]
}

const AGENT_OPEN = /<!--\s*agent:start\s*-->/i
const AGENT_CLOSE = /<!--\s*agent:end\s*-->/i
const USER_OPEN = /<!--\s*user:start\s*-->/i
const USER_CLOSE = /<!--\s*user:end\s*-->/i

export function parseProfileMd(raw: string): ParsedProfileMd {
  const lines = raw.split(/\r?\n/)
  const sections: ProfileMdSection[] = []

  let current: ProfileMdSection = { heading: '', level: 0, title: '', spans: [] }
  let buffer: string[] = []
  let spanKind: 'prose' | 'agent' | 'user' = 'prose'

  const flushBuffer = (): void => {
    if (buffer.length === 0) return
    const content = buffer.join('\n')
    if (content.length === 0 && spanKind === 'prose') {
      buffer = []
      return
    }
    current.spans.push({ kind: spanKind, content })
    buffer = []
  }

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch && spanKind === 'prose') {
      flushBuffer()
      sections.push(current)
      current = {
        heading: line,
        level: headingMatch[1].length,
        title: headingMatch[2].trim(),
        spans: [],
      }
      continue
    }

    if (AGENT_OPEN.test(line)) {
      flushBuffer()
      spanKind = 'agent'
      continue
    }
    if (AGENT_CLOSE.test(line) && spanKind === 'agent') {
      flushBuffer()
      spanKind = 'prose'
      continue
    }
    if (USER_OPEN.test(line)) {
      flushBuffer()
      spanKind = 'user'
      continue
    }
    if (USER_CLOSE.test(line) && spanKind === 'user') {
      flushBuffer()
      spanKind = 'prose'
      continue
    }

    buffer.push(line)
  }

  flushBuffer()
  sections.push(current)

  if (
    sections.length > 0 &&
    sections[0].level === 0 &&
    sections[0].spans.every((s) => s.content.trim() === '')
  ) {
    sections.shift()
  }

  return { sections }
}

export function renderProfileMd(parsed: ParsedProfileMd): string {
  const out: string[] = []
  for (const section of parsed.sections) {
    if (section.heading) out.push(section.heading)
    for (const span of section.spans) {
      if (span.kind === 'agent') {
        out.push('<!-- agent:start -->')
        if (span.content.length > 0) out.push(span.content)
        out.push('<!-- agent:end -->')
      } else if (span.kind === 'user') {
        out.push('<!-- user:start -->')
        if (span.content.length > 0) out.push(span.content)
        out.push('<!-- user:end -->')
      } else if (span.content.length > 0) {
        out.push(span.content)
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function findSection(parsed: ParsedProfileMd, title: string): ProfileMdSection | undefined {
  const t = title.trim().toLowerCase()
  return parsed.sections.find((s) => s.title.toLowerCase() === t)
}

export function getAgentContent(section: ProfileMdSection | undefined): string {
  if (!section) return ''
  return section.spans
    .filter((s) => s.kind === 'agent')
    .map((s) => s.content)
    .join('\n\n')
    .trim()
}
