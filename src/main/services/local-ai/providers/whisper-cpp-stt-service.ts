import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { TranscriptAudioSource, TranscriptEntry } from '@shared/types'
import type { ModelPackStore } from '../model-pack-store'
import { STTService } from '../../stt-service'
import { writePcm16Wav } from './wav-utils'

const WHISPER_PACK_ID = 'whisper-tiny-q5_1-cpp'
const WHISPER_MODEL_FILE = 'ggml-tiny-q5_1.bin'
const SAMPLE_RATE = 16000
const CHANNELS = 1
const SPEECH_RMS_THRESHOLD = 420
const MIN_SPEECH_MS = 450
const SILENCE_FLUSH_MS = 850
const MAX_SEGMENT_MS = 8000
const MAX_QUEUE = 3

export interface WhisperRuntimeOverride {
  command: string
  argsPrefix?: string[]
  cwd?: string
}

interface WhisperRuntimePaths {
  command: string
  argsPrefix: string[]
  cwd: string
  modelPath: string
}

export class WhisperCppSttService extends STTService {
  private connected = false
  private readonly whisperAudioSource: TranscriptAudioSource
  private child: ChildProcessWithoutNullStreams | null = null
  private chunks: Buffer[] = []
  private segmentMs = 0
  private speechMs = 0
  private silenceMs = 0
  private queue: Buffer[] = []
  private processing = false
  private turnId = 0

  constructor(
    private readonly modelPackStore: ModelPackStore,
    private readonly whisperSpeaker: 'interviewer' | 'user',
    private readonly whisperLanguage: string = 'en',
    _keyterms: string[] = [],
    private readonly runtimeOverride?: WhisperRuntimeOverride
  ) {
    super('local-whisper', whisperSpeaker, whisperLanguage, _keyterms)
    this.whisperAudioSource = this.whisperSpeaker === 'user' ? 'microphone' : 'system'
  }

  override async connect(): Promise<void> {
    const availability = this.resolveRuntime()
    if (!availability.ok) throw new Error(availability.reason)
    this.connected = true
    this.turnId++
    this.emit('connected')
    console.log('[STT] Whisper local connection opened')
  }

  override sendAudio(audioChunk: Buffer): void {
    if (!this.connected || audioChunk.length < 2) return

    const frameMs = Math.round((audioChunk.length / 2 / SAMPLE_RATE) * 1000)
    const rms = pcm16Rms(audioChunk)
    const hasSpeech = rms >= SPEECH_RMS_THRESHOLD

    if (hasSpeech || this.chunks.length > 0) {
      this.chunks.push(Buffer.from(audioChunk))
      this.segmentMs += frameMs
    }

    if (hasSpeech) {
      this.speechMs += frameMs
      this.silenceMs = 0
    } else if (this.chunks.length > 0) {
      this.silenceMs += frameMs
    }

    if (
      this.chunks.length > 0 &&
      (this.silenceMs >= SILENCE_FLUSH_MS || this.segmentMs >= MAX_SEGMENT_MS)
    ) {
      this.flushSegment()
    }
  }

  override async disconnect(): Promise<void> {
    this.connected = false
    this.turnId++
    this.flushSegment()
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    this.chunks = []
    this.queue = []
    this.processing = false
    this.emit('disconnected', { reason: 'close' })
    console.log('[STT] Whisper local connection closed')
  }

  override getIsConnected(): boolean {
    return this.connected
  }

  private flushSegment(): void {
    const audio = Buffer.concat(this.chunks)
    const speechMs = this.speechMs
    this.chunks = []
    this.segmentMs = 0
    this.speechMs = 0
    this.silenceMs = 0

    if (audio.length === 0 || speechMs < MIN_SPEECH_MS) return
    this.queue.push(audio)
    if (this.queue.length > MAX_QUEUE) this.queue.shift()
    void this.drainQueue(this.turnId)
  }

