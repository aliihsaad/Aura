import type { AgentEngine, AnswerSnapshot, CompanionRealtimeStatus, ModelSelectionInfo, SessionReport, TranscriptEntry } from '@shared/types'
import { LLMService } from './llm-service'
import { PreparedSessionStartState, PreparedSessionStopState } from './session-lifecycle-service'
import { STTService } from './stt-service'
import type { SessionBrainService } from './agent/session-brain-service'

export class SessionRuntimeStore {
  sttService: STTService | null = null
  micSttService: STTService | null = null
  llmService: LLMService | null = null
  sessionBrain: SessionBrainService | null = null
  sessionTranscript: TranscriptEntry[] = []
  isSessionActive = false
  isSessionPaused = false
  lastGeneratedQuestion = ''
  lastGeneratedPromptTranscriptCount = 0
  lastAnswerCompletedAt = 0
  currentSessionStartTime: number | null = null
  currentSessionAnswers: AnswerSnapshot[] = []
  currentSessionReport: SessionReport | null = null
  lastRequestedQuestion = ''
  currentFileContext = ''
  currentSttKeyterms: string[] = []
  currentSessionRecallContext = ''
  lastAnswerRecallContext = ''
  lastAnswerRecallQuestion = ''
  lastScreenshotRecallContext = ''
  lastScreenshotRecallTrigger = ''
  lastRuntimeRecallUpdatedAt: number | undefined
  currentSessionScreenshots: string[] = []
  latestScreenSummary = ''
  latestScreenSummaryCapturedAt: number | undefined
  currentSessionFolderName = ''
  currentAgentEngine: AgentEngine = 'default'
  companionRealtimeStatus: CompanionRealtimeStatus = 'off'
  currentModelSelection: ModelSelectionInfo = {
    modelId: '',
    reason: '',
  }

  applyPreparedSessionStart(prepared: PreparedSessionStartState): void {
    this.sessionTranscript = []
    this.isSessionActive = false
    this.isSessionPaused = false
    this.lastGeneratedQuestion = prepared.lastGeneratedQuestion
    this.lastGeneratedPromptTranscriptCount = prepared.lastGeneratedPromptTranscriptCount
    this.lastAnswerCompletedAt = prepared.lastAnswerCompletedAt
    this.currentSessionStartTime = prepared.startedAt
    this.currentSessionAnswers = [...prepared.currentAnswers]
    this.currentSessionReport = null
    this.lastRequestedQuestion = prepared.lastRequestedQuestion
    this.currentFileContext = prepared.fileContext
    this.currentSessionRecallContext = prepared.sessionRecallContext
    this.lastAnswerRecallContext = prepared.lastAnswerRecallContext
    this.lastAnswerRecallQuestion = prepared.lastAnswerRecallQuestion
    this.lastScreenshotRecallContext = prepared.lastScreenshotRecallContext
    this.lastScreenshotRecallTrigger = prepared.lastScreenshotRecallTrigger
    this.lastRuntimeRecallUpdatedAt = prepared.recallUpdatedAt
    this.currentSessionScreenshots = [...prepared.currentScreenshots]
    this.latestScreenSummary = ''
    this.latestScreenSummaryCapturedAt = undefined
    this.currentSessionFolderName = prepared.sessionFolderName
    this.currentModelSelection = prepared.currentModelSelection
    this.companionRealtimeStatus = 'off'
  }

  applyPreparedSessionStop(prepared: PreparedSessionStopState): void {
    this.isSessionActive = false
    this.isSessionPaused = false
    this.currentSessionRecallContext = prepared.sessionRecallContext
    this.lastAnswerRecallContext = prepared.lastAnswerRecallContext
    this.lastAnswerRecallQuestion = prepared.lastAnswerRecallQuestion
    this.lastScreenshotRecallContext = prepared.lastScreenshotRecallContext
    this.lastScreenshotRecallTrigger = prepared.lastScreenshotRecallTrigger
    this.lastRuntimeRecallUpdatedAt = prepared.recallUpdatedAt
    this.latestScreenSummary = ''
    this.latestScreenSummaryCapturedAt = undefined
    this.currentSessionFolderName = prepared.sessionFolderName
    this.companionRealtimeStatus = 'off'
  }

  clearPersistedSessionBuffers(): void {
    this.currentSessionStartTime = null
    this.currentSessionAnswers = []
    this.currentSessionReport = null
    this.currentSessionScreenshots = []
    this.latestScreenSummary = ''
    this.latestScreenSummaryCapturedAt = undefined
  }

  getCurrentSessionId(): string | undefined {
    return this.currentSessionStartTime ? String(this.currentSessionStartTime) : undefined
  }
}
