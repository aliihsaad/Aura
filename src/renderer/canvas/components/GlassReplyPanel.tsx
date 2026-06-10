import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight, X, GripVertical, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { BubbleUrgency } from '@shared/types'
import RichContent from '../../overlay/components/RichContent'

/**
 * Floating glass reply panel — Aura's replies materialize around the orb
 * (Phase 3; evolution of the classic Bubble, same widget contract).
 */

interface GlassReplyPanelProps {
  id: string
  message: string
  urgency: BubbleUrgency
  expandable: boolean
  fontSize?: number
  width?: number
  streaming?: boolean
  onExpand?: (id: string) => void
  onDismiss?: (id: string) => void
  onFeedback?: (id: string, sentiment: 'up' | 'down', text: string) => void
}

const URGENCY_STYLES: Record<
  BubbleUrgency,
  { panel: string; dot: string; glow: string }
> = {
  low: {
    panel: 'glass-panel',
    dot: 'bg-[#6ea8ff]',
    glow: 'shadow-[0_0_10px_rgba(110,168,255,0.6)]',
  },
  medium: {
    panel: 'glass-panel',
    dot: 'bg-[#4d7cfe]',
    glow: 'shadow-[0_0_12px_rgba(77,124,254,0.8)]',
  },
  high: {
    panel: 'glass-panel-violet glass-panel',
    dot: 'bg-[#a78bfa]',
    glow: 'shadow-[0_0_12px_rgba(167,139,250,0.85)]',
  },
}

export default function GlassReplyPanel({
  id,
  message,
  urgency,
  expandable,
  fontSize = 13,
  width = 320,
  streaming = false,
  onExpand,
  onDismiss,
  onFeedback,
}: GlassReplyPanelProps) {
  const style = URGENCY_STYLES[urgency]
  const paddingY = Math.max(10, Math.round(fontSize * 0.9))
  const paddingX = Math.max(12, Math.round(fontSize * 1.0))
  // Feedback state is *per-turn*. The heartbeat reuses the same widget id
  // across answers (it updates message in place), so React keeps this
  // component mounted between turns. Without an explicit reset, voting
  // on turn 1 would lock the buttons forever. Reset whenever streaming
  // flips ON (= new turn started).
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [pulse, setPulse] = useState<'up' | 'down' | null>(null)
  const prevStreamingRef = useRef(streaming)

  useEffect(() => {
    if (streaming && !prevStreamingRef.current) {
      setFeedback(null)
    }
    prevStreamingRef.current = streaming
  }, [streaming])

  const giveFeedback = (sentiment: 'up' | 'down', e: React.MouseEvent): void => {
    e.stopPropagation()
    if (feedback === sentiment) return
    setFeedback(sentiment)
    setPulse(sentiment)
    setTimeout(() => setPulse(null), 350)
    onFeedback?.(id, sentiment, message)
  }

  return (
    <div
      data-drag-handle
      style={{
        width: `${width}px`,
        padding: `${paddingY}px ${paddingX}px`,
      }}
      className={`bubble-enter glass-drift group relative flex items-start gap-2.5 rounded-2xl ${style.panel} cursor-grab active:cursor-grabbing select-none transition-all`}
    >
      {/* Left: aurora indicator dot */}
      <div className="flex flex-col items-center pt-1 shrink-0">
        <span
          className={`block w-2 h-2 rounded-full ${style.dot} ${style.glow}`}
        />
      </div>

      {/* Middle: message */}
      <div
        className="flex-1 pt-0.5 pr-1 break-words text-white/90"
      >
        <RichContent compact content={message} fontSize={fontSize} />
        {streaming && (
          <span
            aria-hidden
            className="inline-block align-[-0.15em] ml-0.5 w-[2px] bg-[#6ea8ff]/90 animate-pulse"
            style={{ height: `${Math.round(fontSize * 1.05)}px` }}
          />
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0 -mr-0.5 -mt-0.5">
        {!streaming && onFeedback && (
          <div
            className="bubble-feedback-cluster flex items-center gap-1 rounded-lg bg-white/[0.03] border border-white/[0.07] px-1 py-0.5"
            data-feedback-state={feedback || 'none'}
          >
            <button
              onClick={(e) => giveFeedback('up', e)}
              onMouseDown={(e) => e.stopPropagation()}
              className={`bubble-feedback-btn inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                feedback === 'up'
                  ? 'bg-teal-400/20 text-teal-200 border border-teal-300/30 shadow-[0_0_8px_rgba(45,212,191,0.3)]'
                  : 'text-white/55 hover:bg-teal-400/10 hover:text-teal-300 border border-transparent'
              } ${pulse === 'up' ? 'bubble-feedback-pulse' : ''}`}
              title="Helpful — agent reinforces this style"
              aria-pressed={feedback === 'up'}
              disabled={feedback !== null && feedback !== 'up'}
            >
              <ThumbsUp size={14} strokeWidth={2.2} />
              {feedback === 'up' && <span>saved</span>}
            </button>
            <button
              onClick={(e) => giveFeedback('down', e)}
              onMouseDown={(e) => e.stopPropagation()}
              className={`bubble-feedback-btn inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                feedback === 'down'
                  ? 'bg-rose-500/20 text-rose-200 border border-rose-400/30 shadow-[0_0_8px_rgba(244,114,182,0.25)]'
                  : 'text-white/55 hover:bg-rose-500/10 hover:text-rose-300 border border-transparent'
              } ${pulse === 'down' ? 'bubble-feedback-pulse' : ''}`}
              title="Not helpful — voice.md will learn to avoid this"
              aria-pressed={feedback === 'down'}
              disabled={feedback !== null && feedback !== 'down'}
            >
              <ThumbsDown size={14} strokeWidth={2.2} />
              {feedback === 'down' && <span>noted</span>}
            </button>
          </div>
        )}
        {expandable && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onExpand?.(id)
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white/85 transition-colors"
            title="Expand into panel"
          >
            <ChevronRight size={14} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDismiss?.(id)
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white/85 transition-colors"
          title="Dismiss"
        >
          <X size={13} />
        </button>
      </div>

      {/* Drag affordance on hover */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-1 opacity-0 group-hover:opacity-40 pointer-events-none transition-opacity">
        <GripVertical size={12} className="text-white/70" />
      </div>
    </div>
  )
}
