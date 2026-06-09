import {
  AnswerSnapshot,
  InterviewType,
  LLMRequest,
  SessionContext,
  TranscriptEntry,
  UserContext,
} from '@shared/types'
import {
  countFinalPromptEntries,
  getLatestQuestionCandidate,
  normalizeQuestion,
  prepareQuestionForAnswer,
  shouldGenerateForAutoPrompt,
} from './answer-prep-service'
import { LLMService } from './llm-service'
import { MemoryPipelineService } from './memory/memory-pipeline-service'
import { buildAnswerRecallContext } from './memory/recall-context'
import { RecallService } from './memory/recall-service'

interface SharedAnswerRequestOptions {
  llmService: LLMService | null
  sessionTranscript: TranscriptEntry[]
  answerHistory: AnswerSnapshot[]
  userContext: UserContext
  sessionContext?: SessionContext
  interviewType: InterviewType
  fileContext?: string
  answerLanguage?: string
  baseRecallContext?: string
  sessionFolderName?: string
  noiseTokens: ReadonlySet<string>
}

interface BuildAutoAnswerRequestOptions extends SharedAnswerRequestOptions {
  lastGeneratedPromptTranscriptCount: number
}

interface BuildManualAnswerRequestOptions extends SharedAnswerRequestOptions {
  question: string
  memoryPipeline: MemoryPipelineService
  sessionId?: string
}

export interface PreparedAnswerRequest {
  request: LLMRequest
  preparedQuestion: string
  normalizedQuestion: string
  promptTranscriptCount: number
  recallContext: string
}

export class AnswerRequestService {
  constructor(private readonly recallService: RecallService) {}

  async buildAutoAnswerRequest(
    options: BuildAutoAnswerRequestOptions
  ): Promise<PreparedAnswerRequest | null> {
    const rawQuestion = getLatestQuestionCandidate(
      options.sessionTranscript,
      options.lastGeneratedPromptTranscriptCount,
      false,
      options.sessionContext?.sessionIntent || 'interview'
    )
    const sessionIntent = options.sessionContext?.sessionIntent || 'interview'
    if (!rawQuestion || !shouldGenerateForAutoPrompt(rawQuestion, sessionIntent)) {
      return null
    }

    const preparedQuestion = await prepareQuestionForAnswer(
      rawQuestion,
      options.llmService,
      options.sessionTranscript,
      sessionIntent
    )
    if (!preparedQuestion || !shouldGenerateForAutoPrompt(preparedQuestion, sessionIntent)) {
      return null
    }

    const normalizedQuestion = normalizeQuestion(preparedQuestion)
    const promptTranscriptCount = countFinalPromptEntries(
      options.sessionTranscript,
      options.sessionContext?.sessionIntent || 'interview'
    )

    return await this.buildPreparedAnswerRequest(
      preparedQuestion,
      normalizedQuestion,
      promptTranscriptCount,
      options
    )
  }

  async buildManualAnswerRequest(
    options: BuildManualAnswerRequestOptions
  ): Promise<PreparedAnswerRequest | null> {
    const preparedQuestion = await prepareQuestionForAnswer(
      options.question,
      options.llmService,
      options.sessionTranscript,
      options.sessionContext?.sessionIntent || 'interview'
    )
    if (!preparedQuestion) {
      return null
    }

    options.memoryPipeline.recordEvent({
      type: 'input.manual-requested',
      source: 'user',
      sessionId: options.sessionId,
      sessionFolderName: options.sessionFolderName,
      payload: {
        question: options.question,
        preparedQuestion,
      },
    })

    const promptTranscriptCount = countFinalPromptEntries(
      options.sessionTranscript,
      options.sessionContext?.sessionIntent || 'interview'
    )

    return await this.buildPreparedAnswerRequest(
      preparedQuestion,
      normalizeQuestion(preparedQuestion),
      promptTranscriptCount,
      options
    )
  }

  private async buildPreparedAnswerRequest(
    preparedQuestion: string,
    normalizedQuestion: string,
    promptTranscriptCount: number,
    options: SharedAnswerRequestOptions
  ): Promise<PreparedAnswerRequest> {
    const recallContext = await buildAnswerRecallContext(preparedQuestion, options.sessionContext, {
      recallService: this.recallService,
      sessionFolderName: options.sessionFolderName,
      noiseTokens: options.noiseTokens,
      baseRecallContext: options.baseRecallContext,
    })

    return {
      preparedQuestion,
      normalizedQuestion,
      promptTranscriptCount,
      recallContext,
      request: {
        question: preparedQuestion,
        conversationHistory: options.sessionTranscript,
        answerHistory: options.answerHistory,
        userContext: options.userContext,
        interviewType: options.interviewType,
        fileContext: options.fileContext,
        recallContext,
        answerLanguage: options.answerLanguage,
      },
    }
  }
}
