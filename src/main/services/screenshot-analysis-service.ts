import {
  EventRecord,
  ModelSelectionInfo,
  ProfileContext,
  ScreenshotCapturedEventPayload,
  SessionContext,
} from '@shared/types'
import { MemoryPipelineService } from './memory/memory-pipeline-service'
import { ScreenCaptureService } from './screen-capture'
import { LLMService } from './llm-service'
import { buildLlmRouting } from './llm-routing-factory'

interface CaptureAndPersistOptions {
  isSessionActive: boolean
  sessionFolderName: string
  getCurrentSessionId: () => string | undefined
  saveScreenshot: (folderName: string, imageBase64: string) => string
  onScreenshotSaved?: (filename: string) => void
}

interface AnalyzeScreenshotOptions {
  openrouterKey: string
  llmService: LLMService | null
  modelSelection: ModelSelectionInfo
  imageBase64: string
  profile: ProfileContext
  sessionCtx?: SessionContext
  recallContext?: string
  answerLanguage?: string
  question?: string
  onChunk: (fullAnswer: string) => void
  onDone: (answer: string) => void
  onError: (error: Error) => void
}

export class ScreenshotAnalysisService {
  constructor(
    private readonly screenCapture: ScreenCaptureService,
    private readonly memoryPipeline: MemoryPipelineService
  ) {}

  async captureAndPersistScreenshot(
    options: CaptureAndPersistOptions
  ): Promise<{
    imageBase64: string
    screenshotFilename?: string
    screenshotEvent?: EventRecord<ScreenshotCapturedEventPayload>
  }> {
    const imageBase64 = await this.screenCapture.captureScreen()
    let screenshotFilename: string | undefined

    if (options.isSessionActive && options.sessionFolderName) {
      try {
        screenshotFilename = options.saveScreenshot(options.sessionFolderName, imageBase64)
        options.onScreenshotSaved?.(screenshotFilename)
      } catch (error) {
        console.warn('[Screenshot] Failed to save to disk:', error)
      }
    }

    const screenshotEvent = this.memoryPipeline.recordEvent<ScreenshotCapturedEventPayload>({
      type: 'capture.screenshot',
      source: 'capture',
      sessionId: options.getCurrentSessionId(),
      sessionFolderName: options.sessionFolderName || undefined,
      payload: {
        savedToSession: Boolean(screenshotFilename),
        screenshotFilename,
        analysisRequested: true,
      },
    })

    if (screenshotFilename && options.sessionFolderName) {
      this.memoryPipeline.registerArtifact({
        type: 'screenshot.image',
        sessionId: options.getCurrentSessionId(),
        sessionFolderName: options.sessionFolderName,
        absolutePath: this.memoryPipeline.getSessionArtifactAbsolutePath(options.sessionFolderName, ['screenshots', screenshotFilename]),
        relativePath: this.memoryPipeline.getSessionArtifactRelativePath(options.sessionFolderName, ['screenshots', screenshotFilename]),
        mimeType: 'image/jpeg',
        sourceEventId: screenshotEvent?.id,
        sourceEventType: screenshotEvent?.type,
        metadata: {
          analysisRequested: true,
        },
      })
    }

    return {
      imageBase64,
      screenshotFilename,
      screenshotEvent,
    }
  }

  async analyzeScreenshot(options: AnalyzeScreenshotOptions): Promise<LLMService> {
    const llmService =
      options.llmService ??
      new LLMService(
        options.openrouterKey,
        options.modelSelection.modelId,
        buildLlmRouting(options.openrouterKey, options.modelSelection.modelId, { vision: true })
      )
    llmService.setModel(options.modelSelection.modelId)

    // Snapshot the session-runtime listeners so a screenshot analysis cannot
    // leak its scoped closures onto subsequent answer streams. Without this
    // restore step, the next auto-answer fires this call's onDone with the
    // captured screen-context question, mis-stamping every saved answer
    // until the next screen capture replaces the closure.
    const previousChunk = llmService.listeners('chunk').slice()
    const previousDone = llmService.listeners('done').slice()
    const previousError = llmService.listeners('error').slice()

    const chunkHandler = (_chunk: string, fullAnswer: string) => options.onChunk(fullAnswer)
    const doneHandler = (answer: string) => options.onDone(answer)
    const errorHandler = (error: Error) => options.onError(error)

    llmService.removeAllListeners('chunk')
    llmService.removeAllListeners('done')
    llmService.removeAllListeners('error')

    llmService.on('chunk', chunkHandler)
    llmService.on('done', doneHandler)
    llmService.on('error', errorHandler)

    try {
      await llmService.analyzeScreenshot(
        options.imageBase64,
        options.profile,
        options.sessionCtx,
        options.recallContext,
        options.answerLanguage,
        options.question
      )
    } finally {
      llmService.removeListener('chunk', chunkHandler)
      llmService.removeListener('done', doneHandler)
      llmService.removeListener('error', errorHandler)
      previousChunk.forEach((l) => llmService.on('chunk', l as (...args: any[]) => void))
      previousDone.forEach((l) => llmService.on('done', l as (...args: any[]) => void))
      previousError.forEach((l) => llmService.on('error', l as (...args: any[]) => void))
    }

    return llmService
  }
}
