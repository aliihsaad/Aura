import type {
  AgentMode,
  AgentPresenceState,
  AppConfig,
  CompanionRealtimeStatus,
  ToolCallRequest,
  ToolExecutorFn,
  TranscriptEntry,
} from '@shared/types'

import type { AudioCaptureService } from '../audio/capture'
import {
  FreeLlmApiRealtimeClient,
  type FreeLlmApiRealtimeClientEvent,
  type FreeLlmApiRealtimeClientOptions,
} from '../services/realtime/freellmapi-realtime-client'
import { LLMService } from '../services/llm-service'
import type { SessionRuntimeStore } from '../services/session-runtime-store'

import { sanitizeRealtimeAssistantOutput } from './companion-realtime-output'
import {
  BasePipeline,
  type PipelineStartContext,
  type PipelineState,
  type PipelineStopReason,
} from './pipeline'

type AudioDataEvent = {
  source: 'system' | 'user'
  chunk: Buffer
}

type RealtimeTranscriptOptions = {
  suppressHeartbeat?: boolean
}

export interface CompanionRealtimePipelineDeps {
  clientOptions: () => FreeLlmApiRealtimeClientOptions
  openrouterApiKey: string
  defaultModel: string
  audioCapture: AudioCaptureService
  sessionRuntimeStore: SessionRuntimeStore
  onTranscript: (entry: TranscriptEntry, options?: RealtimeTranscriptOptions) => void
  emitVoiceAudioChunk: (payload: { pcmBase64: string; mimeType: string }) => void
  emitVoiceAudioEnd: () => void
  setPresenceState: (state: AgentPresenceState) => void
  onRealtimeStatus: (status: CompanionRealtimeStatus) => void
  onRealtimeError: (error: Error) => void
  executeToolCall: () => ToolExecutorFn
  onAnswerChunk: (fullAnswer: string) => void
  onAnswerDone: (answer: string) => void
  onAnswerError: (error: Error) => void
  playRealtimeAudio?: boolean
  onCompanionTextStart?: () => void
  onCompanionTextToken?: (fullText: string, delta: string) => void
  onCompanionTextEnd?: (fullText: string) => void
}

export class CompanionRealtimePipeline extends BasePipeline {
  readonly mode: AgentMode = 'companion'

  private client: FreeLlmApiRealtimeClient | null = null
  private presence: AgentPresenceState = 'idle'
  private busy = false
  private realtimeStatus: CompanionRealtimeStatus = 'off'
  private audioListenerAttached = false
  private preserveFailedStatusOnFatalStop = false
  private lastReportedError: Error | null = null
  private transcriptSequence = 0
  private terminalCleanupInProgress = false
  private assistantTextBuffer = ''
  private assistantTextStarted = false
  private toolCallQueue: Promise<void> = Promise.resolve()

  private readonly handleAudioData = ({ source, chunk }: AudioDataEvent): void => {
    if (source !== 'user') return
    this.client?.sendAudioChunk(chunk)
  }

  private readonly handleClientEvent = (event: FreeLlmApiRealtimeClientEvent): void => {
    switch (event.type) {
      case 'status':
        if (event.status === 'connecting') {
          this.setRealtimeStatus('connecting')
          this.setPresence('thinking')
        } else if (event.status === 'live') {
          this.setRealtimeStatus('live')
          this.busy = false
          this.setPresence('listening')
        } else if (event.status === 'failed') {
          this.setRealtimeStatus('failed')
          this.busy = false
          this.setPresence('idle')
        } else if (event.status === 'stopped') {
          this.handleTerminalRealtimeEvent('stopped')
        }
        break
      case 'audio':
        if (this.deps.playRealtimeAudio !== false) {
          this.busy = true
          this.setPresence('speaking')
          this.deps.emitVoiceAudioChunk({
            pcmBase64: event.chunk.data,
            mimeType: event.chunk.mimeType,
          })
        }
        break
      case 'input-transcript':
        this.emitRealtimeTranscript({
          text: event.text,
          speaker: 'user',
          audioSource: 'microphone',
          suppressHeartbeat: true,
        })
        break
      case 'output-transcript':
        {
          const cleanedText = sanitizeRealtimeAssistantOutput(event.text)
          if (!cleanedText) return

          this.mergeAssistantTranscript(cleanedText)
        }
        break
      case 'text':
        {
          const cleanedText = sanitizeRealtimeAssistantOutput(event.text)
          if (!cleanedText) return

          this.appendAssistantText(cleanedText)
        }
        break
      case 'tool-call':
        this.queueRealtimeToolCalls(event.calls)
        break
      case 'turn-complete':
        this.busy = false
        this.finishAssistantTextTurn()
        this.setPresence('listening')
        this.deps.emitVoiceAudioEnd()
        break
      case 'error':
        // realtime failure after connect does not auto-switch; the session stops or the user restarts in Classic.
        this.handleTerminalRealtimeEvent('failed', event.error)
        break
    }
  }

