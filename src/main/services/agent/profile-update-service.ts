import type { ProfileContext, SessionContext, TranscriptEntry } from '@shared/types'
import { getSessionBehavior } from '@shared/session-intent-policy'
import type { LLMService } from '../llm-service'
import { readProfileMdRaw, writeProfileMd } from '../profile-store'
import { applyProfileDelta, type ProfileMergeDelta } from './profile-merger'
import * as fs from 'fs'
import * as path from 'path'

/**
 * End-of-session profile updater.
 *
 * Runs once when a session is saved. Asks a cheap LLM to produce a delta
 * against the user's existing profile.md based on:
 *   - the structured ProfileContext fields the user typed in
 *   - the session's intent/subject/notes
 *   - a transcript window
 *   - the session-brain final-summary (if present)
 *
 * The delta is applied via the pure profile-merger (which preserves all
 * user-locked spans verbatim) and written atomically.
 *
 * Errors are logged but never thrown — a failed merge must never block the
 * session-stop flow.
 */

export interface ProfileUpdateInputs {
  profile: ProfileContext
  sessionContext: SessionContext
  transcript: TranscriptEntry[]
  appDataPath: string
  sessionFolderName?: string
}

export interface ProfileUpdateDeps {
  llmService: LLMService
  model: string
  onUsage?: (usage: { promptTokens: number; completionTokens: number; model: string }) => void
}

const SYSTEM_PROMPT = `You maintain a long-term \`profile.md\` for a single user. The file is split into sections like "About <Name>", "How <Name> Communicates", "Active Threads", "Skills & Stack", "Goals". Each section has agent-managed content that you control.

Your job: given the current profile.md and what happened in this session, output a JSON delta updating the agent-managed sections. Be conservative — only persist facts that will likely matter weeks from now. Skip ephemeral session chatter unless it reflects a durable trait, ongoing project, or shift in goals.

Rules:
- Bullet style, terse, factual. No filler.
- If a new fact contradicts an existing entry, replace the entire agent block for that section with the corrected version.
- If a section already has good info and nothing in this session updates it, omit it from the delta.
- Never reference content inside \`<!-- user -->\` blocks; that content is locked.
- For first-run profile.md (current is empty), seed these sections: "About <Name>", "How <Name> Communicates", "Active Threads", "Skills & Stack", "Goals" — but only those for which you have actual content to put. Don't create empty sections.
- Keep section titles stable across runs so future updates can find them.

Output JSON only, matching this shape — nothing else:
{
  "section_updates": [{ "section_title": "string", "agent_content": "string" }],
  "new_sections": [{ "title": "string", "level": 1, "agent_content": "string" }]
}`

export async function updateProfileForSession(
  inputs: ProfileUpdateInputs,
  deps: ProfileUpdateDeps
): Promise<{ written: boolean; reason?: string }> {
  const currentMd = readProfileMdRaw()
  const userPrompt = buildUserPrompt(inputs, currentMd)

  console.log(
    `[profile-update] starting (model=${deps.model}, currentMd=${currentMd.length} chars, prompt=${userPrompt.length} chars)`
  )

  let raw: string
  try {
    raw = await deps.llmService.cheapTextCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: deps.model,
      jsonSchemaName: 'profile_delta',
      onUsage: deps.onUsage,
    })
  } catch (err) {
    console.warn('[profile-update] LLM call failed:', err)
    return { written: false, reason: 'llm-error' }
  }

  console.log(`[profile-update] LLM returned ${raw.length} chars`)

  const delta = safeParseDelta(raw)
  if (!delta) {
    // Surface the raw output so we can diagnose model-specific quirks
    // (markdown fences, prefatory prose, schema drift, etc.).
    const preview = raw.slice(0, 600).replace(/\s+/g, ' ')
    console.warn(`[profile-update] could not parse delta. raw preview: ${preview}`)
    return { written: false, reason: 'parse-error' }
  }

  const hasUpdates = (delta.section_updates ?? []).length > 0 || (delta.new_sections ?? []).length > 0
  if (!hasUpdates) {
    console.log('[profile-update] empty delta — nothing to write')
    return { written: false, reason: 'empty-delta' }
  }

  const nextMd = applyProfileDelta(currentMd, delta)
  if (nextMd.trim() === currentMd.trim()) {
    console.log('[profile-update] delta produced no net change — skipping write')
    return { written: false, reason: 'no-change' }
  }

  try {
    writeProfileMd(nextMd)
    console.log(
      `[profile-update] wrote profile.md — ${nextMd.length} chars (updates=${(delta.section_updates ?? []).length}, new=${(delta.new_sections ?? []).length})`
    )
    return { written: true }
  } catch (err) {
    console.warn('[profile-update] write failed:', err)
    return { written: false, reason: 'write-error' }
  }
}

function buildUserPrompt(inputs: ProfileUpdateInputs, currentMd: string): string {
  const parts: string[] = []

  parts.push('## Current profile.md')
  parts.push(currentMd.trim() || '(empty — this is the first time we are building it)')

  parts.push('## Structured profile fields the user typed in')
  parts.push(formatStructuredProfile(inputs.profile))

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

function formatStructuredProfile(p: ProfileContext): string {
  const lines: string[] = []
  if (p.name) lines.push(`Name: ${p.name}`)
  if (p.languages) lines.push(`Languages: ${p.languages}`)
  if (p.occupation) lines.push(`Occupation: ${p.occupation}`)
  if (p.currentFocus) lines.push(`Current focus: ${p.currentFocus}`)
  if (p.commsStyle) lines.push(`Comms style: ${p.commsStyle}`)
  if (p.extraInstructions) lines.push(`Standing instructions: ${p.extraInstructions}`)
  if (p.relationships) lines.push(`Relationships: ${p.relationships}`)

  return lines.length > 0 ? lines.join('\n') : '(none provided)'
}

function formatSessionContext(s: SessionContext): string {
  const lines: string[] = []
  const behavior = getSessionBehavior(s.sessionIntent || 'quick-help')
  if (s.sessionIntent) lines.push(`Intent: ${s.sessionIntent}`)
  if (s.companyName) lines.push(`Company: ${s.companyName}`)
  if (s.roleName) lines.push(`Role: ${s.roleName}`)
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
  // Tolerate code-fenced JSON (```json ... ```) — some models still ignore the
  // schema instruction.
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
