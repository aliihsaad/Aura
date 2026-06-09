import {
  AnswerSnapshot,
  CompanionEngine,
  CompanionRealtimeStatus,
  LiveAgentMode,
  ModelSelectionInfo,
  RuntimeRecallDebugState,
  SessionIntent,
  TranscriptEntry,
} from '@shared/types'

interface HandleTranscriptEntryOptions {
  entry: TranscriptEntry
  transcript: TranscriptEntry[]
  maxTranscriptEntries: number
  getCurrentSessionId: () => string | undefined
  sessionFolderName?: string
  recordTranscriptFinalized: (entry: TranscriptEntry, sessionId: string | undefined, sessionFolderName?: string) => void
  publishTranscriptUpdate: (entry: TranscriptEntry) => void
}

interface BroadcastSessionStateOptions {
  isActive: boolean
  isPaused: boolean
  startTime: number | null
  autoAnswerEnabled: boolean
  micEnabled: boolean
  answerWindowVisible: boolean
  liveAgentMode: LiveAgentMode
  liveAgentCaptionsEnabled: boolean
  companionEngine?: CompanionEngine
  companionRealtimeStatus?: CompanionRealtimeStatus
  sessionIntent?: SessionIntent
  publishSessionState: (state: {
    isActive: boolean
    isPaused: boolean
    startTime: number | null
    autoAnswerEnabled: boolean
    micEnabled: boolean
    answerWindowVisible: boolean
    liveAgentMode: LiveAgentMode
    liveAgentCaptionsEnabled: boolean
    companionEngine?: CompanionEngine
    companionRealtimeStatus?: CompanionRealtimeStatus
    sessionIntent?: SessionIntent
  }) => void
}

interface BeginAnswerStreamOptions {
  question: string
  modelSelection: ModelSelectionInfo
  showAnswerWindow: () => void
  publishQuestion: (question: string) => void
  publishModelSelection: (modelSelection: ModelSelectionInfo) => void
  publishChunk: (value: string) => void
  broadcastSessionState: () => void
}

interface StreamAnswerChunkOptions {
  fullAnswer: string
  showAnswerWindow: () => void
  publishChunk: (value: string) => void
}

interface CompleteAnswerStreamOptions {
  answer: string
  question: string
  currentAnswers: AnswerSnapshot[]
  modelSelection: ModelSelectionInfo
  completedAt: number
  showAnswerWindow: () => void
  publishDone: (value: string) => void
  broadcastSessionState: () => void
}

interface ReportAnswerErrorOptions {
  error: Error
  publishDone: (value: string) => void
}

export class SessionStateService {
  buildRuntimeRecallDebugState(options: {
    sessionFolderName?: string
    sessionRecallContext?: string
    lastAnswerQuestion?: string
    lastAnswerRecallContext?: string
    lastScreenshotTrigger?: string
    lastScreenshotRecallContext?: string
    updatedAt?: number
  }): RuntimeRecallDebugState {
    return {
      sessionFolderName: options.sessionFolderName,
      sessionRecallContext: options.sessionRecallContext,
      lastAnswerQuestion: options.lastAnswerQuestion,
      lastAnswerRecallContext: options.lastAnswerRecallContext,
      lastScreenshotTrigger: options.lastScreenshotTrigger,
      lastScreenshotRecallContext: options.lastScreenshotRecallContext,
      updatedAt: options.updatedAt,
    }
  }

  handleTranscriptEntry(options: HandleTranscriptEntryOptions): TranscriptEntry[] {
    if (!options.entry.isFinal) {
      options.publishTranscriptUpdate(options.entry)
      return options.transcript
    }

    const nextTranscript = [...options.transcript, options.entry]
    const trimmedTranscript = nextTranscript.length > options.maxTranscriptEntries
      ? nextTranscript.slice(-options.maxTranscriptEntries)
      : nextTranscript

    options.recordTranscriptFinalized(
      options.entry,
      options.getCurrentSessionId(),
      options.sessionFolderName
    )
    options.publishTranscriptUpdate(options.entry)
    return trimmedTranscript
  }

  broadcastSessionState(options: BroadcastSessionStateOptions): void {
    options.publishSessionState({
      isActive: options.isActive,
      isPaused: options.isPaused,
      startTime: options.startTime,
      autoAnswerEnabled: options.autoAnswerEnabled,
      micEnabled: options.micEnabled,
      answerWindowVisible: options.answerWindowVisible,
      liveAgentMode: options.liveAgentMode,
      liveAgentCaptionsEnabled: options.liveAgentCaptionsEnabled,
      companionEngine: options.companionEngine,
      companionRealtimeStatus: options.companionRealtimeStatus,
      sessionIntent: options.sessionIntent,
    })
  }

  beginAnswerStream(options: BeginAnswerStreamOptions): void {
    options.showAnswerWindow()
    options.publishQuestion(options.question)
    options.publishModelSelection(options.modelSelection)
    options.publishChunk('')
    options.broadcastSessionState()
  }

  streamAnswerChunk(options: StreamAnswerChunkOptions): void {
    options.showAnswerWindow()
    options.publishChunk(options.fullAnswer)
  }

  completeAnswerStream(options: CompleteAnswerStreamOptions): {
    answers: AnswerSnapshot[]
    completedAt: number
  } {
    const answers = options.answer.trim() && options.question.trim()
      ? [
          ...options.currentAnswers,
          {
            question: options.question,
            answer: options.answer,
            timestamp: options.completedAt,
            modelId: options.modelSelection.modelId,
            routingReason: options.modelSelection.reason,
          },
        ]
      : options.currentAnswers

    options.showAnswerWindow()
    options.publishDone(options.answer)
    options.broadcastSessionState()

    return {
      answers,
      completedAt: options.completedAt,
    }
  }

  reportAnswerError(options: ReportAnswerErrorOptions): void {
    options.publishDone(`Error: ${options.error.message}`)
  }
}
