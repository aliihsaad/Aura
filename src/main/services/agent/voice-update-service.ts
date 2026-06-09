import type { ProfileContext, SessionContext, TranscriptEntry } from '@shared/types'
import { getSessionBehavior } from '@shared/session-intent-policy'
import type { LLMService } from '../llm-service'
import { readVoiceMdRaw, writeVoiceMd } from '../profile-store'
import { applyProfileDelta, type ProfileMergeDelta } from './profile-merger'
import * as fs from 'fs'
import * as path from 'path'

/**
 * End-of-session voice.md updater.
 *
 * voice.md captures *how* the user wants to be spoken to — stylistic
 * preferences only, never identity or facts (those live in profile.md).
 * Examples of what belongs in voice.md:
 *   - "Direct, fix-first. State the answer; explain only on follow-up."
 *   - "Speaks English and German fluently — match whichever they're using."
 *   - "Strong dislike for repetition; rephrase rather than restate."
 *   - "No habitual check-ins ('want me to?', 'need help?')."
 *
 * The format / merger is identical to profile.md, so we reuse
 * applyProfileDelta. Only the file path and the system prompt differ.
 *
 * Runs in parallel with profile-update-service at session end and is
 * fire-and-forget — failures are logged and swallowed so they never
 * block session save.
 */

export interface VoiceUpdateInputs {
  profile: ProfileContext
  sessionContext: SessionContext
  transcript: TranscriptEntry[]
  appDataPath: string
  sessionFolderName?: string
}

export interface VoiceUpdateDeps {
  llmService: LLMService
  model: string
  onUsage?: (usage: { promptTokens: number; completionTokens: number; model: string }) => void
}

const SYSTEM_PROMPT = `You maintain \`voice.md\` for a single user — a long-term record of *how* they want the assistant to speak to them. This is stylistic only: tone, pace, language, register, things to avoid. Never put identity, projects, skills, or facts here — those go in a separate profile.md.

Your job: given the current voice.md and what happened in this session, output a JSON delta updating the agent-managed sections. Be conservative — only persist stylistic preferences that are durable, not one-off moods.

Recommended section titles (create them as needed):
- "Tone & Pace" — terseness, formality, energy level
- "Language" — what languages they speak, code-switching habits
- "Register" — formal/casual, dry/playful, technical depth preference
- "Things to Avoid" — phrases / mannerisms / patterns the user has corrected
- "Pushback Style" — how they like disagreement (direct, hedged, with evidence, etc.)

Strong signals to capture:
- Direct corrections: "stop saying X", "don't repeat", "be more terse"
- Affirmations: "yes that's good", "perfect tone", positive feedback after a particular phrasing
- Language switches: which language they're speaking, whether they switch mid-sentence
- Stated preferences: "I want fix-first", "skip the explanation", "give me bullet points"

Avoid putting in voice.md:
- Identity facts (name, occupation, projects) — those go in profile.md
- Session-specific topics
- Anything that wouldn't matter weeks from now

Rules:
- Bullet style, terse, prescriptive (write as instructions to the assistant).
- If a new observation contradicts an existing entry, replace the entire agent block for that section.
- If a section already has good info and nothing in this session updates it, omit it from the delta.
- Never reference content inside \`<!-- user -->\` blocks; that content is locked.

Output JSON only, matching this shape — nothing else:
{
  "section_updates": [{ "section_title": "string", "agent_content": "string" }],
  "new_sections": [{ "title": "string", "level": 1, "agent_content": "string" }]
}`

export async function updateVoiceForSession(
  inputs: VoiceUpdateInputs,
  deps: VoiceUpdateDeps
): Promise<{ written: boolean; reason?: string }> {
  const currentMd = readVoiceMdRaw()
  const userPrompt = buildUserPrompt(inputs, currentMd)

  console.log(
    `[voice-update] starting (model=${deps.model}, currentMd=${currentMd.length} chars, prompt=${userPrompt.length} chars)`
  )

  let raw: string
  try {
    raw = await deps.llmService.cheapTextCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: deps.model,
      jsonSchemaName: 'voice_delta',
      onUsage: deps.onUsage,
    })
  } catch (err) {
    console.warn('[voice-update] LLM call failed:', err)
    return { written: false, reason: 'llm-error' }
  }

  console.log(`[voice-update] LLM returned ${raw.length} chars`)

  const delta = safeParseDelta(raw)
  if (!delta) {
    const preview = raw.slice(0, 600).replace(/\s+/g, ' ')
    console.warn(`[voice-update] could not parse delta. raw preview: ${preview}`)
    return { written: false, reason: 'parse-error' }
  }

  const hasUpdates = (delta.section_updates ?? []).length > 0 || (delta.new_sections ?? []).length > 0
  if (!hasUpdates) {
    console.log('[voice-update] empty delta — nothing to write')
    return { written: false, reason: 'empty-delta' }
  }

  const nextMd = applyProfileDelta(currentMd, delta)
  if (nextMd.trim() === currentMd.trim()) {
    console.log('[voice-update] delta produced no net change — skipping write')
    return { written: false, reason: 'no-change' }
  }

  try {
    writeVoiceMd(nextMd)
    console.log(
      `[voice-update] wrote voice.md — ${nextMd.length} chars (updates=${(delta.section_updates ?? []).length}, new=${(delta.new_sections ?? []).length})`
    )
    return { written: true }
  } catch (err) {
    console.warn('[voice-update] write failed:', err)
    return { written: false, reason: 'write-error' }
  }
}

