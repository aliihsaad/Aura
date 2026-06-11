import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
  Sparkles,
  HelpCircle,
  GripVertical,
  Minus,
  Plus,
  ShieldAlert,
  Square,
  Volume2,
} from 'lucide-react'
import type { AnswerAttachment } from '@shared/types'
import RichContent from './RichContent'

const FONT_MIN = 14
const FONT_MAX = 28
const FONT_STEP = 2
const FONT_DEFAULT = 18

// Map model IDs to short display names
function getModelDisplayName(modelId: string): string {
  if (!modelId) return ''
  const map: Record<string, string> = {
    'google/gemma-4-26b-a4b-it:free': 'Gemma 4 26B',
    'google/gemma-4-31b-it:free': 'Gemma 4 31B',
    'google/gemini-3-flash-preview': 'Gemini 3 Flash',
    'google/gemini-3.1-flash-lite-preview': 'Gemini 3.1 Lite',
    'deepseek/deepseek-chat-v3-0324': 'DeepSeek V3',
    'anthropic/claude-3.5-haiku': 'Claude Haiku',
    'anthropic/claude-sonnet-4': 'Claude Sonnet',
    'openai/gpt-4.1-mini': 'GPT-4.1 Mini',
    'meta-llama/llama-4-scout': 'Llama 4 Scout',
  }
  return map[modelId] || modelId.split('/').pop()?.replace(/-/g, ' ') || modelId
}

interface AISuggestionProps {
  answer: string
  attachments?: AnswerAttachment[]
  isStreaming: boolean
  question: string
  modelId?: string
  routingReason?: string
  /** Endpoint that actually served the answer (LLM-Hub vs OpenRouter). */
  servedBy?: { provider: string; model: string }
  canGoBack?: boolean
  canGoForward?: boolean
  historyLabel?: string
  onGoBack?: () => void
  onGoForward?: () => void
  detailCapabilities: string[]
  onClear: () => void
  onClose: () => void
}

