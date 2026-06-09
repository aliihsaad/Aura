import { TranscriptEntry } from '@shared/types'
import { AudioCaptureService } from '../audio/capture'
import { LLMService } from './llm-service'
import { STTService } from './stt-service'

interface BindSessionRuntimeOptions {
  interviewerSttService: STTService
  micSttService: STTService | null
  llmService: LLMService
  audioCapture: AudioCaptureService
  utteranceDebounceMs: number
  onTranscript: (entry: TranscriptEntry) => void
  onAutoAnswerTrigger: () => void
  shouldAutoTriggerFromMic?: boolean
  onAudioChunk: (source: 'interviewer' | 'user', chunk: Buffer) => void
  onAnswerChunk: (fullAnswer: string) => void
  onAnswerDone: (answer: string) => void
  onAnswerError: (error: Error) => void
}

export class SessionRuntimeService {
  private pendingGenerationTimer: NodeJS.Timeout | null = null

  bindSessionRuntime(options: BindSessionRuntimeOptions): void {
    options.interviewerSttService.removeAllListeners()
    options.micSttService?.removeAllListeners()
    options.audioCapture.removeAllListeners('audio-data')
    options.llmService.removeAllListeners()

    this.attachInterviewerSttService(
      options.interviewerSttService,
      options.onTranscript,
      options.utteranceDebounceMs,
      options.onAutoAnswerTrigger
    )
    this.attachMicSttService(
      options.micSttService,
      options.onTranscript,
      options.shouldAutoTriggerFromMic ? options.utteranceDebounceMs : undefined,
      options.shouldAutoTriggerFromMic ? options.onAutoAnswerTrigger : undefined
    )

    options.audioCapture.on('audio-data', ({ source, chunk }: { source: 'interviewer' | 'user'; chunk: Buffer }) => {
      options.onAudioChunk(source, chunk)
    })

    options.llmService.on('chunk', (_chunk: string, fullAnswer: string) => {
      options.onAnswerChunk(fullAnswer)
    })
    options.llmService.on('done', (answer: string) => {
      options.onAnswerDone(answer)
    })
    options.llmService.on('error', (error: Error) => {
      options.onAnswerError(error)
    })
  }

  attachInterviewerSttService(
    service: STTService | null,
    onTranscript: (entry: TranscriptEntry) => void,
    utteranceDebounceMs: number,
    onAutoAnswerTrigger: () => void
  ): void {
    if (!service) return

    service.removeAllListeners()
    this.attachTranscriptListener(service, onTranscript)
    service.on('utterance-end', () => {
      this.clearPendingGeneration()
      this.pendingGenerationTimer = setTimeout(() => {
        onAutoAnswerTrigger()
      }, utteranceDebounceMs)
    })
  }

  attachMicSttService(
    service: STTService | null,
    onTranscript: (entry: TranscriptEntry) => void,
    utteranceDebounceMs?: number,
    onAutoAnswerTrigger?: () => void
  ): void {
    if (!service) return

    service.removeAllListeners()
    this.attachTranscriptListener(service, onTranscript)
    if (utteranceDebounceMs && onAutoAnswerTrigger) {
      service.on('utterance-end', () => {
        this.clearPendingGeneration()
        this.pendingGenerationTimer = setTimeout(() => {
          onAutoAnswerTrigger()
        }, utteranceDebounceMs)
      })
    }
  }

  clearPendingGeneration(): void {
    if (this.pendingGenerationTimer) {
      clearTimeout(this.pendingGenerationTimer)
      this.pendingGenerationTimer = null
    }
  }

  private attachTranscriptListener(
    service: STTService,
    onTranscript: (entry: TranscriptEntry) => void
  ): void {
    service.on('transcript', (entry: TranscriptEntry) => {
      onTranscript(entry)
    })
  }
}