function buildUserPrompt(inputs: VoiceUpdateInputs, currentMd: string): string {
  const parts: string[] = []

  parts.push('## Current voice.md')
  parts.push(currentMd.trim() || '(empty — this is the first time we are building it)')

  parts.push('## Stylistic seeds the user typed in')
  parts.push(formatStructuredHints(inputs.profile))

  parts.push('## Session context')
  parts.push(formatSessionContext(inputs.sessionContext))

  parts.push('## Transcript window (most recent finalized lines)')
  parts.push(formatTranscript(inputs.transcript))

  const brainSummary = readBrainFinalSummary(inputs.appDataPath, inputs.sessionFolderName)
  if (brainSummary) {
    parts.push('## Session brain final-summary')
    parts.push(brainSummary)
  }

  parts.push('Output JSON delta only — no prose, no markdown fences.')
  return parts.join('\n\n')
}

function formatStructuredHints(p: ProfileContext): string {
  const lines: string[] = []
  if (p.languages) lines.push(`Languages: ${p.languages}`)
  if (p.commsStyle) lines.push(`Self-described comms style: ${p.commsStyle}`)
  if (p.extraInstructions) lines.push(`Standing instructions: ${p.extraInstructions}`)
  return lines.length > 0 ? lines.join('\n') : '(none provided)'
}

function formatSessionContext(s: SessionContext): string {
  const lines: string[] = []
  const behavior = getSessionBehavior(s.sessionIntent || 'interview')
  if (s.sessionIntent) lines.push(`Intent: ${s.sessionIntent}`)
  if (s.subject) lines.push(`Subject: ${s.subject}`)
  if (s.sessionNotes) lines.push(`Notes from user: ${s.sessionNotes}`)
  lines.push(`Brain policy: ${behavior.brainPolicy}`)
  return lines.length > 0 ? lines.join('\n') : '(no metadata)'
}

function formatTranscript(transcript: TranscriptEntry[]): string {
  const finalized = transcript.filter((e) => e.isFinal).slice(-80)
  if (finalized.length === 0) return '(transcript is empty)'
  return finalized
    .map((e) => {
      const speaker = e.speaker === 'user' ? 'User' : 'Other'
      return `${speaker}: ${e.text}`
    })
    .join('\n')
}

function readBrainFinalSummary(appDataPath: string, sessionFolderName: string | undefined): string {
  if (!sessionFolderName) return ''
  const file = path.join(appDataPath, 'sessions', sessionFolderName, 'brain', 'final-summary.md')
  try {
    if (!fs.existsSync(file)) return ''
    const raw = fs.readFileSync(file, 'utf-8').trim()
    return raw.length > 0 ? truncate(raw, 5000) : ''
  } catch {
    return ''
  }
}

function safeParseDelta(raw: string): ProfileMergeDelta | undefined {
  if (!raw) return undefined
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(stripped)
    if (!parsed || typeof parsed !== 'object') return undefined
    const delta: ProfileMergeDelta = {}
    if (Array.isArray(parsed.section_updates)) {
      delta.section_updates = parsed.section_updates
        .filter((u: unknown) => isStringField(u, 'section_title') && isStringField(u, 'agent_content'))
        .map((u: { section_title: string; agent_content: string }) => ({
          section_title: u.section_title,
          agent_content: u.agent_content,
        }))
    }
    if (Array.isArray(parsed.new_sections)) {
      delta.new_sections = parsed.new_sections
        .filter((s: unknown) => isStringField(s, 'title') && isStringField(s, 'agent_content'))
        .map((s: { title: string; agent_content: string; level?: number }) => ({
          title: s.title,
          level: clampLevel(s.level),
          agent_content: s.agent_content,
        }))
    }
    return delta
  } catch {
    return undefined
  }
}

function isStringField(obj: unknown, key: string): boolean {
  return Boolean(obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>)[key] === 'string')
}

function clampLevel(n: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  const v = typeof n === 'number' ? Math.round(n) : 1
  if (v < 1) return 1
  if (v > 6) return 6
  return v as 1 | 2 | 3 | 4 | 5 | 6
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}
