// RMS amplitude of a Float32 mono buffer, in linear [0, 1] range for typical
// speech samples. Used by the barge-in detector for threshold comparisons.

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    sum += s * s
  }
  return Math.sqrt(sum / samples.length)
}
