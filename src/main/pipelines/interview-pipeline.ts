/**
 * InterviewPipeline — Phase 1 of the mode-isolation refactor.
 *
 * Owns the interview-mode session runtime: dual STT (interviewer + mic),
 * the per-session LLM service, audio capture wiring, and the listener
 * bindings that funnel transcript / answer events back into the
 * answer-generation logic that still lives in ipc-handlers.
 *
 * For now the answer-generation closures (transcript fanout, auto-answer
 * trigger, manual-answer dispatch, answer streaming) are passed in as
 * deps. Subsequent phase-1 work moves more of those bodies into the
 * pipeline; this commit deliberately keeps the surface small so we can
 * verify lifecycle isolation in production before touching answer flow.
 */

import type {
  AgentMode,
  AgentPresenceState,
  AppConfig,
  TranscriptEntry,
} from '@shared/types'

import type { AudioCaptureService } from '../audio/capture'
import { LLMService } from '../services/llm-service'
import type { SessionRuntimeService } from '../services/session-runtime-service'
import type { SessionRuntimeStore } from '../services/session-runtime-store'
import { STTService } from '../services/stt-service'

import {
  BasePipeline,
  type PipelineStartContext,
  type PipelineState,
  type PipelineStopReason,
} from './pipeline'

export interface InterviewPipelineDeps {
  // ── Per-session inputs ────────────────────────────────────
  createSttService: (speaker: 'interviewer' | 'user', language: string, keyterms: string[]) => STTService
  openrouterApiKey: string
  defaultModel: string
  sttLanguage: string
  micEnabled: boolean
  utteranceDebounceMs: number
  shouldAutoTriggerFromMic: boolean
  keyterms: string[]

  // ── Singletons (injected, not imported) ───────────────────
  sessionRuntimeStore: SessionRuntimeStore
  sessionRuntimeService: SessionRuntimeService
  audioCapture: AudioCaptureService

  // ── Bindings owned by ipc-handlers for now ────────────────
  onTranscript: (entry: TranscriptEntry) => void
  onAutoAnswerTrigger: () => void
  onAudioChunk: (source: 'interviewer' | 'user', chunk: Buffer) => void
  onAnswerChunk: (fullAnswer: string) => void
  onAnswerDone: (answer: string) => void
  onAnswerError: (error: Error) => void
}

export class InterviewPipeline extends BasePipeline {
  readonly mode: AgentMode = 'interview'

  private presence: AgentPresenceState = 'idle'
  private busy = false

  constructor(private readonly deps: InterviewPipelineDeps) {
    super()
  }

  async start(_ctx: PipelineStartContext): Promise<void> {
    const d = this.deps
    const store = d.sessionRuntimeStore

    store.sttService = d.createSttService('interviewer', d.sttLanguage, d.keyterms)
    store.micSttService = d.micEnabled
      ? d.createSttService('user', d.sttLanguage, d.keyterms)
      : null
    store.llmService = new LLMService(d.openrouterApiKey, d.defaultModel)

    d.sessionRuntimeService.clearPendingGeneration()

    d.sessionRuntimeService.bindSessionRuntime({
      interviewerSttService: store.sttService,
      micSttService: store.micSttService,
      llmService: store.llmService,
      audioCapture: d.audioCapture,
      utteranceDebounceMs: d.utteranceDebounceMs,
      onTranscript: d.onTranscript,
      onAutoAnswerTrigger: d.onAutoAnswerTrigger,
      shouldAutoTriggerFromMic: d.shouldAutoTriggerFromMic,
      onAudioChunk: d.onAudioChunk,
      onAnswerChunk: d.onAnswerChunk,
      onAnswerDone: d.onAnswerDone,
      onAnswerError: d.onAnswerError,
    })

    await store.sttService.connect()
    await store.micSttService?.connect()
    d.audioCapture.startCapture()

    this.presence = 'listening'
  }

  async stop(_reason: PipelineStopReason): Promise<void> {
    const d = this.deps
    const store = d.sessionRuntimeStore

    d.sessionRuntimeService.clearPendingGeneration()
    d.audioCapture.stopCapture()
    d.audioCapture.removeAllListeners('audio-data')

    await store.sttService?.disconnect()
    await store.micSttService?.disconnect()
    store.llmService?.abort()

    this.presence = 'idle'
    this.busy = false
  }

  // ── Event hooks ──────────────────────────────────────────
  // Phase 1 keeps the interview answer pipeline in ipc-handlers; the
  // injected callbacks above already plumb transcript / utterance-end
  // events into it. The on* methods below are wired but currently a
  // no-op so the BasePipeline contract is honored. Subsequent phase-1
  // commits move maybeGenerateAnswer / runManualAnswer bodies in here.

  override onTranscriptInterim(_entry: TranscriptEntry): void {
    /* handled via the bound STT listeners until later phase-1 commits */
  }

  override onTranscriptFinal(_entry: TranscriptEntry): void {
    /* handled via the bound STT listeners until later phase-1 commits */
  }

  override onSettingsChanged(_diff: Partial<AppConfig>): void {
    /* language reconnect still lives in ipc-handlers SET_CONFIG */
  }

  getState(): PipelineState {
    return {
      mode: this.mode,
      presence: this.presence,
      busy: this.busy,
    }
  }
}
