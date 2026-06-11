import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, AlertTriangle } from 'lucide-react'
import type {
  AgentPresenceState,
  AnswerAttachment,
  AnswerDonePayload,
  CompanionRealtimeStatus,
  LiveAgentMode,
  SessionIntent,
  TranscriptAudioSource,
} from '@shared/types'
import Transcript from './components/Transcript'
import AISuggestion from './components/AISuggestion'
import FilePreview from './components/FilePreview'
import Controls from './components/Controls'
import AudioCapture from './components/AudioCapture'
import SessionSetup from './components/SessionSetup'
import { getSessionBehavior, isExternalAudioEntry } from '@shared/session-intent-policy'

interface TranscriptEntry {
  id: string
  text: string
  speaker: 'system' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  source?: 'stt' | 'chat'
  audioSource?: TranscriptAudioSource
}

interface AnswerHistoryEntry {
  question: string
  answer: string
  timestamp: number
  modelId?: string
  routingReason?: string
  attachments?: AnswerAttachment[]
  servedBy?: { provider: string; model: string }
}

export default function App() {
  const viewParam = new URLSearchParams(window.location.search).get('view')
  const isAnswerView = viewParam === 'answer'
  const isPreviewView = viewParam === 'preview'
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [isSessionPaused, setIsSessionPaused] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [interimTranscript, setInterimTranscript] = useState<{ system: string; user: string }>({
    system: '',
    user: '',
  })
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [currentServedBy, setCurrentServedBy] = useState<{ provider: string; model: string } | null>(null)
  const [currentAttachments, setCurrentAttachments] = useState<AnswerAttachment[]>([])
  const [answerHistory, setAnswerHistory] = useState<AnswerHistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isAnswering, setIsAnswering] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showAnswerPane, setShowAnswerPane] = useState(true)
  const [currentSessionIntent, setCurrentSessionIntent] = useState<SessionIntent | null>(null)
  const [showTranscript, setShowTranscript] = useState(true)
  const [micEnabled, setMicEnabled] = useState(true)
  const [liveAgentMode, setLiveAgentMode] = useState<LiveAgentMode>('off')
  const [liveAgentCaptionsEnabled, setLiveAgentCaptionsEnabled] = useState(true)
  const [companionRealtimeStatus, setCompanionRealtimeStatus] = useState<CompanionRealtimeStatus>('off')
  const [presenceState, setPresenceState] = useState<AgentPresenceState>('sleeping')
  const [sessionTime, setSessionTime] = useState(0)
  const [sttActive, setSttActive] = useState(false)
  const sttIdleTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Agent-speaking indicator. True while LLM is streaming OR TTS audio
  // chunks are arriving — drives a voice-wave animation in the Controls.
  const [agentActive, setAgentActive] = useState(false)
  const agentSpeechIdleTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Session token counter — broadcast from main on every LLM usage report.
  const [sessionTokens, setSessionTokens] = useState<{
    in: number
    out: number
    calls: number
  }>({ in: 0, out: 0, calls: 0 })
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const controlBarRef = useRef<HTMLDivElement | null>(null)
  const pendingAnswerQuestionRef = useRef('')
  const latestQuestionRef = useRef('')
  const currentModelSelectionRef = useRef<{ modelId: string; reason: string }>({ modelId: '', reason: '' })
  const [controlBarWidth, setControlBarWidth] = useState<number | null>(null)
  const [controlsHeight, setControlsHeight] = useState(320)
  const [overlayContentSize, setOverlayContentSize] = useState({ width: 0, height: 0 })
  const [showSessionSetup, setShowSessionSetup] = useState(false)
  const [confirmEndSession, setConfirmEndSession] = useState(false)
  const [currentModelSelection, setCurrentModelSelection] = useState<{ modelId: string; reason: string }>({
    modelId: '',
    reason: '',
  })
  const layoutRef = useRef<HTMLDivElement | null>(null)

  // Listen for transcript updates from main process
  useEffect(() => {
    const cleanup = window.api.onTranscriptUpdate((entry: TranscriptEntry) => {
      const speaker = getInterimTranscriptBucket(entry)

      if (entry.isFinal) {
        setTranscript((prev) => [...prev, entry])
        setInterimTranscript((prev) => ({
          ...prev,
          [speaker]: '',
        }))
      } else {
        setInterimTranscript((prev) => ({
          ...prev,
          [speaker]: entry.text,
        }))
      }
    })
    return cleanup
  }, [])

  // Listen for LLM answer chunks
  useEffect(() => {
    const cleanupChunk = window.api.onAnswerChunk((answer: string) => {
      if (answer === '') {
        pendingAnswerQuestionRef.current = pendingAnswerQuestionRef.current || latestQuestionRef.current || 'Current Prompt'
        setCurrentAttachments([])
        setCurrentServedBy(null)
      }
      setShowAnswerPane(true)
      setCurrentAnswer(answer)
      setIsAnswering(true)
    })
    const cleanupDone = window.api.onAnswerDone((payload: string | AnswerDonePayload) => {
      const answer = typeof payload === 'string' ? payload : payload.text
      const attachments = typeof payload === 'string' ? [] : payload.attachments ?? []
      const servedBy = typeof payload === 'string' ? undefined : payload.servedBy
      // Image-generation answers often arrive with empty text and only an
      // attachment — those are just as displayable as text.
      const hasDisplayableAnswer = answer.trim().length > 0 || attachments.length > 0
      setCurrentServedBy(servedBy ?? null)
      if (hasDisplayableAnswer) {
        setShowAnswerPane(true)
      }
      setCurrentAnswer((prev) => (answer.trim().length > 0 ? answer : prev))
      setCurrentAttachments(attachments)
      setIsAnswering(false)

      const question = pendingAnswerQuestionRef.current || latestQuestionRef.current || 'Current Prompt'
      if (hasDisplayableAnswer) {
        setAnswerHistory((prev) => {
          const nextEntry = {
            question,
            answer,
            timestamp: Date.now(),
            modelId: currentModelSelectionRef.current.modelId,
            routingReason: currentModelSelectionRef.current.reason,
            attachments,
            servedBy,
          }

          const lastEntry = prev[prev.length - 1]
          const sameAttachments =
            (lastEntry?.attachments?.length ?? 0) === attachments.length &&
            attachments.every((att, i) =>
              JSON.stringify(att) === JSON.stringify(lastEntry?.attachments?.[i])
            )
          const isDuplicate =
            prev.length > 0 &&
            lastEntry.question === nextEntry.question &&
            lastEntry.answer === nextEntry.answer &&
            lastEntry.modelId === nextEntry.modelId &&
            lastEntry.routingReason === nextEntry.routingReason &&
            sameAttachments

          if (isDuplicate) {
            setHistoryIndex(prev.length - 1)
            return prev
          }

          const nextHistory = [...prev, nextEntry]
          setHistoryIndex(nextHistory.length - 1)
          return nextHistory
        })
      }
      pendingAnswerQuestionRef.current = ''
    })
    return () => {
      cleanupChunk()
      cleanupDone()
    }
  }, [])

  useEffect(() => {
    const cleanup = window.api.onAnswerQuestion((question: string) => {
      pendingAnswerQuestionRef.current = question.trim() || 'Current Prompt'
    })
    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.api.onAnswerModelSelection((selection) => {
      setCurrentModelSelection(selection)
      currentModelSelectionRef.current = selection
    })
    return cleanup
  }, [])

  // Listen for session state
  useEffect(() => {
    void window.api.getConfig().then((config) => {
      setMicEnabled(config?.micEnabled ?? true)
      setCurrentModelSelection({
        modelId: config?.defaultModel || '',
        reason: 'Default model',
      })
      currentModelSelectionRef.current = {
        modelId: config?.defaultModel || '',
        reason: 'Default model',
      }
    })
  }, [])

  useEffect(() => {
    void window.api.getSessionState?.().then((state: any) => {
      if (!state) return
      applySessionState(state)
    })

    const cleanup = window.api.onSessionState((state: any) => {
      applySessionState(state)
    })
    return cleanup
  }, [])

  const applySessionState = useCallback((state: any) => {
    setIsSessionActive(state.isActive)
    setIsSessionPaused(Boolean(state.isPaused))
    if (typeof state.micEnabled === 'boolean') {
      setMicEnabled(state.micEnabled)
    }
    if (typeof state.answerWindowVisible === 'boolean') {
      setShowAnswerPane(state.answerWindowVisible)
    }
    if (typeof state.liveAgentMode === 'string') {
      setLiveAgentMode(state.liveAgentMode as LiveAgentMode)
    }
    if (typeof state.liveAgentCaptionsEnabled === 'boolean') {
      setLiveAgentCaptionsEnabled(state.liveAgentCaptionsEnabled)
    }
    if (typeof state.companionRealtimeStatus === 'string') {
      setCompanionRealtimeStatus(state.companionRealtimeStatus as CompanionRealtimeStatus)
    }
    if (isSessionIntent(state.sessionIntent)) {
      setCurrentSessionIntent(state.sessionIntent)
    }
    if (!state.isActive) {
      setIsSessionPaused(false)
      setSessionTime(0)
      setCurrentAnswer('')
      setCurrentAttachments([])
      setAnswerHistory([])
      setHistoryIndex(-1)
      setTranscript([])
      setInterimTranscript({ system: '', user: '' })
      pendingAnswerQuestionRef.current = ''
      latestQuestionRef.current = ''
      setCurrentSessionIntent(null)
      setCurrentModelSelection({ modelId: '', reason: '' })
      currentModelSelectionRef.current = { modelId: '', reason: '' }
      if (typeof state.companionRealtimeStatus !== 'string') {
        setCompanionRealtimeStatus('off')
      }
    }
  }, [])

  useEffect(() => {
    void window.api.getHeartbeatState().then((state) => {
      if (state?.presenceState) {
        setPresenceState(state.presenceState)
      }
    })
    const cleanup = window.api.onPresenceState((state) => {
      setPresenceState(state)
      // 'thinking' = LLM is generating. Keep the agent-speaking indicator
      // active for the duration of the stream; clear when the agent settles
      // back to idle/listening.
      if (state === 'thinking') {
        setAgentActive(true)
      } else if (state === 'idle' || state === 'listening' || state === 'sleeping') {
        // Don't clear if a TTS chunk arrived recently — the audio-chunk
        // listener owns the trailing window.
        if (!agentSpeechIdleTimerRef.current) {
          setAgentActive(false)
        }
      }
    })
    return cleanup
  }, [])

  // Session cost meter — initial fetch + live subscription.
  useEffect(() => {
    let cancelled = false
    void window.api.getCostMeter?.().then((snap) => {
      if (cancelled || !snap) return
      setSessionTokens({
        in: snap.promptTokens || 0,
        out: snap.completionTokens || 0,
        calls: snap.callCount || 0,
      })
    })
    const cleanup = window.api.onCostUpdate?.((snap) => {
      setSessionTokens({
        in: snap.promptTokens || 0,
        out: snap.completionTokens || 0,
        calls: snap.callCount || 0,
      })
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  // Agent voice-wave: TTS audio chunks → keep the wave alive. The 'voice:audio-end'
  // event closes the window deterministically; the idle timer is a fallback for
  // network gaps between chunks.
  useEffect(() => {
    const cleanupChunk = window.api.onVoiceAudioChunk?.(() => {
      setAgentActive(true)
      if (agentSpeechIdleTimerRef.current) clearTimeout(agentSpeechIdleTimerRef.current)
      agentSpeechIdleTimerRef.current = setTimeout(() => {
        setAgentActive(false)
        agentSpeechIdleTimerRef.current = null
      }, 600)
    })
    const cleanupEnd = window.api.onVoiceAudioEnd?.(() => {
      if (agentSpeechIdleTimerRef.current) {
        clearTimeout(agentSpeechIdleTimerRef.current)
        agentSpeechIdleTimerRef.current = null
      }
      setAgentActive(false)
    })
    return () => {
      cleanupChunk?.()
      cleanupEnd?.()
      if (agentSpeechIdleTimerRef.current) clearTimeout(agentSpeechIdleTimerRef.current)
    }
  }, [])

  // Session timer
  useEffect(() => {
    if (isSessionActive && !isSessionPaused) {
      timerRef.current = setInterval(() => {
        setSessionTime((prev) => prev + 1)
      }, 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isSessionActive])

  const handleStartStop = useCallback(async () => {
    if (isSessionActive) {
      setConfirmEndSession(true)
    } else {
      setShowSessionSetup(true)
    }
  }, [isSessionActive, isSessionPaused])

  const handleTogglePause = useCallback(async () => {
    if (!isSessionActive) return
    try {
      if (isSessionPaused) {
        await window.api.resumeSession()
      } else {
        await window.api.pauseSession()
      }
    } catch (err: any) {
      setCurrentAnswer(`Pause error: ${err.message}`)
    }
  }, [isSessionActive, isSessionPaused])

  const handleConfirmEnd = useCallback(async () => {
    setConfirmEndSession(false)
    try {
      await window.api.stopSession()
    } catch (err: any) {
      setCurrentAnswer(`Error: ${err.message}`)
    }
  }, [])

  const handleCancelEnd = useCallback(() => {
    setConfirmEndSession(false)
  }, [])

  const handleSessionStart = useCallback(async (ctx?: any) => {
    setShowSessionSetup(false)
    setCurrentSessionIntent('quick-help')
    try {
      await window.api.startSession(ctx)
    } catch (err: any) {
      setCurrentAnswer(`Error: ${err.message}`)
    }
  }, [])

  const handleSessionSkip = useCallback(async () => {
    setShowSessionSetup(false)
    setCurrentSessionIntent('quick-help')
    try {
      await window.api.startSession()
    } catch (err: any) {
      setCurrentAnswer(`Error: ${err.message}`)
    }
  }, [])

  const handleCaptureScreen = useCallback(async () => {
    try {
      pendingAnswerQuestionRef.current = latestQuestionRef.current || 'Screen Analysis'
      setShowAnswerPane(true)
      setCurrentAnswer('Analyzing screen...')
      setIsAnswering(true)
      await window.api.captureScreen()
    } catch (err: any) {
      setCurrentAnswer(`Screen capture error: ${err.message}`)
      setIsAnswering(false)
    }
  }, [])

  const handleRegenerate = useCallback(async () => {
    pendingAnswerQuestionRef.current =
      answerHistory[historyIndex]?.question || latestQuestionRef.current || 'Current Prompt'
    setShowAnswerPane(true)
    setCurrentAnswer('Regenerating...')
    setIsAnswering(true)
    await window.api.regenerateAnswer()
  }, [answerHistory, historyIndex])

  const handleAnswerNow = useCallback(async () => {
    pendingAnswerQuestionRef.current = latestQuestionRef.current || 'Current Prompt'
    setShowAnswerPane(true)
    setCurrentAnswer((prev) => prev || 'Preparing answer...')
    setIsAnswering(true)
    const result = await window.api.requestAnswer()
    if (result?.success === false) {
      setCurrentAnswer('Waiting for a clearer question before generating an answer.')
      setIsAnswering(false)
    }
  }, [])

  const handleAnswerForQuestion = useCallback(async (question: string) => {
    pendingAnswerQuestionRef.current = question
    setShowAnswerPane(true)
    setCurrentAnswer('Preparing answer...')
    setIsAnswering(true)
    const result = await window.api.requestAnswer(question)
    if (result?.success === false) {
      setCurrentAnswer('Waiting for a clearer detected question before generating an answer.')
      setIsAnswering(false)
      return false
    }
    return true
  }, [])

  // Chat input routes through the active agent as a conversational turn.
  // The agent decides how to reply (bubble, open answer window, solve_with_openrouter)
  // using the full transcript thread — including prior chat messages — for context.
  const handleSendChatMessage = useCallback(async (text: string) => {
    await window.api.sendChatMessage(text)
  }, [])

  const handleToggleMic = useCallback(async () => {
    const nextValue = !micEnabled
    setMicEnabled(nextValue)
    await window.api.setConfig({ micEnabled: nextValue })
  }, [micEnabled])

  const handleToggleLiveVoice = useCallback(async () => {
    if (liveAgentMode === 'off') return
    const next = liveAgentMode !== 'voice'
    setLiveAgentMode(next ? 'voice' : 'text')
    await window.api.setLiveAgentVoicePlayback(next)
  }, [liveAgentMode])

  const handleToggleLiveCaptions = useCallback(async () => {
    const next = !liveAgentCaptionsEnabled
    setLiveAgentCaptionsEnabled(next)
    await window.api.setLiveAgentCaptions(next)
  }, [liveAgentCaptionsEnabled])

  const handleToggleAnswerWindow = useCallback(() => {
    window.api.toggleAnswerWindow()
  }, [])

  const handleHideAnswerWindow = useCallback(() => {
    window.api.hideAnswerWindow()
  }, [])

  useEffect(() => {
    const cleanupToggle = window.api.onShortcutToggleSession(() => {
      void handleStartStop()
    })
    const cleanupCapture = window.api.onShortcutCaptureScreen(() => {
      void handleCaptureScreen()
    })
    const cleanupRegenerate = window.api.onShortcutRegenerate(() => {
      void handleRegenerate()
    })
    const cleanupAnswerNow = window.api.onShortcutAnswerNow(() => {
      void handleAnswerNow()
    })
    const cleanupSttActivity = window.api.onSttActivity(() => {
      setSttActive(true)
      if (sttIdleTimerRef.current) clearTimeout(sttIdleTimerRef.current)
      sttIdleTimerRef.current = setTimeout(() => setSttActive(false), 2000)
    })

    return () => {
      cleanupToggle()
      cleanupCapture()
      cleanupRegenerate()
      cleanupAnswerNow()
      cleanupSttActivity()
      if (sttIdleTimerRef.current) clearTimeout(sttIdleTimerRef.current)
    }
  }, [handleAnswerNow, handleCaptureScreen, handleRegenerate, handleStartStop])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const detectedQuestionEntry = [...transcript]
    .reverse()
    .find((entry) => isExternalAudioEntry(entry) && Boolean(getAnswerCandidateText(entry.text)))
  const latestQuestion =
    interimTranscript.system ||
    detectedQuestionEntry?.text ||
    [...transcript].reverse().find((entry) => isExternalAudioEntry(entry))?.text ||
    ''
  const visibleTranscript = transcript.slice(-12)
  const selectedHistoryEntry = historyIndex >= 0 ? answerHistory[historyIndex] : null
  const displayedQuestion = isAnswering
    ? pendingAnswerQuestionRef.current || latestQuestion || selectedHistoryEntry?.question || 'Current Prompt'
    : selectedHistoryEntry?.question || latestQuestion
  // Explicit ternary (not `||`): an image-only history entry has answer ''
  // and must show just its image, not fall back to stale streamed text.
  const displayedAnswer = isAnswering
    ? currentAnswer
    : selectedHistoryEntry
      ? selectedHistoryEntry.answer
      : currentAnswer
  const displayedAttachments = isAnswering
    ? currentAttachments
    : selectedHistoryEntry?.attachments || currentAttachments
  const displayedModelId = isAnswering
    ? currentModelSelection.modelId
    : selectedHistoryEntry?.modelId || currentModelSelection.modelId
  const displayedRoutingReason = isAnswering
    ? currentModelSelection.reason
    : selectedHistoryEntry?.routingReason || currentModelSelection.reason
  const displayedServedBy = isAnswering
    ? null
    : selectedHistoryEntry?.servedBy || currentServedBy
  const detailCapabilities = getSessionBehavior(currentSessionIntent || 'quick-help').detailCapabilities

  useEffect(() => {
    latestQuestionRef.current = latestQuestion
  }, [latestQuestion])

  // Centralized overlay resize — keeps window tightly fitted to visible content
  useEffect(() => {
    const fallbackWidth = (controlBarWidth || 600) + 40
    const fallbackHeight =
      showSessionSetup && !isSessionActive
        ? 760
        : confirmEndSession
          ? 520
          : controlsHeight
    const measuredWidth = overlayContentSize.width > 0 ? Math.ceil(overlayContentSize.width) + 12 : 0
    const measuredHeight = overlayContentSize.height > 0 ? Math.ceil(overlayContentSize.height) + 12 : 0
    const w = Math.max(fallbackWidth, measuredWidth)
    const h = Math.max(fallbackHeight, measuredHeight)
    void window.api.resizeOverlay(w, h)
  }, [controlBarWidth, controlsHeight, overlayContentSize, showSessionSetup, isSessionActive, confirmEndSession])

  useEffect(() => {
    const node = controlBarRef.current
    if (!node) return

    const updateWidth = () => {
      setControlBarWidth(Math.ceil(node.getBoundingClientRect().width))
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    window.addEventListener('resize', updateWidth)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  useEffect(() => {
    const node = layoutRef.current
    if (!node) return

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      setOverlayContentSize({
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    window.addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [showSessionSetup, confirmEndSession, showTranscript, isSessionActive])

  const handleClearAnswers = useCallback(() => {
    pendingAnswerQuestionRef.current = ''
    setCurrentAnswer('')
    setCurrentAttachments([])
    setAnswerHistory([])
    setHistoryIndex(-1)
    setCurrentModelSelection({ modelId: '', reason: '' })
    currentModelSelectionRef.current = { modelId: '', reason: '' }
  }, [])

  if (isPreviewView) {
    return (
      <div className="overlay-shell h-full w-full bg-transparent p-0 text-white">
        <FilePreview />
      </div>
    )
  }

  if (isAnswerView) {
    const companionHasAnswerSurface =
      showAnswerPane ||
      isAnswering ||
      displayedAnswer.trim().length > 0 ||
      answerHistory.length > 0

    if (!companionHasAnswerSurface) {
      return <div className="overlay-shell h-full w-full bg-transparent p-0 text-white" />
    }

    return (
      <div className="overlay-shell h-full w-full bg-transparent p-0 text-white">
        <div className="glass-deep flex h-full min-h-105 flex-col overflow-hidden rounded-2xl">
          <div className="drag-handle flex cursor-grab items-center justify-between border-b border-white/6 px-4 py-2 active:cursor-grabbing">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-200/80">
              Detail
            </span>
            <button
              onClick={handleHideAnswerWindow}
              className="no-drag rounded-lg px-2 py-1 text-[12px] text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
              title="Close"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <AISuggestion
              answer={displayedAnswer}
              attachments={displayedAttachments}
              isStreaming={isAnswering}
              question={displayedQuestion}
              canGoBack={historyIndex > 0}
              canGoForward={historyIndex >= 0 && historyIndex < answerHistory.length - 1}
              historyLabel={answerHistory.length > 0 ? `${historyIndex + 1} / ${answerHistory.length}` : undefined}
              onGoBack={() => setHistoryIndex((prev) => Math.max(0, prev - 1))}
              onGoForward={() => setHistoryIndex((prev) => Math.min(answerHistory.length - 1, prev + 1))}
              detailCapabilities={detailCapabilities}
              modelId={displayedModelId}
              routingReason={displayedRoutingReason}
              servedBy={displayedServedBy ?? undefined}
              onClear={handleClearAnswers}
              onClose={handleHideAnswerWindow}
            />
          </div>
        </div>
      </div>
    )
  }

  if (isMinimized) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <button
          onClick={() => setIsMinimized(false)}
          className="glass-panel flex items-center gap-2 rounded-full px-5 py-3 text-[13px] font-semibold text-white/70 transition-all duration-200 hover:text-white/90"
          title="Expand overlay"
        >
          <Sparkles size={15} />
          Open Assistant
        </button>
      </div>
    )
  }

  return (
    <div className="overlay-shell relative h-full w-full bg-transparent p-5 text-white">
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        <div
          ref={layoutRef}
          className="inline-flex flex-col items-start overflow-visible"
        >
        <div
          ref={controlBarRef}
          className="pointer-events-auto relative z-20 shrink-0 p-5 pb-0"
        >
          <Controls
            isSessionActive={isSessionActive}
            isSessionPaused={isSessionPaused}
            presenceState={presenceState}
            sessionLabel={isSessionActive ? `${isSessionPaused ? 'Paused' : 'Live'} ${formatTime(sessionTime)}` : 'Ready'}
            onStartStop={handleStartStop}
            onTogglePause={handleTogglePause}
            onAnswerNow={handleAnswerNow}
            onCaptureScreen={handleCaptureScreen}
            onToggleMic={handleToggleMic}
            onToggleTranscript={() => setShowTranscript((prev) => !prev)}
            onToggleAnswerPane={handleToggleAnswerWindow}
            onSendQuestion={handleSendChatMessage}
            onMinimize={() => setIsMinimized(true)}
            showTranscript={showTranscript}
            micEnabled={micEnabled}
            showAnswerPane={showAnswerPane}
            liveAgentMode={liveAgentMode}
            liveAgentCaptionsEnabled={liveAgentCaptionsEnabled}
            companionRealtimeStatus={companionRealtimeStatus}
            onToggleLiveVoice={handleToggleLiveVoice}
            onToggleLiveCaptions={handleToggleLiveCaptions}
            onHeightChange={setControlsHeight}
            sttActive={sttActive}
            agentActive={agentActive}
            sessionTokens={sessionTokens}
          />
        </div>

        {showSessionSetup && !isSessionActive && (
          <div
            className="pointer-events-auto relative z-15 mt-2 px-5"
            style={controlBarWidth ? { width: `${controlBarWidth}px` } : undefined}
          >
            <SessionSetup
              onStart={handleSessionStart}
              onSkip={handleSessionSkip}
              onCancel={() => setShowSessionSetup(false)}
            />
          </div>
        )}

        {confirmEndSession && (
          <div
            className="pointer-events-auto relative z-15 mt-2 px-5"
            style={controlBarWidth ? { width: `${controlBarWidth}px` } : undefined}
          >
            <div className="glass-deep glass-materialize rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={15} className="text-amber-400/80" />
                <p className="text-[13px] font-medium text-white/80">End this session?</p>
              </div>
              <p className="text-[11px] text-white/40 mb-4">
                The transcript and answers will be saved to session history.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmEnd}
                  className="flex-1 rounded-lg bg-red-500/15 border border-red-500/20 py-2 text-[12px] font-semibold text-red-400 hover:bg-red-500/25 transition-all"
                >
                  End Session
                </button>
                <button
                  onClick={handleCancelEnd}
                  className="flex-1 rounded-lg bg-white/4 border border-white/6 py-2 text-[12px] font-medium text-white/40 hover:text-white/60 hover:bg-white/6 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showTranscript && (
          <div
            className="pointer-events-auto relative z-10 mt-2 min-h-0 shrink overflow-hidden px-5"
            style={controlBarWidth ? { width: `${controlBarWidth}px` } : undefined}
          >
            <Transcript
              entries={visibleTranscript}
              detectedQuestion={detectedQuestionEntry?.text}
              sessionIntent={currentSessionIntent || 'quick-help'}
              systemInterimText={interimTranscript.system}
              userInterimText={interimTranscript.user}
              onAnswerThis={() => {
                if (detectedQuestionEntry?.text) {
                  void handleAnswerForQuestion(detectedQuestionEntry.text)
                }
              }}
              onClear={() => {
                setTranscript([])
                setInterimTranscript({ system: '', user: '' })
              }}
              onHide={() => setShowTranscript(false)}
            />
          </div>
        )}
        </div>
      </div>

      {/* Audio capture component (hidden, handles audio stream) */}
      {isSessionActive && !isSessionPaused && <AudioCapture micEnabled={micEnabled} />}
    </div>
  )
}

function getAnswerCandidateText(text: string): string | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 4) return null
  if (words.length > 70) return null

  // Explicit question mark with enough substance
  if (normalized.endsWith('?')) return cleanCandidateText(text)

  // Filler/acknowledgment — never a question
  const fillerPhrases = [
    'got it', 'sounds good', 'perfect', 'alright', 'okay',
    'good answer', 'great answer', 'nice work', 'thanks',
    'thank you', 'i see', 'that makes sense', 'interesting',
    'let me', 'moving on', 'so next', 'one moment',
  ]
  if (fillerPhrases.some((p) => normalized.startsWith(p))) return null

  // Strong question starters
  const starters = [
    'what', 'why', 'how', 'when', 'where', 'which',
    'tell me', 'walk me', 'can you', 'could you', 'would you',
    'describe', 'explain', 'give me', 'talk about', 'share',
    'have you', 'do you', 'did you', 'are you', 'were you',
    'is there', 'was there',
  ]

  if (starters.some((starter) => normalized.startsWith(starter))) {
    return cleanCandidateText(text)
  }

  const promptPatterns = [
    /\b(can|could) someone\b/,
    /\bdoes anyone\b/,
    /\bthe question is\b/,
    /\bmy question is\b/,
    /\bi (?:would )?like to understand\b/,
    /\bi wonder\b/,
    /\blet'?s (?:discuss|talk through|compare|review)\b/,
    /\bwe (?:need|should|have) to (?:answer|explain|decide|figure out|understand|compare)\b/,
    /\bhelp me understand\b/,
    /\bwhat about\b/,
    /\bdefine\b/,
    /\bderive\b/,
    /\bcalculate\b/,
    /\bsolve\b/,
  ]

  return promptPatterns.some((pattern) => pattern.test(normalized))
    ? cleanCandidateText(text)
    : null
}

function getInterimTranscriptBucket(entry: TranscriptEntry): 'system' | 'user' {
  return isExternalAudioEntry(entry) ? 'system' : 'user'
}

function transcriptWindowWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function cleanTranscriptPiece(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function cleanCandidateText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^(question|prompt|q)\s*:\s*/i, '')
    .trim()
}

function normalizeCandidateText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
}

function isSessionIntent(value: unknown): value is SessionIntent {
  return value === 'quick-help'
}