  constructor(private readonly deps: CompanionRealtimePipelineDeps) {
    super()
  }

  async start(_ctx: PipelineStartContext): Promise<void> {
    const d = this.deps
    this.preserveFailedStatusOnFatalStop = false
    this.lastReportedError = null
    this.setRealtimeStatus('connecting')
    this.setPresence('thinking')
    d.sessionRuntimeStore.llmService?.abort()
    d.sessionRuntimeStore.llmService?.removeAllListeners()
    d.sessionRuntimeStore.llmService = null
    if (d.openrouterApiKey) {
      const llmService = new LLMService(d.openrouterApiKey, d.defaultModel)
      this.attachLlmListeners(llmService)
      d.sessionRuntimeStore.llmService = llmService
    }

    const client = new FreeLlmApiRealtimeClient(d.clientOptions())
    this.client = client
    client.on('event', this.handleClientEvent)

    try {
      await client.connect()
      this.attachAudioListener()
      this.deps.audioCapture.startCapture()
      this.busy = false
      this.setPresence('listening')
    } catch (error) {
      const normalized = toError(error)
      this.removeAudioListener()
      if (this.deps.audioCapture.getIsCapturing()) {
        this.deps.audioCapture.stopCapture()
      }
      this.cleanupClient(client)
      this.preserveFailedStatusOnFatalStop = true
      this.busy = false
      this.setRealtimeStatus('failed')
      this.setPresence('idle')
      if (this.lastReportedError !== normalized) {
        this.reportRealtimeError(normalized)
      }
      throw normalized
    }
  }

  async stop(reason: PipelineStopReason): Promise<void> {
    const preserveFailed =
      reason === 'fatal' &&
      this.preserveFailedStatusOnFatalStop &&
      this.realtimeStatus === 'failed'
    this.preserveFailedStatusOnFatalStop = false

    this.removeAudioListener()
    this.deps.audioCapture.stopCapture()

    const client = this.client
    if (client) {
      this.cleanupClient(client)
    }

    this.deps.emitVoiceAudioEnd()
    this.deps.sessionRuntimeStore.llmService?.abort()
    this.deps.sessionRuntimeStore.llmService?.removeAllListeners()
    this.resetAssistantTextTurn()
    this.busy = false
    this.setPresence('idle')
    if (!preserveFailed) {
      this.setRealtimeStatus('stopped')
    }
  }

  override onSettingsChanged(_diff: Partial<AppConfig>): void {
    /* Realtime settings are picked up on the next Companion session start. */
  }

  getState(): PipelineState {
    return {
      mode: this.mode,
      presence: this.presence,
      busy: this.busy,
      companionRealtimeStatus: this.realtimeStatus,
    }
  }

  private attachAudioListener(): void {
    if (this.audioListenerAttached) return
    this.deps.audioCapture.on('audio-data', this.handleAudioData)
    this.audioListenerAttached = true
  }

  private removeAudioListener(): void {
    if (!this.audioListenerAttached) return
    this.deps.audioCapture.off('audio-data', this.handleAudioData)
    this.audioListenerAttached = false
  }

  private attachLlmListeners(llmService: LLMService): void {
    llmService.removeAllListeners()
    llmService.on('chunk', (_chunk: string, fullAnswer: string) => {
      this.deps.onAnswerChunk(fullAnswer)
    })
    llmService.on('done', (answer: string) => {
      this.deps.onAnswerDone(answer)
    })
    llmService.on('error', (error: Error) => {
      this.deps.onAnswerError(error)
    })
  }

  private cleanupClient(client: FreeLlmApiRealtimeClient): void {
    client.off('event', this.handleClientEvent)
    try {
      client.endAudioStream()
    } catch {
      /* ignore stream-end races during shutdown */
    }
    try {
      client.stop()
    } catch {
      /* ignore stop races during shutdown */
    }
    if (this.client === client) {
      this.client = null
    }
  }

  private setPresence(state: AgentPresenceState): void {
    if (this.presence === state) return
    this.presence = state
    this.deps.setPresenceState(state)
  }

