import { EventEmitter } from 'events'

/**
 * System audio capture using WASAPI loopback on Windows.
 *
 * This captures the audio output of the system (what the interviewer says)
 * so it can be sent to Deepgram for real-time transcription.
 *
 * Implementation options (in priority order):
 * 1. electron-audio-loopback (npm package, wraps WASAPI)
 * 2. native C++ addon using WASAPI loopback
 * 3. Virtual audio cable fallback
 *
 * For now, we use Electron's desktopCapturer with getUserMedia as a
 * cross-platform fallback that works without native addons.
 */
export class AudioCaptureService extends EventEmitter {
  private mediaRecorder: any = null
  private audioContext: any = null
  private isCapturing = false

  /**
   * Start capturing system audio.
   * Called from the renderer process via IPC since getUserMedia
   * requires a renderer context. The renderer sends audio chunks
   * back to main process via IPC.
   */
  startCapture(): void {
    this.isCapturing = true
    this.emit('started')
    console.log('[Audio] Capture started — waiting for audio chunks from renderer')
  }

  /**
   * Process an audio chunk received from the renderer process.
   * The renderer captures audio via desktopCapturer + AudioWorklet
   * and sends PCM chunks to main via IPC.
   */
  processAudioChunk(source: 'interviewer' | 'user', chunk: Buffer): void {
    if (!this.isCapturing) return
    this.emit('audio-data', { source, chunk })
  }

  stopCapture(): void {
    this.isCapturing = false
    this.emit('stopped')
    console.log('[Audio] Capture stopped')
  }

  getIsCapturing(): boolean {
    return this.isCapturing
  }
}
