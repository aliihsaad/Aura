import { Float32RingBuffer } from './ring-buffer'
import { resampleLinearMono } from './resample'

// ~1 second of 16 kHz audio. Enough window for "is the model currently making
// sound" lookups even under modest jitter between playback and capture.
const CAPACITY_SAMPLES = 16000
const TARGET_RATE = 16000

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

export class RenderReferenceBus {
  private readonly buffer = new Float32RingBuffer(CAPACITY_SAMPLES)
  private playbackActive = false

  ingestChunk(pcmBase64: string, mimeType: string): void {
    const bytes = base64ToUint8(pcmBase64)
    if (bytes.byteLength < 2) return
    const samples = pcm16ToFloat32(bytes)
    const srcRate = parseSampleRate(mimeType, TARGET_RATE)
    const resampled =
      srcRate === TARGET_RATE ? samples : resampleLinearMono(samples, srcRate, TARGET_RATE)
    this.buffer.push(resampled)
    this.playbackActive = true
  }

  onPlaybackEnded(): void {
    this.playbackActive = false
  }

  onInterrupted(): void {
    this.playbackActive = false
    this.buffer.clear()
  }

  isPlaybackActive(): boolean {
    return this.playbackActive
  }

  // Read the most recent `count` 16 kHz samples into `out`. Used for energy
  // comparison against a just-captured mic frame.
  readMostRecent(count: number, out: Float32Array): void {
    this.buffer.readMostRecent(count, out)
  }
}

// Module-level singleton so AudioCapture can push chunks and the
// BargeInDetector can read frames without prop-drilling a shared instance.
let instance: RenderReferenceBus | null = null
export function getRenderReferenceBus(): RenderReferenceBus {
  if (!instance) instance = new RenderReferenceBus()
  return instance
}
