export function writePcm16Wav(pcmData: Buffer, sampleRate: number, channels: number): Buffer {
  if (!Buffer.isBuffer(pcmData)) {
    throw new Error('PCM audio data must be a Buffer')
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('WAV sample rate must be a positive integer')
  }
  if (!Number.isInteger(channels) || channels <= 0) {
    throw new Error('WAV channel count must be a positive integer')
  }
  if (pcmData.length % 2 !== 0) {
    throw new Error('PCM audio data must contain whole signed 16-bit samples')
  }

  const bytesPerSample = 2
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const header = Buffer.alloc(44)

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcmData.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bytesPerSample * 8, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcmData.length, 40)

  return Buffer.concat([header, pcmData])
}
