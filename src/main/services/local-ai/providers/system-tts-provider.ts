import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TtsAvailability, TtsChunk, TtsProvider } from './tts-provider'

export class SystemTtsProvider implements TtsProvider {
  readonly id = 'system'
  readonly label = 'System voice'
  private child: ChildProcessWithoutNullStreams | null = null

  async isAvailable(): Promise<TtsAvailability> {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return { ok: true }
    }
    return { ok: false, reason: 'System voice provider is not supported on this platform yet' }
  }

  async speak(text: string, _onChunk: (chunk: TtsChunk) => void): Promise<void> {
    const availability = await this.isAvailable()
    if (!availability.ok) throw new Error(availability.reason)

    if (process.platform === 'win32') {
      await this.speakWithWindowsVoice(text)
      return
    }

    await this.speakWithMacVoice(text)
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
  }

  private speakWithWindowsVoice(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = [
        'Add-Type -AssemblyName System.Speech;',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
        '$s.Speak([Console]::In.ReadToEnd());',
      ].join(' ')
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true }
      )
      this.child = child
      child.stdin.end(text)
      let errorText = ''
      child.stderr.on('data', (chunk) => {
        errorText += String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (this.child === child) this.child = null
        if (code === 0 || code === null) resolve()
        else reject(new Error(errorText.trim() || `System voice exited with code ${code}`))
      })
    })
  }

  private speakWithMacVoice(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('say', [text])
      this.child = child
      let errorText = ''
      child.stderr.on('data', (chunk) => {
        errorText += String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (this.child === child) this.child = null
        if (code === 0 || code === null) resolve()
        else reject(new Error(errorText.trim() || `System voice exited with code ${code}`))
      })
    })
  }
}
