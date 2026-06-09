import { SubjectState, SummaryDelta } from '@shared/session-brain-types'
import { SummaryDoc } from './session-brain-merger'

export interface BuildSummaryPromptArgs {
  subject: SubjectState
  recentTranscriptWindow: string // last ~3-5 minutes finalized text, with [HH:MM:SS] line prefixes
  existingSummary: SummaryDoc
}

export function buildSummaryDeltaPrompt(args: BuildSummaryPromptArgs): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a session-brain summarizer for a live class/meeting/interview transcript.

Goal: maintain a continuously-updated structured summary by emitting deltas, never full rewrites.

Output a JSON object with this exact shape:
{
  "subject": {
    "current": string,
    "confidence": number (0..1),
    "drift_detected": boolean,
    "drift_reason": string | null
  },
  "add": {
    "key_points":   [{ "ts_label": "HH:MM:SS", "text": "...", "transcript_lines": "L?-L?" }],
    "errors":       [...],
    "action_items": [...],
    "decisions":    [...],
    "code_shown":   [...]
  },
  "merge": [
    { "section": "key_points", "match_text_substring": "...", "replace_with": { "ts_label": "...", "text": "..." } }
  ]
}

Hard rules:
- If nothing new in the transcript window, return all empty arrays. Do not invent.
- Add at most 3 bullets total across all sections for this tick.
- Do not create a separate note for each sentence. One bullet should capture a concept, misconception, exercise, or task.
- Prefer "merge" over "add" when the new transcript expands an existing idea.
- For key_points, errors, and code_shown, write study-note quality explanations: 2-4 concise sentences, enough for review later.
- For code_shown, preserve exact function names, method names, variable names, and short code facts when they are visible or heard, including examples like obtainInstruction and Promise.all.
- action_items and decisions may be shorter, but must still be specific and useful.
- Do not save filler, greetings, confirmations, or transcript fragments.
- Cite transcript line ranges where possible. Omit if uncertain.
- Drift: only flag drift_detected=true if the subject has clearly shifted to a new topic for at least 30 seconds of transcript.
- Stay neutral. Describe what was taught or discussed; do not opine.
- Keep each bullet text under 650 characters.
`
  const existingSummaryText = JSON.stringify(args.existingSummary.sections, null, 2)
  const userPrompt = `Current subject: ${args.subject.current_subject} (confidence ${args.subject.confidence})

Existing summary state (JSON):
${existingSummaryText}

Recent transcript window:
${args.recentTranscriptWindow}

Emit the JSON delta now.`
  return { systemPrompt, userPrompt }
}

export interface BuildScreenshotPromptArgs {
  subject: string
  recentTranscriptSnippet: string
}

export function buildScreenshotPrompt(args: BuildScreenshotPromptArgs): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You rate screenshots for relevance to a live session subject.

Output JSON exactly:
{
  "relevance_score": number (0..1),
  "caption": string (≤ 15 words, neutral, describes what is on screen),
  "subject_match": boolean
}

Score guide:
- 0.9-1.0: directly shows the subject (matching code, slides, demo, terminal output).
- 0.5-0.8: tangentially related (IDE/docs/terminal but not focused on subject).
- 0.0-0.4: irrelevant (chat overlay, lock screen, unrelated browser tabs).
`
  const userPrompt = `Current subject: ${args.subject}

Recent transcript:
${args.recentTranscriptSnippet}

Rate this screenshot now.`
  return { systemPrompt, userPrompt }
}

export function safeParseSummaryDelta(raw: string): SummaryDelta | null {
  try {
    const obj = JSON.parse(raw)
    if (typeof obj !== 'object' || obj === null) return null
    if (!obj.add || typeof obj.add !== 'object') return null
    return obj as SummaryDelta
  } catch {
    return null
  }
}

export function safeParseScreenshotRating(raw: string): { relevance_score: number; caption: string; subject_match: boolean } | null {
  try {
    const obj = JSON.parse(raw)
    if (typeof obj?.relevance_score !== 'number') return null
    if (typeof obj?.caption !== 'string') return null
    return obj
  } catch {
    return null
  }
}
