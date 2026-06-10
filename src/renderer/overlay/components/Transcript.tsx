import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { SessionIntent, TranscriptAudioSource } from '@shared/types'
import { getTranscriptSpeakerLabel } from '@shared/session-intent-policy'

interface TranscriptEntry {
  id: string
  text: string
  speaker: 'system' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  source?: 'stt' | 'chat'
  audioSource?: TranscriptAudioSource
}

interface TranscriptProps {
  entries: TranscriptEntry[]
  detectedQuestion?: string
  sessionIntent: SessionIntent
  systemInterimText: string
  userInterimText: string
  onAnswerThis: () => void
  onClear: () => void
  onHide: () => void
}

export default function Transcript({
  entries,
  detectedQuestion,
  sessionIntent,
  systemInterimText,
  userInterimText,
  onAnswerThis,
  onClear,
  onHide,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const rows = useMemo(() => {
    const finalRows = entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      speaker: entry.speaker,
      source: entry.source,
      audioSource: entry.audioSource,
      isInterim: false,
      isQuestion: detectedQuestion === entry.text,
      isChat: entry.source === 'chat',
    }))

    if (systemInterimText.trim()) {
      finalRows.push({
        id: 'system-interim',
        text: systemInterimText,
        speaker: 'system' as const,
        source: 'stt' as const,
        audioSource: 'system' as const,
        isInterim: true,
        isQuestion: false,
        isChat: false,
      })
    }

    if (userInterimText.trim()) {
      finalRows.push({
        id: 'user-interim',
        text: userInterimText,
        speaker: 'user' as const,
        source: 'stt' as const,
        audioSource: 'microphone' as const,
        isInterim: true,
        isQuestion: false,
        isChat: false,
      })
    }

    return finalRows.slice(-12)
  }, [detectedQuestion, entries, systemInterimText, userInterimText])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [rows, autoScroll])

  // Get the latest text to show in compact mode
  const latestText = rows.length > 0 ? rows[rows.length - 1] : null

  // Compact (strip) mode — show latest 1-2 lines
  if (!expanded) {
    const hasContent = latestText || systemInterimText || userInterimText
    return (
      <div className="flex items-center gap-0 rounded-2xl border border-white/[0.06] bg-[rgba(12,14,18,0.82)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
        {/* Transcript text area */}
        <div className="no-drag min-w-0 flex-1 px-4 py-3">
          {!hasContent ? (
            <span className="block truncate text-[13px] text-white/20">Listening...</span>
          ) : (
            latestText && (
              <div className="flex min-w-0 items-center gap-2">
                <div className="shrink-0">
                  <SpeakerTag entry={latestText} sessionIntent={sessionIntent} isQuestion={latestText.isQuestion} />
                </div>
                <span
                  className={`block min-w-0 flex-1 truncate whitespace-nowrap text-[14px] leading-none ${
                    latestText.isInterim ? 'text-white/45' : 'text-white/85'
                  }`}
                  title={latestText.text}
                >
                  {latestText.text}
                </span>
                {latestText.isInterim && (
                  <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cyan-400" />
                )}
              </div>
            )
          )}
        </div>

        {/* Compact action buttons */}
        <div className="no-drag flex shrink-0 items-center gap-0.5 px-2 py-2">
          {detectedQuestion && (
            <button
              onClick={onAnswerThis}
              className="rounded-lg p-1.5 text-cyan-400/60 transition-all duration-150 hover:bg-white/[0.06] hover:text-cyan-400"
              title="Answer this question"
            >
              <Sparkles size={14} />
            </button>
          )}
          <button
            onClick={() => setExpanded(true)}
            className="rounded-lg p-1.5 text-white/30 transition-all duration-150 hover:bg-white/[0.06] hover:text-white/60"
            title="Expand transcript"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={onHide}
            className="rounded-lg p-1.5 text-white/30 transition-all duration-150 hover:bg-white/[0.06] hover:text-white/60"
            title="Hide transcript"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  // Expanded mode — full scrollable transcript panel
  return (
    <div className="flex max-h-full flex-col rounded-2xl border border-white/[0.06] bg-[rgba(12,14,18,0.82)] px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
      {/* Header */}
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="no-drag flex items-center gap-2 rounded-lg px-1 py-0.5 transition-all duration-150 hover:bg-white/[0.04]"
            title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
          >
            <div
              className={`h-[18px] w-[32px] rounded-full p-[2px] transition-colors duration-200 ${
                autoScroll ? 'bg-cyan-500' : 'bg-white/10'
              }`}
            >
              <div
                className={`h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  autoScroll ? 'translate-x-[14px]' : 'translate-x-0'
                }`}
              />
            </div>
            <span className="text-[12px] text-white/50">Auto-scroll</span>
          </button>
          {detectedQuestion && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]" />
              <span className="text-[11px] text-cyan-400/80">Question detected</span>
            </div>
          )}
        </div>

        <div className="no-drag flex items-center gap-1">
          {detectedQuestion && (
            <button
              onClick={onAnswerThis}
              className="rounded-lg bg-white/[0.04] p-1.5 text-white/50 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/80"
              title="Answer this question"
            >
              <Sparkles size={14} />
            </button>
          )}
          <button
            onClick={onClear}
            className="rounded-lg bg-white/[0.04] p-1.5 text-white/50 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/80"
            title="Clear transcript"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="rounded-lg bg-white/[0.04] p-1.5 text-white/50 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/80"
            title="Collapse transcript"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={onHide}
            className="rounded-lg bg-white/[0.04] p-1.5 text-white/50 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/80"
            title="Hide transcript"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scroll area */}
      <div
        ref={scrollRef}
        className="min-h-0 max-h-[280px] flex-1 overflow-y-auto rounded-xl bg-black/20 p-3"
      >
        {rows.length === 0 ? (
          <div className="flex h-[80px] items-center justify-center text-[13px] text-white/20">
            Listening...
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className={`rounded-xl p-3 ${getEntryBg(row)}`}
              >
                <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${getLabelColor(row)}`}>
                  <SpeakerTag entry={row} sessionIntent={sessionIntent} isQuestion={row.isQuestion} />
                  {row.isChat && (
                    <span className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[9px] text-cyan-300/80">Chat</span>
                  )}
                  {row.isInterim && (
                    <span className="ml-1 flex items-center gap-1">
                      <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-current" />
                      <span className="text-[9px] opacity-60">live</span>
                    </span>
                  )}
                </div>
                <div
                  className={`text-[14px] leading-relaxed ${
                    row.isInterim ? 'text-white/45' : 'text-white/85'
                  }`}
                >
                  {row.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SpeakerTag({
  entry,
  sessionIntent,
  isQuestion,
}: {
  entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>
  sessionIntent: SessionIntent
  isQuestion: boolean
}) {
  if (isQuestion) {
    return <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">Question</span>
  }
  const label = getTranscriptSpeakerLabel(entry, sessionIntent)
  const color = label === 'You'
    ? 'text-cyan-400/70'
    : label === 'Chat'
      ? 'text-cyan-300/80'
      : 'text-white/40'
  return <span className={`text-[10px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
}

function getEntryBg(row: { isQuestion: boolean; speaker: string }) {
  if (row.isQuestion) return 'bg-amber-500/[0.06] border border-amber-400/[0.08]'
  if (row.speaker === 'user') return 'bg-cyan-500/[0.06] border border-cyan-400/[0.08]'
  return 'bg-white/[0.03] border border-white/[0.04]'
}

function getLabelColor(row: { isQuestion: boolean; speaker: string }) {
  if (row.isQuestion) return 'text-amber-400/70'
  if (row.speaker === 'user') return 'text-cyan-400/70'
  return 'text-white/40'
}
