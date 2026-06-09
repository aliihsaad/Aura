import React from 'react'
import { Check, Clock, MessageSquare, Play, X } from 'lucide-react'
import type { SessionIntent } from '@shared/types'
import { getTranscriptSpeakerLabel } from '@shared/session-intent-policy'

export interface AnswerCandidate {
  id: string
  text: string
  speaker: string
  timestamp: number
  status: 'new' | 'answering' | 'answered' | 'dismissed'
}

interface AnswerQueueProps {
  candidates: AnswerCandidate[]
  sessionIntent: SessionIntent
  onAnswer: (candidate: AnswerCandidate) => void
  onDismiss: (id: string) => void
  onClearDismissed: () => void
}

export default function AnswerQueue({
  candidates,
  sessionIntent,
  onAnswer,
  onDismiss,
  onClearDismissed,
}: AnswerQueueProps) {
  const visible = candidates.filter((item) => item.status !== 'dismissed')
  const dismissedCount = candidates.length - visible.length

  return (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-xl border border-white/[0.05] bg-black/30">
      <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">Queue</div>
          <div className="mt-0.5 text-[11px] text-white/28">{visible.length} captured</div>
        </div>
        {dismissedCount > 0 && (
          <button
            type="button"
            onClick={onClearDismissed}
            className="rounded-lg px-2 py-1 text-[11px] text-white/35 transition-colors hover:bg-white/[0.05] hover:text-white/65"
          >
            Clear dismissed
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-white/32">
          No captured prompts yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {visible.map((candidate) => (
            <div
              key={candidate.id}
              className={`rounded-xl border px-3 py-3 transition-colors ${
                candidate.status === 'answering'
                  ? 'border-cyan-400/25 bg-cyan-400/[0.045]'
                  : candidate.status === 'answered'
                    ? 'border-emerald-400/15 bg-emerald-400/[0.025]'
                    : 'border-white/[0.055] bg-white/[0.025]'
              }`}
            >
              <div className="flex items-start gap-3">
                <StatusIcon status={candidate.status} />
                <button
                  type="button"
                  onClick={() => onAnswer(candidate)}
                  disabled={candidate.status === 'answering'}
                  className="min-w-0 flex-1 text-left disabled:pointer-events-none"
                >
                  <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-white/28">
                    <span>{getTranscriptSpeakerLabel({ speaker: normalizeCandidateSpeaker(candidate.speaker) }, sessionIntent)}</span>
                    <span>{formatTime(candidate.timestamp)}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/78">
                    {candidate.text}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onAnswer(candidate)}
                    disabled={candidate.status === 'answering'}
                    title="Answer"
                    className="rounded-lg p-1.5 text-cyan-300/70 transition-colors hover:bg-cyan-400/10 hover:text-cyan-200 disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(candidate.id)}
                    title="Dismiss"
                    className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/65"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function normalizeCandidateSpeaker(speaker: string): 'interviewer' | 'user' | 'unknown' {
  if (speaker === 'user' || speaker === 'interviewer' || speaker === 'unknown') return speaker
  return 'unknown'
}

function StatusIcon({ status }: { status: AnswerCandidate['status'] }) {
  if (status === 'answered') {
    return (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300/80">
        <Check size={13} />
      </span>
    )
  }
  if (status === 'answering') {
    return (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300/80">
        <Clock size={13} />
      </span>
    )
  }
  return (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/32">
      <MessageSquare size={13} />
    </span>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