  private setRealtimeStatus(status: CompanionRealtimeStatus): void {
    if (this.realtimeStatus === status) return
    this.realtimeStatus = status
    this.deps.sessionRuntimeStore.companionRealtimeStatus = status
    this.deps.onRealtimeStatus(status)
  }

  private reportRealtimeError(error: Error): void {
    this.lastReportedError = error
    this.deps.onRealtimeError(error)
  }

  private handleTerminalRealtimeEvent(status: 'failed' | 'stopped', error?: Error): void {
    if (this.terminalCleanupInProgress) return
    this.terminalCleanupInProgress = true
    try {
      this.removeAudioListener()
      if (this.deps.audioCapture.getIsCapturing()) {
        this.deps.audioCapture.stopCapture()
      }

      const client = this.client
      if (client) {
        this.cleanupClient(client)
      }

      this.deps.emitVoiceAudioEnd()
      this.resetAssistantTextTurn()
      this.busy = false
      this.setPresence('idle')
      this.setRealtimeStatus(status)
      if (error) this.reportRealtimeError(error)
    } finally {
      this.terminalCleanupInProgress = false
    }
  }

  private emitRealtimeTranscript(
    entry: {
      text: string
      speaker: TranscriptEntry['speaker']
      source?: TranscriptEntry['source']
      audioSource: NonNullable<TranscriptEntry['audioSource']>
      suppressHeartbeat?: boolean
    }
  ): void {
    const trimmed = entry.text.trim()
    if (!trimmed) return

    const timestamp = Date.now()
    this.transcriptSequence += 1
    this.deps.onTranscript({
      id: `rt-${timestamp}-${this.transcriptSequence}`,
      text: trimmed,
      speaker: entry.speaker,
      timestamp,
      isFinal: true,
      source: entry.source ?? 'stt',
      audioSource: entry.audioSource,
    }, entry.suppressHeartbeat ? { suppressHeartbeat: true } : undefined)
  }

  private appendAssistantText(delta: string): void {
    if (!delta.trim()) return
    this.assistantTextBuffer += delta
    if (!this.assistantTextStarted) {
      this.assistantTextStarted = true
      this.deps.onCompanionTextStart?.()
    }
    this.deps.onCompanionTextToken?.(this.assistantTextBuffer, delta)
  }

  private mergeAssistantTranscript(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return

    let nextText = trimmed
    if (this.assistantTextBuffer) {
      const current = this.assistantTextBuffer.trim()
      if (trimmed === current || current.includes(trimmed)) return
      nextText = trimmed.startsWith(current) ? trimmed : `${current} ${trimmed}`
    }

    const delta = this.assistantTextBuffer
      ? nextText.slice(this.assistantTextBuffer.length)
      : nextText
    this.assistantTextBuffer = nextText
    if (!this.assistantTextStarted) {
      this.assistantTextStarted = true
      this.deps.onCompanionTextStart?.()
    }
    this.deps.onCompanionTextToken?.(this.assistantTextBuffer, delta)
  }

  private finishAssistantTextTurn(): void {
    const text = this.assistantTextBuffer.trim()
    if (this.assistantTextStarted) {
      this.deps.onCompanionTextEnd?.(text)
    }
    this.resetAssistantTextTurn()
  }

  private resetAssistantTextTurn(): void {
    this.assistantTextBuffer = ''
    this.assistantTextStarted = false
  }

  private queueRealtimeToolCalls(calls: ToolCallRequest[]): void {
    if (calls.length === 0) return
    console.log(
      `[CompanionRealtime] tool-call: ${calls.map((call) => call.function.name).join(', ')}`
    )
    this.toolCallQueue = this.toolCallQueue
      .then(() => this.executeRealtimeToolCalls(calls))
      .catch((error) => this.reportRealtimeError(toError(error)))
  }

  private async executeRealtimeToolCalls(calls: ToolCallRequest[]): Promise<void> {
    const client = this.client
    if (!client) return

    this.busy = true
    this.setPresence('thinking')
    const executor = this.deps.executeToolCall()
    const responses = []

    for (const call of calls) {
      const name = call.function.name
      const args = parseToolArguments(call.function.arguments)
      const result = await executor(name, args)
      responses.push({
        id: call.id,
        name,
        result,
      })
    }

    if (this.client !== client) return
    client.sendToolResponses(responses)
    if (this.realtimeStatus === 'live') {
      this.setPresence('listening')
      this.busy = false
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function parseToolArguments(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
  } catch {
    // Gemini Live should send JSON args; malformed args fall back to an
    // empty object so the executor can return a normal tool error.
  }
  return {}
}
