// Fixed-capacity circular FIFO for Float32 audio samples. Drops oldest on
// overflow. Designed for the render-reference path, where losing stale
// samples is fine; do not use it for audio streaming where gaps would be
// audible.

export class Float32RingBuffer {
  private readonly buffer: Float32Array
  private writeIdx = 0
  private filled = 0

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be positive')
    this.buffer = new Float32Array(capacity)
  }

  get size(): number {
    return this.filled
  }

  push(samples: Float32Array): void {
    const n = samples.length
    if (n === 0) return
    if (n >= this.capacity) {
      // Only the last `capacity` samples survive.
      this.buffer.set(samples.subarray(n - this.capacity))
      this.writeIdx = 0
      this.filled = this.capacity
      return
    }
    const firstChunk = Math.min(n, this.capacity - this.writeIdx)
    this.buffer.set(samples.subarray(0, firstChunk), this.writeIdx)
    const remaining = n - firstChunk
    if (remaining > 0) {
      this.buffer.set(samples.subarray(firstChunk), 0)
    }
    this.writeIdx = (this.writeIdx + n) % this.capacity
    this.filled = Math.min(this.capacity, this.filled + n)
  }

  // Read the most recent `count` samples into `out`. Pads with 0 if the buffer
  // is not yet filled enough. Lets the caller align a "most-recent-N-ms"
  // window of reference audio against a just-captured mic frame.
  readMostRecent(count: number, out: Float32Array): void {
    if (out.length < count) throw new Error('out too small')
    const haveSamples = Math.min(count, this.filled)
    const padding = count - haveSamples
    if (padding > 0) out.fill(0, 0, padding)
    const start = (this.writeIdx - haveSamples + this.capacity) % this.capacity
    const firstChunk = Math.min(haveSamples, this.capacity - start)
    out.set(this.buffer.subarray(start, start + firstChunk), padding)
    const remaining = haveSamples - firstChunk
    if (remaining > 0) {
      out.set(this.buffer.subarray(0, remaining), padding + firstChunk)
    }
  }

  clear(): void {
    this.writeIdx = 0
    this.filled = 0
    this.buffer.fill(0)
  }
}