  private async drainQueue(turnId: number): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.queue.length > 0 && this.connected && turnId === this.turnId) {
        const audio = this.queue.shift()
        if (!audio) continue
        const text = await this.transcribe(audio)
        if (!text || !this.connected || turnId !== this.turnId) continue
        const entry: TranscriptEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          speaker: this.whisperSpeaker,
          audioSource: this.whisperAudioSource,
          timestamp: Date.now(),
          isFinal: true,
        }
        this.emit('transcript', entry)
        this.emit('utterance-end')
      }
    } catch (error) {
      console.warn('[STT] Whisper local transcription failed:', error)
    } finally {
      this.processing = false
    }
  }

  private async transcribe(audio: Buffer): Promise<string> {
    const resolved = this.resolveRuntime()
    if (!resolved.ok) throw new Error(resolved.reason)

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whisphry-whisper-'))
    const inputPath = path.join(tmpRoot, 'speech.wav')
    const outputBase = path.join(tmpRoot, 'transcript')
    const outputPath = `${outputBase}.txt`
    try {
      fs.writeFileSync(inputPath, writePcm16Wav(audio, SAMPLE_RATE, CHANNELS))
      await this.runWhisper(resolved.paths, inputPath, outputBase)
      return cleanWhisperText(
        fs.existsSync(outputPath)
          ? fs.readFileSync(outputPath, 'utf8')
          : ''
      )
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  }

  private runWhisper(paths: WhisperRuntimePaths, inputPath: string, outputBase: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        ...paths.argsPrefix,
        '-m',
        paths.modelPath,
        '-f',
        inputPath,
        '-l',
        normalizeWhisperLanguage(this.whisperLanguage),
        '-nt',
        '-np',
        '-otxt',
        '-of',
        outputBase,
      ]
      const child = spawn(paths.command, args, {
        cwd: paths.cwd,
        windowsHide: true,
        env: {
          ...process.env,
          PATH: `${paths.cwd}${path.delimiter}${process.env.PATH || ''}`,
        },
      })
      this.child = child
      let errorText = ''
      child.stderr.on('data', (chunk) => {
        errorText += String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (this.child === child) this.child = null
        if (code === 0 || code === null) resolve()
        else reject(new Error(errorText.trim() || `Whisper exited with code ${code}`))
      })
    })
  }

  private resolveRuntime(): { ok: true; paths: WhisperRuntimePaths } | { ok: false; reason: string } {
    return resolveWhisperRuntime(this.modelPackStore, this.runtimeOverride)
  }
}

export function isWhisperRuntimeInstalled(modelPackStore: ModelPackStore): boolean {
  return resolveWhisperRuntime(modelPackStore).ok
}

function resolveWhisperRuntime(
  modelPackStore: ModelPackStore,
  runtimeOverride?: WhisperRuntimeOverride
): { ok: true; paths: WhisperRuntimePaths } | { ok: false; reason: string } {
  if (!modelPackStore.isInstalled(WHISPER_PACK_ID)) {
    return { ok: false, reason: 'Whisper local model pack is not installed' }
  }

  const packPath = modelPackStore.getPackPath(WHISPER_PACK_ID)
  const modelPath = path.join(packPath, WHISPER_MODEL_FILE)
  if (!fs.existsSync(modelPath)) {
    return { ok: false, reason: 'Whisper model file is missing. Remove and reinstall the Whisper pack.' }
  }

  if (runtimeOverride) {
    return {
      ok: true,
      paths: {
        command: runtimeOverride.command,
        argsPrefix: runtimeOverride.argsPrefix ?? [],
        cwd: runtimeOverride.cwd ?? packPath,
        modelPath,
      },
    }
  }

  const runtimePath = process.platform === 'win32'
    ? path.join(packPath, 'runtime', 'Release', 'whisper-cli.exe')
    : path.join(packPath, 'runtime', 'whisper-cli')
  if (!fs.existsSync(runtimePath)) {
    return {
      ok: false,
      reason: 'Whisper runtime is missing. Remove and reinstall the Whisper pack to download the runtime.',
    }
  }

  return {
    ok: true,
    paths: {
      command: runtimePath,
      argsPrefix: [],
      cwd: path.dirname(runtimePath),
      modelPath,
    },
  }
}

function pcm16Rms(buffer: Buffer): number {
  const samples = Math.floor(buffer.length / 2)
  if (samples === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < samples; i++) {
    const sample = buffer.readInt16LE(i * 2)
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / samples)
}

function cleanWhisperText(raw: string): string {
  return raw
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeWhisperLanguage(language: string): string {
  const normalized = String(language || '').trim().toLowerCase()
  return /^[a-z]{2}$/.test(normalized) ? normalized : 'auto'
}
