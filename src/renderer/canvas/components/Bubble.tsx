import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight, X, GripVertical, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { BubbleUrgency } from '@shared/types'
import RichContent from '../../overlay/components/RichContent'

interface BubbleProps {
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
  { border: string; dot: string; glow: string }
> = {
  low: {
    border: 'border-white/10',
    dot: 'bg-cyan-400/80',
    glow: 'shadow-[0_0_8px_rgba(34,211,238,0.45)]',
  },
  medium: {
    border: 'border-cyan-400/30',
    dot: 'bg-cyan-300',
    glow: 'shadow-[0_0_10px_rgba(34,211,238,0.7)]',
  },
  high: {
    border: 'border-amber-400/40',
    dot: 'bg-amber-300',
    glow: 'shadow-[0_0_10px_rgba(251,191,36,0.7)]',
  },
}

export default function Bubble({
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
}: BubbleProps) {
  const style = URGENCY_STYLES[urgency]
  const paddingY = Math.max(8, Math.round(fontSize * 0.8))
  const paddingX = Math.max(10, Math.round(fontSize * 0.9))
  // Feedback state is *per-turn*. The heartbeat reuses the same bubble id
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
      className={`bubble-enter group relative flex items-start gap-2.5 rounded-2xl rounded-bl-md backdrop-blur-md border ${style.border} bg-gradient-to-br from-zinc-900/95 to-black/95 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)] cursor-grab active:cursor-grabbing select-none ring-1 ring-inset ring-white/5 hover:ring-white/10 transition-all`}
    >
      {/* Left: branded indicator dot */}
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
            className="inline-block align-[-0.15em] ml-0.5 w-[2px] bg-cyan-300/90 animate-pulse"
            style={{ height: `${Math.round(fontSize * 1.05)}px` }}
          />
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0 -mr-0.5 -mt-0.5">
        {!streaming && onFeedback && (
          <div
            className="bubble-feedback-cluster flex items-center gap-1 rounded-lg bg-white/[0.025] border border-white/[0.06] px-1 py-0.5"
            data-feedback-state={feedback || 'none'}
          >
            <button
              onClick={(e) => giveFeedback('up', e)}
              onMouseDown={(e) => e.stopPropagation()}
              className={`bubble-feedback-btn inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                feedback === 'up'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 shadow-[0_0_8px_rgba(52,211,153,0.25)]'
                  : 'text-white/55 hover:bg-emerald-500/10 hover:text-emerald-300 border border-transparent'
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
