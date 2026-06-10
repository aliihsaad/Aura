import { EventEmitter } from 'events'
import { DEFAULT_FREELLMAPI_BASE_URL } from '@shared/constants'
import {
  RealtimeAudioChunk,
  RealtimeToolResponse,
  createRealtimeAudioInputMessage,
  createRealtimeAudioStreamEndMessage,
  createRealtimeToolResponseMessage,
  createRealtimeSetupMessage,
  summarizeRealtimeServerMessage,
} from './realtime-message-utils'
import type { ToolCallRequest, ToolDefinition } from '@shared/types'

export type FreeLlmApiRealtimeStatus = 'connecting' | 'live' | 'failed' | 'stopped'

export type FreeLlmApiRealtimeClientEvent =
  | { type: 'status'; status: FreeLlmApiRealtimeStatus }
  | { type: 'audio'; chunk: RealtimeAudioChunk }
  | { type: 'input-transcript'; text: string }
  | { type: 'output-transcript'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; calls: ToolCallRequest[] }
  | { type: 'turn-complete' }
  | { type: 'error'; error: Error }

export interface FreeLlmApiRealtimeClientOptions {
  baseUrl?: string
  apiKey: string
  model?: string
  voice?: string
  instructions?: string
  inputAudioTranscription?: boolean
  outputAudioTranscription?: boolean
  responseModalities?: string[]
  tools?: ToolDefinition[]
  /**
   * Called right before a reconnect after a live socket drop (FreeLLMAPI
   * rotates models mid-session when a rate limit hits — the replacement
   * model starts with zero context). The returned condensed session
   * summary is injected as a system-context prefix into the new
   * connection's instructions. Return '' to reconnect without injection
   * (e.g. early in a session when the brain has no summary yet).
   */
  getReconnectContext?: () => string
}

interface RealtimeSessionResponse {
  connectUrl: string
  model?: string
  config?: RealtimeSessionConfig
}

interface RealtimeSessionConfig {
  responseModalities?: string[]
  inputAudioTranscription?: boolean
  outputAudioTranscription?: boolean
  instructions?: string
  temperature?: number
}

interface SocketMessageEvent {
  data: unknown
}

interface SocketCloseEvent {
  code?: number
  reason?: string
}

interface RealtimeWebSocket {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: SocketMessageEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: SocketCloseEvent) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

type RealtimeWebSocketConstructor = new (url: string) => RealtimeWebSocket
type JsonRecord = Record<string, unknown>

const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
// Exponential backoff for reconnects after a live drop. Pattern adapted from
// Mark-XXXIX's screen_processor session loop (2s start, ×1.5, 30s cap), with
// a quicker first retry since a voice session is latency-sensitive.
const MAX_LIVE_RECONNECT_ATTEMPTS = 8
const LIVE_RECONNECT_BASE_DELAY_MS = 1000
const LIVE_RECONNECT_BACKOFF_FACTOR = 1.5
const LIVE_RECONNECT_MAX_DELAY_MS = 30_000

export class FreeLlmApiRealtimeClient extends EventEmitter {
  private socket: RealtimeWebSocket | null = null
  private status: FreeLlmApiRealtimeStatus = 'stopped'
  private connectPromise: Promise<void> | null = null
  private mintController: AbortController | null = null
  private connectionGeneration = 0
  private stopRequested = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  // Session-context snippet injected into the next connection's instructions.
  // Set when reconnecting after a live drop; cleared once that connection is live.
  private reconnectContext = ''

  constructor(private readonly options: FreeLlmApiRealtimeClientOptions) {
    super()
  }

  async connect(): Promise<void> {
    if (this.status === 'live') return
    if (this.connectPromise) return this.connectPromise

    this.stopRequested = false
    this.clearReconnectTimer()
    this.reconnectAttempts = 0
    const generation = ++this.connectionGeneration
    const controller = new AbortController()
    this.mintController = controller
    this.setStatus('connecting')

    const promise = this.connectInternal(generation, controller)
    this.connectPromise = promise
    try {
      await promise
    } finally {
      if (this.connectPromise === promise) {
        this.connectPromise = null
      }
      if (this.mintController === controller) {
        this.mintController = null
      }
    }
  }

  sendAudioChunk(chunk: Buffer): void {
    const socket = this.socket
    if (!isSocketOpen(socket)) return

    const data = chunk.toString('base64')
    socket.send(JSON.stringify(createRealtimeAudioInputMessage(data, 16000)))
  }

