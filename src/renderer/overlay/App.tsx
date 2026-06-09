import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, AlertTriangle } from 'lucide-react'
import type {
  AgentPresenceState,
  AgentMode,
  AnswerAttachment,
  AnswerDonePayload,
  CompanionRealtimeStatus,
  LiveAgentMode,
  MeetingNote,
  SessionIntent,
  TranscriptAudioSource,
} from '@shared/types'
import type { StudyNotesSnapshot } from '@shared/session-brain-types'
import Transcript from './components/Transcript'
import AISuggestion from './components/AISuggestion'
import FilePreview from './components/FilePreview'
import AnswerTeleprompter from './components/AnswerTeleprompter'
import AnswerQueue, { AnswerCandidate } from './components/AnswerQueue'
import MeetingNotes from './components/MeetingNotes'
import Controls from './components/Controls'
import AudioCapture from './components/AudioCapture'
import SessionSetup from './components/SessionSetup'
import { getSessionBehavior, isExternalAudioEntry } from '@shared/session-intent-policy'

type AnswerTab = 'answer' | 'queue' | 'notes' | 'companion'

interface TranscriptEntry {
  id: string
  text: string
  speaker: 'interviewer' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  source?: 'stt' | 'chat'
  audioSource?: TranscriptAudioSource
}

interface TranscriptWindow {
  id: string
  text: string
  speaker: 'external' | 'unknown'
  timestamp: number
  lastTimestamp: number
  entryCount: number
}

interface AnswerHistoryEntry {
  question: string
  answer: string
  timestamp: number
  modelId?: string
  routingReason?: string
  attachments?: AnswerAttachment[]
}

