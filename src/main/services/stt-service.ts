import { DeepgramClient } from '@deepgram/sdk'
import { EventEmitter } from 'events'
import { DEEPGRAM_CONFIG } from '@shared/constants'
import { TranscriptAudioSource, TranscriptEntry } from '@shared/types'

export class STTService extends EventEmitter {
  private connection: any = null
  private isConnected = false
  private isClosing = false
  private apiKey: string
  private speaker: 'system' | 'user'
  private audioSource: TranscriptAudioSource
  private language: string
  private keyterms: string[]

  constructor(apiKey: string, speaker: 'system' | 'user', language: string = 'en', keyterms: string[] = []) {
    super()
    this.apiKey = apiKey
    this.speaker = speaker
    this.audioSource = speaker === 'user' ? 'microphone' : 'system'
    this.language = language
    this.keyterms = keyterms
  }

  async connect(): Promise<void> {
    if (this.isConnected) return
    this.isClosing = false

    const client = new DeepgramClient({ apiKey: this.apiKey })

    // v5 SDK: listen.v1.connect() returns a Promise<Socket>
    // Nova-3 supports `keyterm` (array of strings); older models silently ignore it.
    const connectOpts: Record<string, unknown> = {
      model: DEEPGRAM_CONFIG.model,
      language: this.language,
      smart_format: DEEPGRAM_CONFIG.smart_format,
      punctuate: DEEPGRAM_CONFIG.punctuate,
      interim_results: DEEPGRAM_CONFIG.interim_results,
      utterance_end_ms: DEEPGRAM_CONFIG.utterance_end_ms,
      vad_events: DEEPGRAM_CONFIG.vad_events,
      encoding: DEEPGRAM_CONFIG.encoding,
      sample_rate: DEEPGRAM_CONFIG.sample_rate,
      channels: DEEPGRAM_CONFIG.channels,
    }
    if (this.keyterms.length > 0) {
      connectOpts.keyterm = this.keyterms
    }
    this.connection = await client.listen.v1.connect(connectOpts as any)

    this.connection.on('open', () => {
      if (this.isClosing) return
      this.isConnected = true
      console.log('[STT] Deepgram connection opened')
      this.emit('connected')
    })

    // v5 SDK: 'message' event fires with parsed JSON data
    this.connection.on('message', (data: any) => {
      // Handle transcript results
      if (data.type === 'Results') {
        const transcript = data.channel?.alternatives?.[0]?.transcript
        if (!transcript || transcript.trim() === '') return

        const entry: TranscriptEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: transcript,
          speaker: this.speaker,
          audioSource: this.audioSource,
          timestamp: Date.now(),
          isFinal: data.is_final ?? false,
        }

        this.emit('transcript', entry)
      }

      // Handle utterance end
      if (data.type === 'UtteranceEnd') {
        this.emit('utterance-end')
      }
    })

    this.connection.on('error', (error: any) => {
      const msg = error?.message ?? String(error) ?? 'unknown'
      console.error('[STT] Deepgram error:', msg)
      // Wrap the emit so we never crash the main process if a downstream
      // listener throws or the EventEmitter has no `error` subscriber. The
      // Deepgram SDK's ReconnectingWebSocket fires synchronous errors from
      // setTimeout callbacks (the TIMEOUT crash); EventEmitter rethrows
      // unhandled `error` events, which would kill the whole app.
      this.isConnected = false
      this.safeEmit('error', error)
      // Distinct event so the runtime can decide between "reconnect" vs
      // "give up". Most callers just listen to 'disconnected'.
      this.safeEmit('disconnected', { reason: 'error', message: msg })
    })

    this.connection.on('close', () => {
      this.isConnected = false
      this.isClosing = false
      console.log('[STT] Deepgram connection closed')
      this.safeEmit('disconnected', { reason: 'close' })
    })

    // The v5 socket object is returned disconnected and must be opened explicitly.
    this.connection.connect()
  }

  sendAudio(audioChunk: Buffer): void {
    const connection = this.connection
    if (!this.isConnected || this.isClosing || !connection) return
    try {
      connection.sendMedia(audioChunk)
    } catch (error: any) {
      const message = error?.message ?? String(error)
      if (/socket is not open/i.test(message)) {
        this.isConnected = false
        return
      }
      console.error('[STT] Failed to send audio:', error)
    }
  }

  async disconnect(): Promise<void> {
    const connection = this.connection
    this.isConnected = false
    this.isClosing = true
    this.connection = null
    if (connection) {
      try {
        connection.close()
      } catch {
        // ignore shutdown errors
      }
    } else {
      this.isClosing = false
    }
  }

  getIsConnected(): boolean {
    return this.isConnected
  }

  /**
   * EventEmitter.emit rethrows unhandled `error` events synchronously. Wrap
   * it so a Deepgram timeout (or any other downstream error) can never take
   * down the whole main process. If there's no listener for the event we
   * just log; the session stays alive.
   */
  private safeEmit(event: string, ...args: any[]): void {
    try {
      if (event === 'error' && this.listenerCount('error') === 0) {
        // No listener — Node would throw. Log and swallow.
        const first = args[0]
        console.warn(
          '[STT] error event had no listener:',
          first?.message ?? String(first) ?? '(no payload)'
        )
        return
      }
      this.emit(event, ...args)
    } catch (err) {
      console.warn(`[STT] listener for '${event}' threw:`, err)
    }
  }
}

// Last-resort process guard — if the Deepgram SDK ever throws a truly
// uncaught error from a timer callback (TIMEOUT path), keep the app alive.
// Better to lose the STT stream than to lose the whole session, the
// answer window, and any unsaved transcript buffer.
if (!(process as any).__auraStttGuardInstalled) {
  ;(process as any).__auraStttGuardInstalled = true
  process.on('uncaughtException', (err: Error) => {
    const msg = err?.message ?? String(err)
    if (/TIMEOUT/i.test(msg) || /\bsocket\b.*\b(closed|not open)\b/i.test(msg)) {
      console.warn('[STT] Swallowed uncaught socket error:', msg)
      return
    }
    // Anything else — re-raise so we don't mask real bugs.
    throw err
  })
}