  endAudioStream(): void {
    const socket = this.socket
    if (!isSocketOpen(socket)) return

    socket.send(JSON.stringify(createRealtimeAudioStreamEndMessage()))
  }

  sendToolResponses(responses: RealtimeToolResponse[]): void {
    const socket = this.socket
    if (!isSocketOpen(socket) || responses.length === 0) return

    socket.send(JSON.stringify(createRealtimeToolResponseMessage(responses)))
  }

  stop(): void {
    this.stopRequested = true
    this.clearReconnectTimer()
    this.connectionGeneration++
    this.mintController?.abort()
    this.mintController = null
    this.connectPromise = null

    const socket = this.socket
    this.socket = null

    if (socket && (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)) {
      try {
        socket.close()
      } catch {
        // Ignore close races during shutdown.
      }
    }

    if (this.status !== 'stopped') {
      this.setStatus('stopped')
    }
  }

  private async connectInternal(generation: number, controller: AbortController): Promise<void> {
    try {
      const session = await this.mintSession(controller)
      if (!this.isCurrentGeneration(generation) || this.stopRequested) {
        throw new Error('Realtime connection stopped')
      }
      await this.openSocket(session, generation)
    } catch (error) {
      const inactive = !this.isCurrentGeneration(generation) || this.stopRequested
      const normalized = inactive
        ? new Error('Realtime connection stopped')
        : toError(error)
      if (!inactive && this.status === 'connecting') {
        this.setStatus('failed')
        this.emitEvent({ type: 'error', error: normalized })
      }
      throw normalized
    }
  }

