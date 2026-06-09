import { BrainSummarySection, SummaryBullet, SummaryDelta, SubjectState, SubjectHistoryEntry } from '@shared/session-brain-types'

export interface SummaryDoc {
  sections: Record<BrainSummarySection, SummaryBullet[]>
}

const ALL_SECTIONS: BrainSummarySection[] = ['key_points', 'errors', 'action_items', 'decisions', 'code_shown']
const SECTION_LIMITS: Record<BrainSummarySection, number> = {
  key_points: 8,
  code_shown: 6,
  errors: 5,
  action_items: 5,
  decisions: 4,
}

export function emptySummaryDoc(): SummaryDoc {
  return {
    sections: { key_points: [], errors: [], action_items: [], decisions: [], code_shown: [] },
  }
}

export function mergeSummaryDelta(doc: SummaryDoc, delta: SummaryDelta): SummaryDoc {
  const next: SummaryDoc = { sections: { ...doc.sections } }
  for (const section of ALL_SECTIONS) next.sections[section] = [...doc.sections[section]]

  for (const op of delta.merge ?? []) {
    if (!isValidBullet(op.replace_with)) continue
    const list = next.sections[op.section]
    const idx = list.findIndex((b) => b.text.toLowerCase().includes(op.match_text_substring.toLowerCase()))
    if (idx >= 0) list[idx] = op.replace_with
  }

  for (const section of ALL_SECTIONS) {
    const additions = delta.add[section] ?? []
    for (const bullet of additions) {
      if (!isValidBullet(bullet)) continue
      const dupe = next.sections[section].some(
        (b) => b.text.trim().toLowerCase() === bullet.text.trim().toLowerCase()
      )
      if (!dupe) next.sections[section].push(bullet)
    }
    next.sections[section] = trimSection(next.sections[section], SECTION_LIMITS[section])
  }

  return next
}

export function renderSummaryMarkdown(subject: SubjectState, doc: SummaryDoc): string {
  const lines: string[] = []
  lines.push(`# Session Brain`)
  lines.push('')
  lines.push(`**Current subject:** ${subject.current_subject}  _(confidence ${subject.confidence.toFixed(2)})_`)
  lines.push('')
  for (const section of ALL_SECTIONS) {
    const heading = sectionHeading(section)
    lines.push(`## ${heading}`)
    const bullets = doc.sections[section]
    if (bullets.length === 0) {
      lines.push('_(none yet)_')
    } else {
      for (const b of bullets) {
        const refs: string[] = []
        if (b.transcript_lines) refs.push(`transcript:${b.transcript_lines}`)
        if (b.screenshot_uid) refs.push(`screenshot:${b.screenshot_uid}`)
        const refStr = refs.length ? ` ⟶ ${refs.join(', ')}` : ''
        lines.push(`- [${b.ts_label}] ${b.text}${refStr}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

function isValidBullet(b: unknown): b is SummaryBullet {
  if (!b || typeof b !== 'object') return false
  const x = b as Partial<SummaryBullet>
  return typeof x.text === 'string' && x.text.trim().length > 0
    && typeof x.ts_label === 'string' && x.ts_label.trim().length > 0
}

function trimSection(bullets: SummaryBullet[], limit: number): SummaryBullet[] {
  if (bullets.length <= limit) return bullets
  return bullets.slice(-limit)
}

function sectionHeading(section: BrainSummarySection): string {
  switch (section) {
    case 'key_points': return 'Key Points'
    case 'errors': return 'Errors / Pitfalls Discussed'
    case 'action_items': return 'Action Items'
    case 'decisions': return 'Decisions / Recommendations'
    case 'code_shown': return 'Code Shown'
  }
}

export function applySubjectDrift(state: SubjectState, drift: { current: string; confidence: number; reason?: string }): SubjectState {
  if (drift.current.trim().toLowerCase() === state.current_subject.trim().toLowerCase()) {
    return { ...state, confidence: drift.confidence }
  }
  const entry: SubjectHistoryEntry = { ts: Date.now(), subject: drift.current, reason: 'subject_drift' }
  return {
    ...state,
    current_subject: drift.current,
    confidence: drift.confidence,
    since_ts: entry.ts,
    history: [...state.history, entry],
  }
}
