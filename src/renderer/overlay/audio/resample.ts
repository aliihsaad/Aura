// Simple linear-interpolation resampler for mono Float32 audio. Sufficient
// for energy-envelope comparisons (not for signal subtraction — if we ever
// do real AEC, replace with a proper polyphase / windowed-sinc resampler).

export function resampleLinearMono(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input.slice()
  if (input.length === 0) return new Float32Array(0)
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = srcPos - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}
