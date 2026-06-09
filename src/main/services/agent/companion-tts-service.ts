import { EventEmitter } from 'events'
import { DeepgramClient } from '@deepgram/sdk'

export type CompanionTtsEvent =
  | { type: 'audio-chunk'; pcmBase64: string; mimeType: string }
  | { type: 'audio-end' }
  | { type: 'error'; error: Error }

export interface CompanionTtsOptions {
  apiKey: string
  model?: string
  sampleRate?: number
}

const DEFAULT_MODEL = 'aura-2-thalia-en'
const DEFAULT_SAMPLE_RATE = 24000
const MIN_FLUSH_CHARS = 80
const MAX_FLUSH_CHARS = 180

export class CompanionTtsService extends EventEmitter {
  private client: DeepgramClient
  private apiKey: string
  private model: string
  private sampleRate: number
  private pendingText = ''
  private queue: string[] = []
  private processing = false
  private turnId = 0
  private abortController: AbortController | null = null

  constructor(options: CompanionTtsOptions) {
    super()
    this.apiKey = options.apiKey
    this.model = options.model || DEFAULT_MODEL
    this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE
    this.client = new DeepgramClient({ apiKey: this.apiKey })
  }

  setConfig(options: CompanionTtsOptions): void {
    const nextModel = options.model || DEFAULT_MODEL
    const nextSampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE
    if (
      options.apiKey !== this.apiKey ||
      nextModel !== this.model ||
      nextSampleRate !== this.sampleRate
    ) {
      this.stop()
      this.apiKey = options.apiKey
      this.model = nextModel
      this.sampleRate = nextSampleRate
      this.client = new DeepgramClient({ apiKey: this.apiKey })
    }
  }

  beginTurn(): void {
    this.stop()
    this.turnId++
  }

  enqueueDelta(delta: string): void {
    const cleaned = cleanSpokenText(delta)
    if (!cleaned) return
    this.pendingText += cleaned
    this.flushReadySegments(false)
  }

  endTurn(): void {
    this.flushReadySegments(true)
    void this.drainQueue(this.turnId)
  }

  stop(): void {
    this.turnId++
    this.pendingText = ''
    this.queue = []
    this.processing = false
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.emit('event', { type: 'audio-end' } satisfies CompanionTtsEvent)
  }

  private flushReadySegments(force: boolean): void {
    let next = extractNextSpeakableSegment(this.pendingText, force)
    while (next) {
      this.pendingText = this.pendingText.slice(next.length).trimStart()
      const spoken = cleanSpokenText(next).trim()
      if (spoken) this.queue.push(spoken)
      if (!force && this.queue.join(' ').length > MAX_FLUSH_CHARS) break
      next = extractNextSpeakableSegment(this.pendingText, force)
    }
    void this.drainQueue(this.turnId)
  }

  private async drainQueue(turnId: number): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.queue.length > 0 && turnId === this.turnId) {
        const text = this.queue.shift()
        if (!text) continue
        await this.speakText(text, turnId)
      }
    } finally {
      this.processing = false
      if (turnId === this.turnId && this.queue.length === 0 && !this.pendingText.trim()) {
        this.emit('event', { type: 'audio-end' } satisfies CompanionTtsEvent)
      }
    }
  }

  private async speakText(text: string, turnId: number): Promise<void> {
    if (!text || turnId !== this.turnId) return
    this.abortController = new AbortController()
    try {
      const response = await this.client.speak.v1.audio.generate(
        {
          text,
          model: this.model,
          encoding: 'linear16',
          container: 'none',
          sample_rate: this.sampleRate,
        },
        {
          abortSignal: this.abortController.signal,
          maxRetries: 1,
          timeoutInSeconds: 30,
        }
      )
      if (turnId !== this.turnId) return
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0) return
      this.emit('event', {
        type: 'audio-chunk',
        pcmBase64: buffer.toString('base64'),
        mimeType: `audio/pcm;encoding=signed-integer;bits=16;rate=${this.sampleRate};channels=1`,
      } satisfies CompanionTtsEvent)
    } catch (error: any) {
      // A barge-in / new turn aborts the in-flight speak request. The
      // Deepgram SDK doesn't always surface that as a plain AbortError — it
      // can come back as a wrapped error with status 499 / "Client Closed
      // Request" / "aborted". Treat all of those as a normal cancellation,
      // not an error worth logging.
      const msg = String(error?.message ?? error ?? '')
      if (
        error?.name === 'AbortError' ||
        error?.statusCode === 499 ||
        error?.status === 499 ||
        /aborted|client closed request/i.test(msg)
      ) {
        return
      }
      this.emit('event', {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      } satisfies CompanionTtsEvent)
    } finally {
      if (turnId === this.turnId) {
        this.abortController = null
      }
    }
  }
}

function extractNextSpeakableSegment(text: string, force: boolean): string | null {
  const trimmed = text.trimStart()
  if (!trimmed) return null
  const boundary = trimmed.search(/[.!?]\s+/)
  if (boundary >= 0 && boundary + 1 >= MIN_FLUSH_CHARS) {
    return trimmed.slice(0, boundary + 1)
  }
  if (trimmed.length >= MAX_FLUSH_CHARS) {
    const softBreak = trimmed.lastIndexOf(' ', MAX_FLUSH_CHARS)
    return trimmed.slice(0, softBreak > MIN_FLUSH_CHARS ? softBreak : MAX_FLUSH_CHARS)
  }
  return force ? trimmed : null
}

function cleanSpokenText(text: string): string {
  return text
    .replace(/\[(?:pause|demo|anchor)(?::[^\]]*)?\]/gi, ' ')
    .replace(/[`*_>#~-]/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
}