export default function AISuggestion({
  answer,
  attachments,
  isStreaming,
  question,
  modelId = '',
  routingReason = '',
  servedBy,
  canGoBack = false,
  canGoForward = false,
  historyLabel,
  onGoBack,
  onGoForward,
  detailCapabilities,
  onClear,
  onClose,
}: AISuggestionProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [fontSize, setFontSize] = useState(FONT_DEFAULT)
  const [autoScrollPaused, setAutoScrollPaused] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [ttsNotice, setTtsNotice] = useState('')

  // Load persisted font size
  useEffect(() => {
    void window.api.getConfig().then((config: any) => {
      if (config?.answerFontSize) setFontSize(config.answerFontSize)
    })
  }, [])

  const adjustFont = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, prev + delta))
      void window.api.setConfig({ answerFontSize: next })
      return next
    })
  }, [])

  const resizeStateRef = useRef<{
    startX: number
    startY: number
    width: number
    height: number
  } | null>(null)

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [])

  const handleAnswerScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    const shouldFollow = distanceFromBottom < 40
    autoScrollRef.current = shouldFollow
    setAutoScrollPaused(isStreaming && !shouldFollow)
  }, [isStreaming])

  const resumeAutoScroll = useCallback(() => {
    autoScrollRef.current = true
    setAutoScrollPaused(false)
    scrollToBottom()
  }, [scrollToBottom])

  useEffect(() => {
    autoScrollRef.current = true
    setAutoScrollPaused(false)
    window.requestAnimationFrame(scrollToBottom)
  }, [question, scrollToBottom])

  // Type-reveal animation (18ms per step)
  useEffect(() => {
    if (!answer) {
      setTypedAnswer('')
      return
    }

    if (answer.length < typedAnswer.length) {
      setTypedAnswer(answer)
      return
    }

    if (typedAnswer === answer) return

    const timeout = window.setTimeout(() => {
      const step = Math.max(2, Math.ceil((answer.length - typedAnswer.length) / 8))
      setTypedAnswer(answer.slice(0, typedAnswer.length + step))
    }, 18)

    return () => window.clearTimeout(timeout)
  }, [answer, typedAnswer])

  // Follow the stream only while the user is still near the bottom. If they
  // scroll up to read, stop forcing the viewport until they opt back in.
  useEffect(() => {
    if (autoScrollRef.current) {
      window.requestAnimationFrame(scrollToBottom)
    }
  }, [typedAnswer, scrollToBottom])

  useEffect(() => {
    const cleanupStart = window.api.onAnswerTtsStart?.(() => setSpeaking(true))
    const cleanupEnd = window.api.onVoiceAudioEnd?.(() => setSpeaking(false))
    const cleanupUnavailable = window.api.onAnswerTtsUnavailable?.(() => {
      setSpeaking(false)
      setTtsNotice('Add a Deepgram key in Settings to use read-aloud')
    })
    return () => {
      cleanupStart?.()
      cleanupEnd?.()
      cleanupUnavailable?.()
    }
  }, [])

  useEffect(() => {
    if (!ttsNotice) return
    const timeout = window.setTimeout(() => setTtsNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [ttsNotice])

  const handleResizeStart = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const bounds = await window.api.getAnswerWindowBounds()
      if (!bounds) return

      resizeStateRef.current = {
        startX: event.screenX,
        startY: event.screenY,
        width: bounds.width,
        height: bounds.height,
      }

      const handlePointerMove = (moveEvent: MouseEvent) => {
        const current = resizeStateRef.current
        if (!current) return

        const nextWidth = Math.max(720, current.width + (moveEvent.screenX - current.startX))
        const nextHeight = Math.max(420, current.height + (moveEvent.screenY - current.startY))

        void window.api.setAnswerWindowBounds({
          width: nextWidth,
          height: nextHeight,
        })
      }

      const handlePointerUp = () => {
        resizeStateRef.current = null
        window.removeEventListener('mousemove', handlePointerMove)
        window.removeEventListener('mouseup', handlePointerUp)
      }

      window.addEventListener('mousemove', handlePointerMove)
      window.addEventListener('mouseup', handlePointerUp)
    },
    []
  )

  const visibleAnswer = typedAnswer || answer
  const hasCapability = (capability: string): boolean => detailCapabilities.includes(capability)

  return (
    <div className="h-full w-full bg-transparent p-4 pt-3">
      {/* Main window */}
      <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[rgba(10,12,16,0.92)] shadow-[0_16px_64px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        {/* Header - draggable */}
        <div className="drag-handle flex items-center justify-between border-b border-white/[0.04] bg-white/[0.02] px-5 py-5">
          {/* Left: nav arrows + history label */}
          <div className="no-drag flex items-center gap-2">
            <button
              onClick={onGoBack}
              disabled={!canGoBack || isStreaming}
              className="rounded-lg p-2 bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-25"
              title="Previous answer"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={onGoForward}
              disabled={!canGoForward || isStreaming}
              className="rounded-lg p-2 bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-25"
              title="Next answer"
            >
              <ChevronRight size={16} />
            </button>
            {historyLabel && (
              <span className="ml-2 text-[11px] font-medium text-white/30">
                {historyLabel}
              </span>
            )}
          </div>

          {/* Center: label + model badge */}
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
              Detail
            </span>
            {(servedBy || modelId) && (
              <span
                className="rounded-md border border-white/[0.06] bg-white/[0.05] px-2 py-0.5 text-[9.5px] font-medium tracking-wide text-white/35"
                title={servedBy ? `${servedBy.model} via ${servedBy.provider}` : modelId}
              >
                {getModelDisplayName(servedBy?.model || modelId)}
              </span>
            )}
            {servedBy && (
              <span
                className={`rounded-md px-2 py-0.5 text-[9.5px] font-medium tracking-wide ${
                  servedBy.provider === 'LLM-Hub'
                    ? 'border border-emerald-400/[0.12] bg-emerald-400/[0.06] text-emerald-300/60'
                    : 'border border-white/[0.06] bg-white/[0.05] text-white/35'
                }`}
                title={`Served by ${servedBy.provider}`}
              >
                {servedBy.provider === 'LLM-Hub' ? 'LLM-Hub · free' : servedBy.provider}
              </span>
            )}
            {routingReason && (
              <span className="rounded-md border border-blue-400/[0.08] bg-blue-400/[0.05] px-2 py-0.5 text-[9.5px] font-medium tracking-wide text-blue-300/55">
                {routingReason}
              </span>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="no-drag flex items-center gap-2">
            {hasCapability('read-aloud') && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (speaking) {
                      setSpeaking(false)
                      void window.api.stopSpeakingAnswer()
                      return
                    }
                    if (!visibleAnswer.trim()) return
                    setSpeaking(true)
                    void window.api.speakAnswer(visibleAnswer).then((ok) => {
                      if (!ok) setSpeaking(false)
                    })
                  }}
                  disabled={!visibleAnswer.trim()}
                  aria-pressed={speaking}
                  className={`rounded-lg p-2 transition-colors disabled:opacity-25 ${
                    speaking
                      ? 'bg-blue-500/[0.16] text-blue-200 hover:bg-blue-500/[0.22]'
                      : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/80'
                  }`}
                  title={speaking ? 'Stop' : 'Read aloud'}
                >
                  {speaking ? <Square size={15} /> : <Volume2 size={15} />}
                </button>
                {ttsNotice && (
                  <div className="absolute right-0 top-10 z-20 w-64 rounded-lg border border-white/10 bg-black/85 px-3 py-2 text-[12px] leading-snug text-white/80 shadow-lg backdrop-blur-xl">
                    {ttsNotice}
                  </div>
                )}
              </div>
            )}
            {/* Font size controls */}
            <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.04] px-1">
              <button
                onClick={() => adjustFont(-FONT_STEP)}
                disabled={fontSize <= FONT_MIN}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80 disabled:opacity-25"
                title="Decrease font size"
              >
                <Minus size={13} />
              </button>
              <span className="min-w-[28px] text-center text-[10px] font-medium text-white/40">
                {fontSize}
              </span>
              <button
                onClick={() => adjustFont(FONT_STEP)}
                disabled={fontSize >= FONT_MAX}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80 disabled:opacity-25"
                title="Increase font size"
              >
                <Plus size={13} />
              </button>
            </div>
            <button
              onClick={onClear}
              className="rounded-lg p-2 bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80"
              title="Clear"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Question section */}
        <div className="mx-5 mt-4 rounded-xl border border-amber-400/[0.06] bg-amber-500/[0.04] px-5 py-4">
          <div className="mb-2 flex items-center gap-1.5">
            <HelpCircle size={12} className="text-amber-400/50" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/50">
              Question
            </span>
          </div>
          <div className="font-semibold leading-relaxed text-white/85" style={{ fontSize: `${fontSize}px` }}>
            {question || (
              <span className="text-white/25">Waiting for your next question...</span>
            )}
          </div>
        </div>

        {/* Answer section */}
        <div className="mx-5 mt-3 mb-5 flex min-h-0 flex-1 flex-col rounded-xl border border-white/[0.04] bg-white/[0.02] px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={12} className="text-blue-400/50" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-400/50">
              Detail
            </span>
            {isStreaming && (
              <span className="text-[11px] text-blue-400/60">Generating...</span>
            )}
            {autoScrollPaused && (
              <button
                onClick={resumeAutoScroll}
                className="ml-auto rounded-md border border-blue-400/10 bg-blue-400/[0.06] px-2 py-1 text-[10px] font-medium text-blue-300/70 transition-colors hover:bg-blue-400/[0.1] hover:text-blue-200"
              >
                Follow live
              </button>
            )}
          </div>

          <div
            ref={scrollRef}
            onScroll={handleAnswerScroll}
            className="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <div>
              <RichContent
                content={visibleAnswer}
                fontSize={fontSize}
                attachments={attachments}
                detailCapabilities={detailCapabilities}
              />
              {isStreaming && (
                <span className="inline-block h-4 w-0.5 animate-pulse rounded-sm bg-blue-400 align-middle ml-1" />
              )}
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <button
          onMouseDown={handleResizeStart}
          className="no-drag absolute bottom-3 right-3 rounded-lg p-2 bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/60"
          title="Resize"
        >
          <GripVertical size={14} />
        </button>
      </div>
    </div>
  )
}