  private async mintSession(controller: AbortController): Promise<RealtimeSessionResponse> {
    const apiKey = cleanValue(this.options.apiKey)
    if (!apiKey) {
      throw new Error('FreeLLMAPI API key missing')
    }

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/realtime/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cleanValue(this.options.model) || 'auto',
        voice: this.wantsAudioOutput()
          ? cleanValue(this.options.voice) || 'alloy'
          : undefined,
        response_modalities: this.requestedResponseModalities(),
        input_audio_transcription: Boolean(this.options.inputAudioTranscription),
        output_audio_transcription:
          this.wantsAudioOutput() ? Boolean(this.options.outputAudioTranscription) : undefined,
        instructions: this.effectiveInstructions() || undefined,
        tools: this.options.tools,
      }),
      signal: controller.signal,
    })

    const responseText = await response.text()
    const responseBody = parseJson(responseText)

    if (!response.ok) {
      const message = responseErrorMessage(responseBody) || truncate(responseText.trim(), 320)
      throw new Error(
        `FreeLLMAPI realtime session error ${response.status}${message ? `: ${message}` : ''}`
      )
    }

    const body = asRecord(responseBody)
    const connectUrl = firstCleanString(
      getValue(body, 'connect_url'),
      getValue(body, 'connectUrl'),
      getValue(body, 'url')
    )
    if (!connectUrl) {
      throw new Error('FreeLLMAPI realtime session response missing connect_url')
    }

    const config = parseSessionConfig(body)

    return {
      connectUrl,
      model: firstCleanString(getValue(body, 'model'), getValue(config.record, 'model')) || undefined,
      config: config.value,
    }
  }

  private openSocket(session: RealtimeSessionResponse, generation: number): Promise<void> {
    const WebSocketConstructor = getWebSocketConstructor()

    return new Promise((resolve, reject) => {
      const socket = new WebSocketConstructor(session.connectUrl)
      this.socket = socket
      let connectSettled = false
      let live = false

      const rejectBeforeLive = (error: Error, emitFailure: boolean): void => {
        if (connectSettled) return
        connectSettled = true
        closeSocket(socket)
        const shouldEmitFailure =
          emitFailure && this.isCurrentGeneration(generation) && !this.stopRequested
        if (this.socket === socket) {
          this.socket = null
        }
        if (shouldEmitFailure) {
          this.setStatus('failed')
          this.emitEvent({ type: 'error', error })
        }
        reject(error)
      }

      socket.onopen = () => {
        if (!this.isActiveSocket(generation, socket)) {
          rejectBeforeLive(new Error('Realtime connection stopped'), false)
          return
        }

        try {
          socket.send(
            JSON.stringify(
              createRealtimeSetupMessage(this.resolveSessionSetupOptions(session))
            )
          )
        } catch (error) {
          const normalized = toError(error)
          rejectBeforeLive(normalized, true)
        }
      }

      socket.onmessage = (event) => {
        if (!this.isActiveSocket(generation, socket)) return
        void this.handleSocketMessage(event.data, {
          generation,
          socket,
          isActive: () => this.isActiveSocket(generation, socket),
          live: () => live,
          markLive: () => {
            if (!this.isActiveSocket(generation, socket)) return
            live = true
            this.reconnectAttempts = 0
            this.reconnectContext = ''
            this.setStatus('live')
            if (!connectSettled) {
              connectSettled = true
              resolve()
            }
          },
          failBeforeLive: rejectBeforeLive,
        })
      }

      socket.onerror = (event) => {
        if (!this.isActiveSocket(generation, socket)) return
        const error = socketEventError(event, 'FreeLLMAPI realtime WebSocket error')
        if (!live) {
          rejectBeforeLive(error, true)
          return
        }
        if (!this.isActiveSocket(generation, socket)) return
        this.emitEvent({ type: 'error', error })
      }

      socket.onclose = (event) => {
        const activeAtClose = this.isActiveSocket(generation, socket)
        const manualStop = this.stopRequested || !this.isCurrentGeneration(generation) || !activeAtClose
        if (this.socket === socket) {
          this.socket = null
        }

        if (!live) {
          rejectBeforeLive(socketCloseError(event), activeAtClose && !manualStop)
          return
        }

        live = false
        if (activeAtClose && !manualStop && this.status === 'live') {
          this.scheduleReconnectAfterLiveClose(generation, socketCloseError(event))
        }
      }
    })
  }

  private resolveSessionSetupOptions(
    session: RealtimeSessionResponse
  ): Parameters<typeof createRealtimeSetupMessage>[0] {
    if (session.config) {
      const responseModalities = session.config.responseModalities ?? this.requestedResponseModalities()
      const wantsAudioOutput = modalitiesIncludeAudio(responseModalities)
      return {
        model: cleanValue(session.model) || cleanValue(this.options.model) || 'auto',
        voice: wantsAudioOutput ? cleanValue(this.options.voice) || 'alloy' : undefined,
        responseModalities: session.config.responseModalities ?? this.requestedResponseModalities(),
        temperature: session.config.temperature,
        instructions: this.withReconnectContext(
          cleanValue(session.config.instructions) || cleanValue(this.options.instructions)
        ) || undefined,
        tools: this.options.tools,
        inputAudioTranscription:
          session.config.inputAudioTranscription ?? Boolean(this.options.inputAudioTranscription),
        outputAudioTranscription:
          wantsAudioOutput
            ? session.config.outputAudioTranscription ?? Boolean(this.options.outputAudioTranscription)
            : undefined,
      }
    }

    const responseModalities = this.requestedResponseModalities()
    const wantsAudioOutput = modalitiesIncludeAudio(responseModalities)
    return {
      model: cleanValue(session.model) || cleanValue(this.options.model) || 'auto',
      voice: wantsAudioOutput ? cleanValue(this.options.voice) || 'alloy' : undefined,
      responseModalities,
      instructions: this.effectiveInstructions() || undefined,
      tools: this.options.tools,
      inputAudioTranscription: Boolean(this.options.inputAudioTranscription),
      outputAudioTranscription:
        wantsAudioOutput ? Boolean(this.options.outputAudioTranscription) : undefined,
    }
  }

  private requestedResponseModalities(): string[] {
    return this.options.responseModalities?.length
      ? this.options.responseModalities
      : ['AUDIO']
  }

  private wantsAudioOutput(): boolean {
    return modalitiesIncludeAudio(this.requestedResponseModalities())
  }

  private async handleSocketMessage(
    data: unknown,
    connection: {
      generation: number
      socket: RealtimeWebSocket
      isActive: () => boolean
      live: () => boolean
      markLive: () => void
      failBeforeLive: (error: Error, emitFailure: boolean) => void
    }
  ): Promise<void> {
    try {
      if (!connection.isActive()) return
      const messageText = await decodeSocketData(data)
      if (!connection.isActive()) return
      const message = JSON.parse(messageText) as unknown
      const summary = summarizeRealtimeServerMessage(message)
      if (!connection.isActive()) return

      if (summary.setupComplete && !connection.live()) {
        if (!connection.isActive()) return
        connection.markLive()
      }

      if (summary.inputTranscription && connection.isActive()) {
        this.emitEvent({ type: 'input-transcript', text: summary.inputTranscription })
      }
      if (summary.outputTranscription && connection.isActive()) {
        this.emitEvent({ type: 'output-transcript', text: summary.outputTranscription })
      }
      if (summary.text && connection.isActive()) {
        this.emitEvent({ type: 'text', text: summary.text })
      }
      if (summary.toolCalls.length > 0 && connection.isActive()) {
        this.emitEvent({ type: 'tool-call', calls: summary.toolCalls })
      }
      for (const chunk of summary.audioChunks) {
        if (!connection.isActive()) return
        this.emitEvent({ type: 'audio', chunk })
      }
      if (summary.turnComplete && connection.isActive()) {
        this.emitEvent({ type: 'turn-complete' })
      }
    } catch (error) {
      const normalized = toError(error)
      if (!connection.isActive()) return
      if (!connection.live()) {
        connection.failBeforeLive(normalized, true)
        return
      }
      this.emitEvent({ type: 'error', error: normalized })
    }
  }

  private setStatus(status: FreeLlmApiRealtimeStatus): void {
    if (this.status === status) return
    this.status = status
    this.emitEvent({ type: 'status', status })
  }

  private emitEvent(event: FreeLlmApiRealtimeClientEvent): void {
    this.emit('event', event)
  }

  private scheduleReconnectAfterLiveClose(generation: number, error: Error): void {
    if (!this.isCurrentGeneration(generation) || this.stopRequested) return

    if (this.reconnectAttempts >= MAX_LIVE_RECONNECT_ATTEMPTS) {
      const exhausted = new Error(
        `${error.message}; reconnect attempts exhausted`
      )
      this.setStatus('failed')
      this.emitEvent({ type: 'error', error: exhausted })
      return
    }

    this.reconnectAttempts += 1
    const attempt = this.reconnectAttempts
    const delayMs = Math.min(
      LIVE_RECONNECT_BASE_DELAY_MS * Math.pow(LIVE_RECONNECT_BACKOFF_FACTOR, attempt - 1),
      LIVE_RECONNECT_MAX_DELAY_MS
    )
    console.warn(
      `[CompanionRealtime] FreeLLMAPI realtime WebSocket closed; reconnecting in ${Math.round(delayMs)}ms (${attempt}/${MAX_LIVE_RECONNECT_ATTEMPTS}): ${error.message}`
    )
    this.setStatus('connecting')
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnectAfterLiveClose()
    }, delayMs)
  }

  private async reconnectAfterLiveClose(): Promise<void> {
    if (this.stopRequested) return

    // A live drop usually means FreeLLMAPI rotated to a fresh model that has
    // no memory of this session. Capture the session-brain summary so the new
    // connection's instructions carry the conversation context across.
    try {
      this.reconnectContext = cleanValue(this.options.getReconnectContext?.())
    } catch (error) {
      console.warn('[CompanionRealtime] reconnect context unavailable:', toError(error).message)
      this.reconnectContext = ''
    }
    if (this.reconnectContext) {
      console.log('[CompanionRealtime] injecting session-brain summary into reconnect handshake')
    }

    const generation = ++this.connectionGeneration
    const controller = new AbortController()
    this.mintController = controller

    try {
      await this.connectInternal(generation, controller)
    } catch {
      // connectInternal reports the failure when it belongs to the live client.
    } finally {
      if (this.mintController === controller) {
        this.mintController = null
      }
    }
  }

  /** Base instructions plus the reconnect context prefix when one is pending. */
  private effectiveInstructions(): string {
    return this.withReconnectContext(cleanValue(this.options.instructions))
  }

  private withReconnectContext(baseInstructions: string): string {
    if (!this.reconnectContext) return baseInstructions
    const contextBlock = [
      '## Restored Session Context',
      'The previous realtime connection dropped mid-session (likely a model rotation).',
      'This is a condensed summary of the session so far — continue seamlessly, do not greet the user again or restart the conversation:',
      '',
      this.reconnectContext,
    ].join('\n')
    return baseInstructions ? `${baseInstructions}\n\n${contextBlock}` : contextBlock
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.connectionGeneration
  }

  private isActiveSocket(generation: number, socket: RealtimeWebSocket): boolean {
    return this.isCurrentGeneration(generation) && !this.stopRequested && this.socket === socket
  }
}

