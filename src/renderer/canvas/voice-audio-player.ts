// Plays queued PCM chunks from companion voice TTS (24 kHz mono, 16-bit LE) through
// a single AudioContext. Each chunk is scheduled back-to-back so there are no
// gaps between buffers during a turn.

const SAMPLE_RATE = 24000

function parseSampleRate(mimeType: string, fallback: number): number {
  const match = /rate=(\d+)/i.exec(mimeType)
  if (!match) return fallback
  const rate = Number.parseInt(match[1], 10)
  return Number.isFinite(rate) && rate > 0 ? rate : fallback
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const out = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true)
    out[i] = int16 / 0x8000
  }
  return out
}

export class VoiceAudioPlayer {
  private ctx: AudioContext | null = null
  private nextPlaybackTime = 0
  private activeSources = new Set<AudioBufferSourceNode>()
  private playbackActive = false

  constructor(
    private readonly onPlaybackStateChange?: (active: boolean) => void
  ) {}

  private setPlaybackActive(active: boolean): void {
    if (this.playbackActive === active) return
    this.playbackActive = active
    this.onPlaybackStateChange?.(active)
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      })
      this.nextPlaybackTime = 0
      console.log('[VoiceAudio] created AudioContext, state=' + this.ctx.state)
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(
        () => console.log('[VoiceAudio] AudioContext resumed'),
        (err) => console.error('[VoiceAudio] resume failed:', err)
      )
    }
    return this.ctx
  }

  enqueue(pcmBase64: string, mimeType: string): void {
    const ctx = this.ensureContext()
    const bytes = base64ToUint8(pcmBase64)
    if (bytes.byteLength < 2) return
    const samples = pcm16ToFloat32(bytes)
    const rate = parseSampleRate(mimeType, SAMPLE_RATE)
    const buffer = ctx.createBuffer(1, samples.length, rate)
    buffer.getChannelData(0).set(samples)

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    this.activeSources.add(src)
    this.setPlaybackActive(true)
    src.onended = () => {
      this.activeSources.delete(src)
      try {
        src.disconnect()
      } catch {
        // ignore
      }
      if (this.activeSources.size === 0) {
        this.setPlaybackActive(false)
      }
    }

    const startAt = Math.max(this.nextPlaybackTime, ctx.currentTime)
    src.start(startAt)
    this.nextPlaybackTime = startAt + buffer.duration
  }

  endTurn(): void {
    if (!this.ctx) return
    this.nextPlaybackTime = Math.max(this.nextPlaybackTime, this.ctx.currentTime)
  }

  interrupt(): void {
    if (!this.ctx) return
    for (const src of this.activeSources) {
      try {
        src.stop(0)
      } catch {
        // ignore sources that already ended
      }
      try {
        src.disconnect()
      } catch {
        // ignore
      }
    }
    this.activeSources.clear()
    this.nextPlaybackTime = this.ctx.currentTime
    this.setPlaybackActive(false)
  }

  stop(): void {
    this.interrupt()
    if (!this.ctx) return
    try {
      void this.ctx.close()
    } catch {
      // ignore
    }
    this.ctx = null
    this.nextPlaybackTime = 0
  }
}
