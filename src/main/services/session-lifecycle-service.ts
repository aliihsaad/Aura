import { AnswerSnapshot, ModelSelectionInfo, SessionContext } from '@shared/types'
import { ContextManager } from './context-manager'
import { buildSessionRecallContext } from './memory/recall-context'
import { RecallService } from './memory/recall-service'

interface PrepareSessionStartOptions {
  sessionCtx?: SessionContext
  defaultModel: string
  noiseTokens: ReadonlySet<string>
}

export interface PreparedSessionStartState {
  fileContext: string
  loadedFiles: string[]
  sessionFolderName: string
  sessionRecallContext: string
  recallUpdatedAt?: number
  startedAt: number
  lastGeneratedQuestion: string
  lastGeneratedPromptTranscriptCount: number
  lastAnswerCompletedAt: number
  currentAnswers: AnswerSnapshot[]
  currentScreenshots: string[]
  lastAnswerRecallContext: string
  lastAnswerRecallQuestion: string
  lastScreenshotRecallContext: string
  lastScreenshotRecallTrigger: string
  lastRequestedQuestion: string
  currentModelSelection: ModelSelectionInfo
}

export interface PreparedSessionStopState {
  stoppedAt: number
  durationSeconds?: number
  sessionRecallContext: string
  lastAnswerRecallContext: string
  lastAnswerRecallQuestion: string
  lastScreenshotRecallContext: string
  lastScreenshotRecallTrigger: string
  recallUpdatedAt?: number
  sessionFolderName: string
}

export class SessionLifecycleService {
  constructor(
    private readonly contextManager: ContextManager,
    private readonly recallService: RecallService
  ) {}

  async prepareSessionStart(options: PrepareSessionStartOptions): Promise<PreparedSessionStartState> {
    const startedAt = Date.now()
    this.applySessionContext(options.sessionCtx)
    const fileCtx = this.contextManager.loadFileContext(
      options.sessionCtx && Object.prototype.hasOwnProperty.call(options.sessionCtx, 'contextFolder')
        ? options.sessionCtx.contextFolder
        : options.sessionCtx?.companyName
    )
    const sessionFolderName = this.buildSessionFolderName(options.sessionCtx, startedAt)
    const sessionRecallContext = await buildSessionRecallContext(options.sessionCtx, {
      recallService: this.recallService,
      sessionFolderName: sessionFolderName || undefined,
      noiseTokens: options.noiseTokens,
    })

    return {
      fileContext: fileCtx.content,
      loadedFiles: fileCtx.files,
      sessionFolderName,
      sessionRecallContext,
      recallUpdatedAt: sessionRecallContext ? Date.now() : undefined,
      startedAt,
      lastGeneratedQuestion: '',
      lastGeneratedPromptTranscriptCount: 0,
      lastAnswerCompletedAt: 0,
      currentAnswers: [],
      currentScreenshots: [],
      lastAnswerRecallContext: '',
      lastAnswerRecallQuestion: '',
      lastScreenshotRecallContext: '',
      lastScreenshotRecallTrigger: '',
      lastRequestedQuestion: '',
      currentModelSelection: {
        modelId: options.defaultModel,
        reason: 'Default model',
      },
    }
  }

  prepareSessionStop(startedAt: number | null): PreparedSessionStopState {
    const stoppedAt = Date.now()

    return {
      stoppedAt,
      durationSeconds: startedAt
        ? Math.max(1, Math.round((stoppedAt - startedAt) / 1000))
        : undefined,
      sessionRecallContext: '',
      lastAnswerRecallContext: '',
      lastAnswerRecallQuestion: '',
      lastScreenshotRecallContext: '',
      lastScreenshotRecallTrigger: '',
      recallUpdatedAt: undefined,
      sessionFolderName: '',
    }
  }

  private applySessionContext(sessionCtx?: SessionContext): void {
    if (sessionCtx) {
      this.contextManager.setSessionContext(sessionCtx)
      return
    }

    this.contextManager.clearSessionContext()
  }

  private buildSessionFolderName(sessionCtx: SessionContext | undefined, startedAt: number): string {
    return this.contextManager.buildSessionFolderName({
      startedAt,
      sessionIntent: sessionCtx?.sessionIntent,
      companyName: sessionCtx?.companyName,
      roleName: sessionCtx?.roleName,
      subject: sessionCtx?.subject,
    })
  }
}