export async function decodeSocketData(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  }
  if (isArrayBufferBlob(data)) {
    return Buffer.from(await data.arrayBuffer()).toString('utf8')
  }
  return String(data)
}

function getWebSocketConstructor(): RealtimeWebSocketConstructor {
  const websocketGlobal = globalThis as unknown as {
    WebSocket?: RealtimeWebSocketConstructor
  }
  if (!websocketGlobal.WebSocket) {
    throw new Error('WebSocket is not available in this runtime')
  }
  return websocketGlobal.WebSocket
}

function normalizeBaseUrl(value: string | undefined): string {
  const fallback = DEFAULT_FREELLMAPI_BASE_URL.replace(/\/+$/, '')
  const base = cleanValue(value) || fallback
  return base.replace(/\/+$/, '') || fallback
}

function isSocketOpen(socket: RealtimeWebSocket | null): socket is RealtimeWebSocket {
  return Boolean(socket && socket.readyState === SOCKET_OPEN)
}

function closeSocket(socket: RealtimeWebSocket): void {
  if (socket.readyState !== SOCKET_CONNECTING && socket.readyState !== SOCKET_OPEN) return
  try {
    socket.close()
  } catch {
    // Ignore close races.
  }
}

function parseJson(value: string): unknown {
  if (!value.trim()) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function responseErrorMessage(body: unknown): string {
  if (typeof body === 'string') return body.trim()
  const record = asRecord(body)
  const errorRecord = asRecord(getValue(record, 'error'))
  return firstCleanString(
    getValue(errorRecord, 'message'),
    getValue(errorRecord, 'detail'),
    getValue(record, 'message'),
    getValue(record, 'error')
  )
}

function parseSessionConfig(body: JsonRecord | null): {
  record: JsonRecord | null
  value?: RealtimeSessionConfig
} {
  const record =
    asRecord(getValue(body, 'config')) ||
    asRecord(getValue(body, 'session_config')) ||
    asRecord(getValue(body, 'sessionConfig'))

  const responseModalities = stringArray(
    getFirstValue(record, 'response_modalities', 'responseModalities')
  )
  const inputAudioTranscription = optionalBoolean(
    getFirstValue(record, 'input_audio_transcription', 'inputAudioTranscription')
  )
  const outputAudioTranscription = optionalBoolean(
    getFirstValue(record, 'output_audio_transcription', 'outputAudioTranscription')
  )
  const instructions = firstCleanString(
    getValue(record, 'instructions'),
    getFirstValue(record, 'system_instruction', 'systemInstruction'),
    getValue(body, 'instructions')
  )
  const temperature = optionalNumber(getValue(record, 'temperature'))

  const value: RealtimeSessionConfig = {}
  if (responseModalities) value.responseModalities = responseModalities
  if (inputAudioTranscription !== undefined) value.inputAudioTranscription = inputAudioTranscription
  if (outputAudioTranscription !== undefined) value.outputAudioTranscription = outputAudioTranscription
  if (instructions) value.instructions = instructions
  if (temperature !== undefined) value.temperature = temperature

  return {
    record,
    value: Object.keys(value).length > 0 ? value : undefined,
  }
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value
    .map((item) => cleanValue(item))
    .filter((item) => item.length > 0)
  return strings.length > 0 ? strings : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function modalitiesIncludeAudio(modalities: string[]): boolean {
  return modalities.some((item) => item.toUpperCase() === 'AUDIO')
}

function socketEventError(event: unknown, fallback: string): Error {
  if (event instanceof Error) return event
  const record = asRecord(event)
  const nested = asRecord(getValue(record, 'error'))
  const message = firstCleanString(
    getValue(record, 'message'),
    getValue(nested, 'message'),
    getValue(nested, 'reason')
  )
  return new Error(message || fallback)
}

function socketCloseError(event: SocketCloseEvent): Error {
  const reason = cleanValue(event.reason)
  const code = typeof event.code === 'number' ? event.code : undefined
  if (reason && code) return new Error(`FreeLLMAPI realtime WebSocket closed ${code}: ${reason}`)
  if (reason) return new Error(`FreeLLMAPI realtime WebSocket closed: ${reason}`)
  if (code) return new Error(`FreeLLMAPI realtime WebSocket closed ${code}`)
  return new Error('FreeLLMAPI realtime WebSocket closed before setup completed')
}

function isArrayBufferBlob(value: unknown): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function firstCleanString(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanValue(value)
    if (cleaned) return cleaned
  }
  return ''
}

function cleanValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function getValue(record: JsonRecord | null, key: string): unknown {
  if (!record) return undefined
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

function getFirstValue(record: JsonRecord | null, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = getValue(record, key)
    if (value !== undefined) return value
  }
  return undefined
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}
