import React, { useState } from 'react'
import { BookOpen, Check, Clipboard, ExternalLink, HelpCircle, Link, MessageSquarePlus, Play, StickyNote, Trash2 } from 'lucide-react'
import type { MeetingNote, SessionIntent } from '@shared/types'
import type { BrainSummarySection, StudyNotesSnapshot, SummaryBullet } from '@shared/session-brain-types'
import { getTranscriptSpeakerLabel } from '@shared/session-intent-policy'

interface MeetingNotesProps {
  notes: MeetingNote[]
  studyNotes?: StudyNotesSnapshot | null
  sessionIntent: SessionIntent
  onClear: () => void
  onAnswerFollowUp: (question: string) => void
  onCopyFollowUp: (question: string) => void
}

export default function MeetingNotes({
  notes,
  studyNotes,
  sessionIntent,
  onClear,
  onAnswerFollowUp,
  onCopyFollowUp,
}: MeetingNotesProps) {
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)

  const handleCopy = (note: MeetingNote) => {
    onCopyFollowUp(note.followUp)
    setCopiedNoteId(note.id)
    window.setTimeout(() => setCopiedNoteId((prev) => (prev === note.id ? null : prev)), 1400)
  }

  const handleCopyAll = () => {
    onCopyFollowUp(sessionIntent === 'class' ? formatStudyNotesMarkdown(studyNotes) : formatNotesMarkdown(notes))
    setCopiedAll(true)
    window.setTimeout(() => setCopiedAll(false), 1400)
  }

  if (sessionIntent === 'class') {
    return (
      <StudyNotesView
        snapshot={studyNotes}
        copiedAll={copiedAll}
        onCopyAll={handleCopyAll}
      />
    )
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border border-white/[0.05] bg-black/30">
      <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">Notes</div>
          <div className="mt-0.5 text-[11px] text-white/28">{notes.length} captured</div>
        </div>
        {notes.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopyAll}
              title="Copy notes"
              className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/65"
            >
              {copiedAll ? <Check size={13} /> : <Clipboard size={13} />}
            </button>
            <button
              type="button"
              onClick={onClear}
              title="Clear notes"
              className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/65"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <StickyNote size={18} className="text-white/24" />
          <div className="text-[13px] text-white/32">No notes captured yet.</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {notes.map((note) => {
            const expanded = activeNoteId === note.id
            return (
              <div
                key={note.id}
                className="rounded-xl border border-white/[0.055] bg-white/[0.025] px-3 py-3 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/32">
                    <StickyNote size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-white/28">
                      <span>{getTranscriptSpeakerLabel({ speaker: normalizeNoteSpeaker(note.speaker) }, sessionIntent)}</span>
                      <span>{formatTime(note.timestamp)}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/78">
                      {note.text}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveNoteId(expanded ? null : note.id)}
                    title="Suggest follow-up"
                    className="shrink-0 rounded-lg p-1.5 text-cyan-300/70 transition-colors hover:bg-cyan-400/10 hover:text-cyan-200"
                  >
                    <MessageSquarePlus size={13} />
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 rounded-lg border border-cyan-400/10 bg-cyan-400/[0.035] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cyan-200/55">
                      <HelpCircle size={12} />
                      Follow-up
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/78">
                      {note.followUp}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onAnswerFollowUp(note.followUp)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400/12 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/18"
                      >
                        <Play size={12} />
                        Answer
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(note)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white/75"
                      >
                        {copiedNoteId === note.id ? <Check size={12} /> : <Clipboard size={12} />}
                        {copiedNoteId === note.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StudyNotesView({
  snapshot,
  copiedAll,
  onCopyAll,
}: {
  snapshot?: StudyNotesSnapshot | null
  copiedAll: boolean
  onCopyAll: () => void
}): React.JSX.Element {
  const total = countStudyBullets(snapshot)
  return (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border border-white/[0.05] bg-black/30">
      <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">Study Notes</div>
          <div className="mt-0.5 text-[11px] text-white/28">
            {snapshot ? `${total} brain notes` : 'Waiting for session brain'}
          </div>
        </div>
        {snapshot && total > 0 && (
          <button
            type="button"
            onClick={onCopyAll}
            title="Copy study notes"
            className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/65"
          >
            {copiedAll ? <Check size={13} /> : <Clipboard size={13} />}
          </button>
        )}
      </div>

      {!snapshot || total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <BookOpen size={18} className="text-white/24" />
          <div className="text-[13px] text-white/32">Study notes will appear after the brain summarizes enough class context.</div>
          <div className="max-w-sm text-[11px] leading-relaxed text-white/24">
            This avoids random transcript fragments. The first useful summary usually appears after several finalized instructor lines.
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <div className="rounded-xl border border-cyan-400/10 bg-cyan-400/[0.035] px-3 py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-cyan-200/55">Current topic</div>
            <div className="mt-1 text-[13px] font-medium text-white/80">{snapshot.subject}</div>
          </div>

          {STUDY_SECTIONS.map(({ section, label }) => (
            <StudySection
              key={section}
              label={label}
              bullets={snapshot.sections[section] ?? []}
            />
          ))}

          {snapshot.resources.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/35">
                <Link size={12} />
                Resources
              </div>
              {snapshot.resources.map((resource) => (
                <button
                  key={resource.url}
                  type="button"
                  onClick={() => { void window.api.openExternal(resource.url) }}
                  className="block w-full rounded-xl border border-white/[0.055] bg-white/[0.025] px-3 py-3 text-left transition-colors hover:border-cyan-400/16 hover:bg-cyan-400/[0.035]"
                >
                  <div className="flex items-center gap-2 text-[13px] font-medium text-cyan-200/80">
                    <span className="min-w-0 flex-1 truncate">{resource.title}</span>
                    <ExternalLink size={12} className="shrink-0 opacity-60" />
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-white/40">{resource.reason}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STUDY_SECTIONS: Array<{ section: BrainSummarySection; label: string }> = [
  { section: 'key_points', label: 'Key Concepts' },
  { section: 'code_shown', label: 'Code / Exercises' },
  { section: 'errors', label: 'Errors / Pitfalls' },
  { section: 'action_items', label: 'Study Tasks' },
  { section: 'decisions', label: 'Recommendations' },
]

function StudySection({ label, bullets }: { label: string; bullets: SummaryBullet[] }): React.JSX.Element | null {
  if (bullets.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/35">{label}</div>
      {bullets.map((bullet, index) => (
        <div key={`${bullet.ts_label}:${index}:${bullet.text}`} className="rounded-xl border border-white/[0.055] bg-white/[0.025] px-3 py-3">
          <div className="mb-1 text-[10.5px] uppercase tracking-[0.14em] text-white/28">{bullet.ts_label}</div>
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/78">{bullet.text}</div>
        </div>
      ))}
    </div>
  )
}

function countStudyBullets(snapshot?: StudyNotesSnapshot | null): number {
  if (!snapshot) return 0
  return Object.values(snapshot.sections).reduce((sum, bullets) => sum + bullets.length, 0)
}

function normalizeNoteSpeaker(speaker: string): 'interviewer' | 'user' | 'unknown' {
  if (speaker === 'user' || speaker === 'interviewer' || speaker === 'unknown') return speaker
  return 'unknown'
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatNotesMarkdown(notes: MeetingNote[]): string {
  const lines = ['# Meeting Notes', '']

  for (const note of notes) {
    lines.push(`- ${note.text}`)
    lines.push(`  - Follow-up: ${note.followUp}`)
  }

  return lines.join('\n')
}

function formatStudyNotesMarkdown(snapshot?: StudyNotesSnapshot | null): string {
  if (!snapshot) return '# Study Notes\n\nNo study notes captured yet.'
  const lines = [`# Study Notes: ${snapshot.subject}`, '']
  for (const { section, label } of STUDY_SECTIONS) {
    const bullets = snapshot.sections[section] ?? []
    if (bullets.length === 0) continue
    lines.push(`## ${label}`)
    for (const bullet of bullets) {
      lines.push(`- [${bullet.ts_label}] ${bullet.text}`)
    }
    lines.push('')
  }
  if (snapshot.resources.length > 0) {
    lines.push('## Resources')
    for (const resource of snapshot.resources) {
      lines.push(`- [${resource.title}](${resource.url}) - ${resource.reason}`)
    }
  }
  return lines.join('\n').trimEnd()
}