export default function App() {
  const viewParam = new URLSearchParams(window.location.search).get('view')
  const isAnswerView = viewParam === 'answer'
  const isPreviewView = viewParam === 'preview'
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [isSessionPaused, setIsSessionPaused] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [interimTranscript, setInterimTranscript] = useState<{ interviewer: string; user: string }>({
    interviewer: '',
    user: '',
  })
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [currentAttachments, setCurrentAttachments] = useState<AnswerAttachment[]>([])
  const [answerHistory, setAnswerHistory] = useState<AnswerHistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isAnswering, setIsAnswering] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showAnswerPane, setShowAnswerPane] = useState(true)
  const [answerTab, setAnswerTab] = useState<AnswerTab>('answer')
  const [activeMode, setActiveMode] = useState<AgentMode>('interview')
  const [answerCandidates, setAnswerCandidates] = useState<AnswerCandidate[]>([])
  const [meetingNotes, setMeetingNotes] = useState<MeetingNote[]>([])
  const [studyNotes, setStudyNotes] = useState<StudyNotesSnapshot | null>(null)
  const [answerTeleprompterOpen, setAnswerTeleprompterOpen] = useState(false)
  const [currentSessionIntent, setCurrentSessionIntent] = useState<SessionIntent | null>(null)
  const [showTranscript, setShowTranscript] = useState(true)
  const [autoAnswerEnabled, setAutoAnswerEnabled] = useState(true)
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
  const activeCandidateIdRef = useRef<string | null>(null)
  const transcriptWindowRef = useRef<TranscriptWindow | null>(null)
  const meetingNotesRef = useRef<MeetingNote[]>([])
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

  const updateMeetingNotes = useCallback((updater: (notes: MeetingNote[]) => MeetingNote[]) => {
    setMeetingNotes((prev) => {
      const next = updater(prev)
      meetingNotesRef.current = next
      return next
    })
  }, [currentSessionIntent])

  const replaceMeetingNotes = useCallback((notes: MeetingNote[]) => {
    meetingNotesRef.current = notes
    setMeetingNotes(notes)
  }, [])

  const flushTranscriptWindow = useCallback((windowToFlush?: TranscriptWindow | null) => {
    const transcriptWindow = windowToFlush ?? transcriptWindowRef.current
    if (!transcriptWindow) return

    const candidateText = getAnswerCandidateText(transcriptWindow.text)
    const entry = transcriptWindowToEntry(transcriptWindow)
    if (candidateText) {
      setAnswerCandidates((prev) => addAnswerCandidate(prev, entry, candidateText))
      if ((activeMode === 'interview' || currentSessionIntent === 'class') && !isAnswering) {
        setAnswerTab('queue')
      }
    } else if (currentSessionIntent !== 'class') {
      const noteText = getMeetingNoteText(transcriptWindow.text)
      if (noteText) {
        updateMeetingNotes((prev) => addMeetingNote(prev, entry, noteText))
      }
    }

    if (!windowToFlush) {
      transcriptWindowRef.current = null
    }
  }, [activeMode, currentSessionIntent, isAnswering, updateMeetingNotes])

  // Listen for transcript updates from main process
  useEffect(() => {
    const cleanup = window.api.onTranscriptUpdate((entry: TranscriptEntry) => {
      const speaker = getInterimTranscriptBucket(entry)

      if (entry.isFinal) {
        setTranscript((prev) => [...prev, entry])
        if (isExternalAudioEntry(entry)) {
          const { ready, current } = appendTranscriptWindow(transcriptWindowRef.current, entry)
          transcriptWindowRef.current = current
          if (ready) flushTranscriptWindow(ready)
        } else if (transcriptWindowRef.current) {
          flushTranscriptWindow()
        }
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
  }, [flushTranscriptWindow])

  useEffect(() => {
    void window.api.setSessionNotes(meetingNotes)
  }, [meetingNotes])

  useEffect(() => {
    void window.api.getStudyNotes?.().then((snapshot) => {
      if (snapshot) setStudyNotes(snapshot)
    })
    const cleanup = window.api.onStudyNotesUpdate?.((snapshot) => {
      setStudyNotes(snapshot)
    })
    return () => cleanup?.()
  }, [])

  // Listen for LLM answer chunks
  useEffect(() => {
    const cleanupChunk = window.api.onAnswerChunk((answer: string) => {
      if (answer === '') {
        pendingAnswerQuestionRef.current = pendingAnswerQuestionRef.current || latestQuestionRef.current || 'Current Prompt'
        setAnswerTeleprompterOpen(false)
        setCurrentAttachments([])
      }
      setAnswerTab('answer')
      setShowAnswerPane(true)
      setCurrentAnswer(answer)
      setIsAnswering(true)
    })
    const cleanupDone = window.api.onAnswerDone((payload: string | AnswerDonePayload) => {
      const answer = typeof payload === 'string' ? payload : payload.text
      const attachments = typeof payload === 'string' ? [] : payload.attachments ?? []
      if (answer.trim()) {
        setAnswerTab('answer')
        setShowAnswerPane(true)
      }
      setCurrentAnswer(answer)
      setCurrentAttachments(attachments)
      setIsAnswering(false)

      const question = pendingAnswerQuestionRef.current || latestQuestionRef.current || 'Current Prompt'
      if (answer.trim()) {
        if (shouldAutoOpenAnswerTeleprompter(question, answer, currentSessionIntent)) {
          setAnswerTeleprompterOpen(true)
        }
        const answeredCandidateId = activeCandidateIdRef.current
        if (answeredCandidateId) {
          setAnswerCandidates((prev) =>
            prev.map((item) =>
              item.id === answeredCandidateId ? { ...item, status: 'answered' } : item
            )
          )
          activeCandidateIdRef.current = null
        }

        setAnswerHistory((prev) => {
          const nextEntry = {
            question,
            answer,
            timestamp: Date.now(),
            modelId: currentModelSelectionRef.current.modelId,
            routingReason: currentModelSelectionRef.current.reason,
            attachments,
          }

          const isDuplicate =
            prev.length > 0 &&
            prev[prev.length - 1].question === nextEntry.question &&
            prev[prev.length - 1].answer === nextEntry.answer &&
            prev[prev.length - 1].modelId === nextEntry.modelId &&
            prev[prev.length - 1].routingReason === nextEntry.routingReason

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
      if (config?.agentMode) {
        setActiveMode(config.agentMode as AgentMode)
      }
      setAutoAnswerEnabled(config?.autoAnswerEnabled ?? true)
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
    if (typeof state.autoAnswerEnabled === 'boolean') {
      setAutoAnswerEnabled(state.autoAnswerEnabled)
    }
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
      setAnswerTeleprompterOpen(false)
      setTranscript([])
      setInterimTranscript({ interviewer: '', user: '' })
      pendingAnswerQuestionRef.current = ''
      latestQuestionRef.current = ''
      setAnswerCandidates([])
      setStudyNotes(null)
      activeCandidateIdRef.current = null
      setCurrentSessionIntent(null)
      setCurrentModelSelection({ modelId: '', reason: '' })
      currentModelSelectionRef.current = { modelId: '', reason: '' }
      if (typeof state.companionRealtimeStatus !== 'string') {
        setCompanionRealtimeStatus('off')
      }
    }
  }, [])

  useEffect(() => {
    const cleanup = window.api.onModeActive((mode) => {
      setActiveMode(mode)
      switch (mode) {
        case 'interview':
          setAnswerTab((prev) => prev === 'companion' ? 'answer' : prev)
          break
        case 'companion':
          setAnswerTab('answer')
          setAnswerTeleprompterOpen(false)
          break
        default:
          setAnswerTeleprompterOpen(false)
      }
    })
    return cleanup
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
      flushTranscriptWindow()
      await window.api.setSessionNotes(meetingNotesRef.current)
      await window.api.stopSession()
    } catch (err: any) {
      setCurrentAnswer(`Error: ${err.message}`)
    }
  }, [flushTranscriptWindow])

  const handleCancelEnd = useCallback(() => {
    setConfirmEndSession(false)
  }, [])

  const handleSessionStart = useCallback(async (ctx?: any) => {
    setShowSessionSetup(false)
    setCurrentSessionIntent(isSessionIntent(ctx?.sessionIntent) ? ctx.sessionIntent : 'interview')
    transcriptWindowRef.current = null
    replaceMeetingNotes([])
    setStudyNotes(null)
    try {
      await window.api.startSession(ctx)
    } catch (err: any) {
      setCurrentAnswer(`Error: ${err.message}`)
    }
  }, [replaceMeetingNotes])

  const handleSessionSkip = useCallback(async () => {
    setShowSessionSetup(false)
    setCurrentSessionIntent('interview')
    transcriptWindowRef.current = null
    replaceMeetingNotes([])
    setStudyNotes(null)
    try {
      await window.api.startSession()
    } catch (err: any) {
      setCurrentAnswer(`Error: ${err.message}`)
    }
  }, [replaceMeetingNotes])

  const handleCaptureScreen = useCallback(async () => {
    try {
      pendingAnswerQuestionRef.current = latestQuestionRef.current || 'Screen Analysis'
      setAnswerTeleprompterOpen(false)
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
    setAnswerTeleprompterOpen(false)
    setShowAnswerPane(true)
    setCurrentAnswer('Regenerating...')
    setIsAnswering(true)
    await window.api.regenerateAnswer()
  }, [answerHistory, historyIndex])

  const handleAnswerNow = useCallback(async () => {
    pendingAnswerQuestionRef.current = latestQuestionRef.current || 'Current Prompt'
    setAnswerTeleprompterOpen(false)
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
    setAnswerTeleprompterOpen(false)
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

  const handleAnswerCandidate = useCallback(async (candidate: AnswerCandidate) => {
    activeCandidateIdRef.current = candidate.id
    setAnswerCandidates((prev) =>
      prev.map((item) =>
        item.id === candidate.id ? { ...item, status: 'answering' } : item
      )
    )
    const queued = await handleAnswerForQuestion(candidate.text)
    if (!queued) {
      activeCandidateIdRef.current = null
      setAnswerCandidates((prev) =>
        prev.map((item) =>
          item.id === candidate.id ? { ...item, status: 'new' } : item
        )
      )
    }
  }, [handleAnswerForQuestion])

  const handleDismissCandidate = useCallback((id: string) => {
    if (activeCandidateIdRef.current === id) activeCandidateIdRef.current = null
    setAnswerCandidates((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: 'dismissed' } : item
      )
    )
  }, [])

  const handleClearDismissedCandidates = useCallback(() => {
    setAnswerCandidates((prev) => prev.filter((item) => item.status !== 'dismissed'))
  }, [])

  // Chat input routes through the active agent as a conversational turn.
  // The agent decides how to reply (bubble, open answer window, solve_with_openrouter)
  // using the full transcript thread — including prior chat messages — for context.
  const handleSendChatMessage = useCallback(async (text: string) => {
    await window.api.sendChatMessage(text)
  }, [])

  const handleToggleAutoAnswers = useCallback(async () => {
    const nextValue = !autoAnswerEnabled
    setAutoAnswerEnabled(nextValue)
    await window.api.setConfig({ autoAnswerEnabled: nextValue })
  }, [autoAnswerEnabled])

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
    interimTranscript.interviewer ||
    detectedQuestionEntry?.text ||
    [...transcript].reverse().find((entry) => isExternalAudioEntry(entry))?.text ||
    ''
  const visibleTranscript = transcript.slice(-12)
  const selectedHistoryEntry = historyIndex >= 0 ? answerHistory[historyIndex] : null
  const displayedQuestion = isAnswering
    ? pendingAnswerQuestionRef.current || latestQuestion || selectedHistoryEntry?.question || 'Current Prompt'
    : selectedHistoryEntry?.question || latestQuestion
  const displayedAnswer = isAnswering ? currentAnswer : selectedHistoryEntry?.answer || currentAnswer
  const displayedAttachments = isAnswering
    ? currentAttachments
    : selectedHistoryEntry?.attachments || currentAttachments
  const displayedModelId = isAnswering
    ? currentModelSelection.modelId
    : selectedHistoryEntry?.modelId || currentModelSelection.modelId
  const displayedRoutingReason = isAnswering
    ? currentModelSelection.reason
    : selectedHistoryEntry?.routingReason || currentModelSelection.reason
  const detailCapabilities = getSessionBehavior(currentSessionIntent || 'interview').detailCapabilities
  const hasDetailCapability = (capability: string): boolean =>
    detailCapabilities.includes(capability as any)
  const answerTabs = [
    hasDetailCapability('detail') ? { value: 'answer' as const, label: 'Detail', count: 0 } : null,
    hasDetailCapability('queue')
      ? {
          value: 'queue' as const,
          label: 'Queue',
          count: answerCandidates.filter((item) => item.status === 'new').length,
        }
      : null,
    hasDetailCapability('notes')
      ? {
          value: 'notes' as const,
          label: currentSessionIntent === 'class' ? 'Study Notes' : 'Notes',
          count: currentSessionIntent === 'class' ? countStudyNotes(studyNotes) : meetingNotes.length,
        }
      : null,
  ].filter((tab): tab is { value: AnswerTab; label: string; count: number } => Boolean(tab))

  useEffect(() => {
    if (answerTabs.some((tab) => tab.value === answerTab)) return
    setAnswerTab(answerTabs[0]?.value ?? 'answer')
  }, [answerTab, answerTabs])

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
    setAnswerTeleprompterOpen(false)
    setCurrentModelSelection({ modelId: '', reason: '' })
    currentModelSelectionRef.current = { modelId: '', reason: '' }
    setAnswerCandidates([])
    activeCandidateIdRef.current = null
    transcriptWindowRef.current = null
    replaceMeetingNotes([])
  }, [replaceMeetingNotes])

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

    if (activeMode === 'companion' && !companionHasAnswerSurface) {
      return <div className="overlay-shell h-full w-full bg-transparent p-0 text-white" />
    }

    return (
      <div className="overlay-shell h-full w-full bg-transparent p-0 text-white">
        {answerTeleprompterOpen && displayedAnswer.trim() ? (
          <AnswerTeleprompter
            answer={displayedAnswer}
            question={displayedQuestion}
            isStreaming={isAnswering}
            onExit={() => setAnswerTeleprompterOpen(false)}
            onClose={handleHideAnswerWindow}
          />
        ) : (
          <div className="flex h-full min-h-105 flex-col overflow-hidden rounded-2xl border border-white/6 bg-[rgba(10,12,16,0.92)] shadow-[0_16px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
            <div className="drag-handle flex cursor-grab items-center justify-between border-b border-white/6 px-4 py-2 active:cursor-grabbing">
              <div className="no-drag flex gap-1 rounded-xl bg-white/3 p-1">
                {answerTabs.map(({ value, label, count }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAnswerTab(value)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                      answerTab === value
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'text-white/35 hover:bg-white/4 hover:text-white/65'
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span className="ml-2 rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-[10px] text-cyan-200/80">
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={handleHideAnswerWindow}
                className="no-drag rounded-lg px-2 py-1 text-[12px] text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
                title="Close"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden p-3">
              {answerTab === 'queue' ? (
                <AnswerQueue
                  candidates={answerCandidates}
                  sessionIntent={currentSessionIntent || 'interview'}
                  onAnswer={handleAnswerCandidate}
                  onDismiss={handleDismissCandidate}
                  onClearDismissed={handleClearDismissedCandidates}
                />
              ) : answerTab === 'notes' ? (
                <MeetingNotes
                  notes={meetingNotes}
                  studyNotes={studyNotes}
                  sessionIntent={currentSessionIntent || 'interview'}
                  onClear={() => {
                    transcriptWindowRef.current = null
                    replaceMeetingNotes([])
                  }}
                  onAnswerFollowUp={(question) => {
                    setAnswerTab('answer')
                    void handleAnswerForQuestion(question)
                  }}
                  onCopyFollowUp={(question) => window.api.copyToClipboard(question)}
                />
              ) : (
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
                  onOpenTeleprompter={() => setAnswerTeleprompterOpen(true)}
                  detailCapabilities={detailCapabilities}
                  modelId={displayedModelId}
                  routingReason={displayedRoutingReason}
                  onClear={handleClearAnswers}
                  onClose={handleHideAnswerWindow}
                />
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (isMinimized) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 rounded-2xl border border-white/6 bg-[rgba(12,14,18,0.82)] px-5 py-3 text-[13px] font-semibold text-white/70 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-all duration-200 hover:bg-[rgba(12,14,18,0.92)] hover:text-white/90"
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
            onToggleAutoAnswers={handleToggleAutoAnswers}
            onToggleAnswerPane={handleToggleAnswerWindow}
            onSendQuestion={handleSendChatMessage}
            onMinimize={() => setIsMinimized(true)}
            showTranscript={showTranscript}
            autoAnswerEnabled={autoAnswerEnabled}
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
            <div className="rounded-2xl border border-white/6 bg-[rgba(12,14,18,0.92)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl p-4">
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
              sessionIntent={currentSessionIntent || 'interview'}
              interviewerInterimText={interimTranscript.interviewer}
              userInterimText={interimTranscript.user}
              onAnswerThis={() => {
                if (detectedQuestionEntry?.text) {
                  void handleAnswerForQuestion(detectedQuestionEntry.text)
                }
              }}
              onClear={() => {
                transcriptWindowRef.current = null
                setTranscript([])
                setInterimTranscript({ interviewer: '', user: '' })
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

  const meetingPromptPatterns = [
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

  return meetingPromptPatterns.some((pattern) => pattern.test(normalized))
    ? cleanCandidateText(text)
    : null
}

function appendTranscriptWindow(
  current: TranscriptWindow | null,
  entry: TranscriptEntry
): { ready: TranscriptWindow | null; current: TranscriptWindow | null } {
  const nextPiece = cleanTranscriptPiece(entry.text)
  if (!nextPiece) return { ready: null, current }

  const speaker = entry.speaker === 'unknown' ? 'unknown' : 'external'
  const timestamp = entry.timestamp || Date.now()
  const gapMs = current ? timestamp - current.lastTimestamp : 0

  if (!current || current.speaker !== speaker || gapMs > 6500) {
    return {
      ready: current && transcriptWindowWords(current.text) >= 8 ? current : null,
      current: createTranscriptWindow(entry, speaker, nextPiece, timestamp),
    }
  }

  const merged: TranscriptWindow = {
    ...current,
    text: `${current.text} ${nextPiece}`.replace(/\s+/g, ' ').trim(),
    lastTimestamp: timestamp,
    entryCount: current.entryCount + 1,
  }

  if (shouldFlushTranscriptWindow(merged, nextPiece)) {
    return { ready: merged, current: null }
  }

  return { ready: null, current: merged }
}

function createTranscriptWindow(
  entry: TranscriptEntry,
  speaker: TranscriptWindow['speaker'],
  text: string,
  timestamp: number
): TranscriptWindow {
  return {
    id: entry.id || `${timestamp}:${text}`,
    text,
    speaker,
    timestamp,
    lastTimestamp: timestamp,
    entryCount: 1,
  }
}

function shouldFlushTranscriptWindow(window: TranscriptWindow, latestPiece: string): boolean {
  const words = transcriptWindowWords(window.text)
  if (words >= 42) return true
  if (words >= 14 && /[.!?]$/.test(latestPiece.trim())) return true
  if (words >= 8 && latestPiece.trim().endsWith('?')) return true
  return false
}

function transcriptWindowToEntry(window: TranscriptWindow): TranscriptEntry {
  return {
    id: window.id,
    text: window.text,
    speaker: window.speaker === 'external' ? 'interviewer' : 'unknown',
    audioSource: window.speaker === 'external' ? 'system' : undefined,
    timestamp: window.timestamp,
    isFinal: true,
  }
}

function getInterimTranscriptBucket(entry: TranscriptEntry): 'interviewer' | 'user' {
  return isExternalAudioEntry(entry) ? 'interviewer' : 'user'
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

function getMeetingNoteText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  const normalized = cleaned.toLowerCase()
  if (!normalized) return null
  if (normalized.endsWith('?')) return null

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 10) return null
  if (words.length > 90) return null
  if (/[,:;]$/.test(cleaned)) return null
  if (/\b(?:and|or|to|with|because|if|the|a|an|of|for|from|that|this)$/.test(normalized)) return null
  if (/^(?:and|but|because|to|then|with|or)\b/.test(normalized)) return null

  const fillerPhrases = [
    'got it', 'sounds good', 'perfect', 'alright', 'okay',
    'good answer', 'great answer', 'nice work', 'thanks',
    'thank you', 'i see', 'that makes sense', 'interesting',
    'one moment', 'let me check', 'moving on', 'next question',
    'super fun', 'too easy', 'come on', 'fingers crossed',
    'i know it is super sad', 'also this is the last week',
  ]
  if (fillerPhrases.some((phrase) => normalized.startsWith(phrase))) return null

  const offTopicPatterns = [
    /\b(?:jersey shore|trash italiano|heartbroken|thank you everybody|bye bye)\b/,
    /\b(?:last week that you'll have with me|start teaching my own class)\b/,
  ]
  if (offTopicPatterns.some((pattern) => pattern.test(normalized))) return null

  const notePatterns = [
    /\bwe (?:discussed|learned|covered|decided|agreed|reviewed|talked about)\b/,
    /\b(?:key point|main idea|takeaway|important|remember|note that)\b/,
    /\b(?:definition|concept|lesson|topic|agenda|action item|next step)\b/,
    /\b(?:means|refers to|is used for|works by|depends on|because|therefore)\b/,
    /\bthe difference between\b/,
    /\b(?:javascript|jsx|react|vite|npm|package|dependency|terminal|component|props|return|curly braces|variable shadowing|source of truth|confetti|react-use|react confetti)\b/,
    /\b(?:you have to|you need to|you should|don't forget|keep that in mind)\b/,
    /\b(?:is|are|was|were) (?:a|an|the|used|when|where|how|why)\b/,
    /\b(?:causes|requires|allows|helps|prevents|includes|supports|explains)\b/,
  ]

  return notePatterns.some((pattern) => pattern.test(normalized))
    ? cleanMeetingNoteText(cleaned)
    : null
}

function cleanMeetingNoteText(text: string): string {
  return text
    .replace(/^(?:so|okay|alright|basically|right),?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function addAnswerCandidate(
  candidates: AnswerCandidate[],
  entry: TranscriptEntry,
  text: string
): AnswerCandidate[] {
  const normalizedText = normalizeCandidateText(text)
  if (!normalizedText) return candidates
  const existing = candidates.find((candidate) => normalizeCandidateText(candidate.text) === normalizedText)
  if (existing) return candidates

  const next: AnswerCandidate = {
    id: entry.id || `${entry.timestamp}:${normalizedText}`,
    text,
    speaker: entry.speaker === 'unknown' ? 'speaker' : entry.speaker,
    timestamp: entry.timestamp || Date.now(),
    status: 'new',
  }
  return [...candidates, next].slice(-30)
}

function addMeetingNote(
  notes: MeetingNote[],
  entry: TranscriptEntry,
  text: string
): MeetingNote[] {
  const normalizedText = normalizeCandidateText(text)
  if (!normalizedText) return notes
  const existing = notes.find((note) => normalizeCandidateText(note.text) === normalizedText)
  if (existing) return notes

  const next: MeetingNote = {
    id: `note:${entry.id || `${entry.timestamp}:${normalizedText}`}`,
    text,
    speaker: entry.speaker === 'unknown' ? 'speaker' : entry.speaker,
    timestamp: entry.timestamp || Date.now(),
    followUp: buildFollowUpQuestion(text),
  }

  return [...notes, next].slice(-50)
}

function buildFollowUpQuestion(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const shortTopic = trimFollowUpTopic(normalized)
  const lower = normalized.toLowerCase()

  if (/\b(?:decided|agreed|action item|next step)\b/.test(lower)) {
    return `What are the next steps, owners, or risks for ${shortTopic}?`
  }

  if (/\bthe difference between\b/.test(lower)) {
    return `Can you compare the practical tradeoffs in ${shortTopic}?`
  }

  if (/\b(?:because|means|refers to|is used for|works by|depends on)\b/.test(lower)) {
    return `Can you give a concrete example of ${shortTopic}?`
  }

  if (/\bwe (?:discussed|learned|covered|reviewed|talked about)\b/.test(lower)) {
    return `What is the key takeaway from ${shortTopic}?`
  }

  return `Can you expand on ${shortTopic}?`
}

function trimFollowUpTopic(text: string): string {
  const withoutLeadIn = text
    .replace(/^(so|okay|alright|basically|in short),?\s+/i, '')
    .replace(/\.$/, '')
    .trim()

  if (withoutLeadIn.length <= 120) return withoutLeadIn
  return `${withoutLeadIn.slice(0, 117).trim()}...`
}

function normalizeCandidateText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
}

function countStudyNotes(snapshot: StudyNotesSnapshot | null): number {
  if (!snapshot) return 0
  return Object.values(snapshot.sections).reduce((sum, bullets) => sum + bullets.length, 0)
}

function isSessionIntent(value: unknown): value is SessionIntent {
  return value === 'interview' ||
    value === 'meeting' ||
    value === 'presentation' ||
    value === 'class' ||
    value === 'quick-help'
}

function shouldAutoOpenAnswerTeleprompter(
  question: string,
  answer: string,
  sessionIntent: SessionIntent | null
): boolean {
  if (sessionIntent !== 'interview') return false

  const normalizedQuestion = question.trim().toLowerCase()
  const normalizedAnswer = answer.trim().toLowerCase()
  if (!normalizedQuestion || !normalizedAnswer) return false
  if (normalizedAnswer.includes('```')) return false

  const detailedTaskPatterns = [
    /\b(screen|screenshot|capture|visible|see on|look at)\b/,
    /\b(code|debug|bug|error|stack trace|terminal|command|shell|powershell)\b/,
    /\b(write|edit|create|update|modify|refactor|implement|fix)\b.*\b(file|code|component|function|class|app)\b/,
    /\b(analy[sz]e|analysis|solve|calculate|proof|derive|compare|table)\b/,
  ]
  if (detailedTaskPatterns.some((pattern) => pattern.test(normalizedQuestion))) {
    return false
  }

  const spokenInterviewPatterns = [
    /\btell me about\b/,
    /\bwalk me through\b/,
    /\bdescribe\b/,
    /\bexplain\b/,
    /\bwhy (?:do|did|are|were|would)\b/,
    /\bwhat (?:is|are|was|were|would|makes|motivates)\b/,
    /\bhow (?:do|did|would|have|are)\b/,
    /\bcan you\b/,
    /\bcould you\b/,
    /\bgive me an example\b/,
  ]

  return spokenInterviewPatterns.some((pattern) => pattern.test(normalizedQuestion))
}
