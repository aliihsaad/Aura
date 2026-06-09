import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import type { ModelPackStore } from './model-pack-store'

export type LocalAiModelPackProvider = 'whisper-local'

export interface LocalAiModelPackFile {
  url: string
  path: string
  bytes?: number
  sha256?: string
  sha1?: string
  platforms?: readonly NodeJS.Platform[]
  extract?: {
    type: 'zip'
    to: string
  }
}

export interface LocalAiModelPackDownloadSource {
  source: string
  license: string
  files: readonly LocalAiModelPackFile[]
}

export const LOCAL_AI_MODEL_PACKS = {
  'whisper-tiny-q5_1-cpp': {
    id: 'whisper-tiny-q5_1-cpp',
    label: 'Whisper tiny Q5_1',
    provider: 'whisper-local',
    estimatedBytes: 72 * 1024 * 1024,
    download: {
      source: 'https://github.com/ggml-org/whisper.cpp',
      license: 'MIT',
      files: [
        {
          url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip',
          path: '.archives/whisper-bin-x64.zip',
          bytes: 4078768,
          sha256: '74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e',
          platforms: ['win32'],
          extract: {
            type: 'zip',
            to: 'runtime',
          },
        },
        {
          url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin',
          path: 'ggml-tiny-q5_1.bin',
          sha1: '2827a03e495b1ed3048ef28a6a4620537db4ee51',
        },
      ],
    },
  },
} as const

export type LocalAiModelPackId = keyof typeof LOCAL_AI_MODEL_PACKS
export type LocalAiModelPackInfo = typeof LOCAL_AI_MODEL_PACKS[LocalAiModelPackId]

export interface ModelPackInstallProgress {
  phase: 'downloading' | 'verifying' | 'installing' | 'installed' | 'failed'
  downloadedBytes: number
  totalBytes?: number
  file?: string
  error?: string
}

interface DownloadModelPackOptions {
  modelPackStore: ModelPackStore
  signal?: AbortSignal
  onProgress?: (progress: ModelPackInstallProgress) => void
}

export function isLocalAiModelPackId(value: unknown): value is LocalAiModelPackId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCAL_AI_MODEL_PACKS, value)
}

export function modelPackForProvider(provider: string): LocalAiModelPackInfo | null {
  switch (provider) {
    case 'whisper-local':
      return LOCAL_AI_MODEL_PACKS['whisper-tiny-q5_1-cpp']
    default:
      return isLocalAiModelPackId(provider) ? LOCAL_AI_MODEL_PACKS[provider] : null
  }
}

export function getModelPackDownloadSource(id: LocalAiModelPackId): LocalAiModelPackDownloadSource | null {
  const pack = LOCAL_AI_MODEL_PACKS[id] as LocalAiModelPackInfo
  return 'download' in pack ? pack.download : null
}

export async function downloadModelPack(
  id: LocalAiModelPackId,
  options: DownloadModelPackOptions
): Promise<{ bytes: number; path: string }> {
  const pack = LOCAL_AI_MODEL_PACKS[id]
  const source = getModelPackDownloadSource(id)
  if (!source) {
    throw new Error(`Download source for ${pack.label} is not configured yet`)
  }

  const files = source.files.filter((file) => !file.platforms || file.platforms.includes(process.platform))
  const totalBytes = files.every((file) => typeof file.bytes === 'number')
    ? files.reduce((sum, file) => sum + (file.bytes ?? 0), 0)
    : undefined
  const tmpRoot = options.modelPackStore.resolveInsideRoot('.downloads', `${id}-${Date.now()}`)
  const packPath = options.modelPackStore.getPackPath(id)
  let downloadedBytes = 0

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    fs.mkdirSync(tmpRoot, { recursive: true })

    for (const file of files) {
      assertSafeRelativePath(file.path)
      const targetPath = options.modelPackStore.resolveInsideRoot(
        '.downloads',
        path.basename(tmpRoot),
        ...file.path.split(/[\\/]+/)
      )
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })

      options.onProgress?.({
        phase: 'downloading',
        downloadedBytes,
        totalBytes,
        file: file.path,
      })
      await downloadFile(file, targetPath, options.signal, (delta) => {
        downloadedBytes += delta
        options.onProgress?.({
          phase: 'downloading',
          downloadedBytes,
          totalBytes,
          file: file.path,
        })
      })

      options.onProgress?.({
        phase: 'verifying',
        downloadedBytes,
        totalBytes,
        file: file.path,
      })

      if (file.extract) {
        assertSafeRelativePath(file.extract.to)
        const extractPath = options.modelPackStore.resolveInsideRoot(
          '.downloads',
          path.basename(tmpRoot),
          ...file.extract.to.split(/[\\/]+/)
        )
        options.onProgress?.({
          phase: 'installing',
          downloadedBytes,
          totalBytes,
          file: file.path,
        })
        await extractArchive(file.extract.type, targetPath, extractPath)
      }
    }

    options.onProgress?.({ phase: 'installing', downloadedBytes, totalBytes })
    fs.rmSync(packPath, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(packPath), { recursive: true })
    fs.renameSync(tmpRoot, packPath)

    fs.writeFileSync(
      path.join(packPath, 'pack-info.json'),
      JSON.stringify({
        id,
        label: pack.label,
        provider: pack.provider,
        source: source.source,
        license: source.license,
        installedAt: new Date().toISOString(),
        files: files.map((file) => ({
          path: file.path,
          bytes: file.bytes,
          sha256: file.sha256,
          sha1: file.sha1,
        })),
      }, null, 2),
      'utf8'
    )
    const installedBytes = directoryBytes(packPath)
    options.modelPackStore.registerInstalledPack(id, installedBytes)
    options.onProgress?.({
      phase: 'installed',
      downloadedBytes: installedBytes,
      totalBytes: installedBytes,
    })
    return { bytes: installedBytes, path: packPath }
  } catch (error) {
    options.onProgress?.({
      phase: 'failed',
      downloadedBytes,
      totalBytes,
      error: error instanceof Error ? error.message : String(error),
    })
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    throw error
  }
}

async function downloadFile(
  file: LocalAiModelPackFile,
  targetPath: string,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void
): Promise<number> {
  const response = await fetch(file.url, { signal })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${file.path}: HTTP ${response.status}`)
  }

  const hash = createHash('sha256')
  let bytes = 0
  const writeStream = fs.createWriteStream(targetPath)

  for await (const chunk of Readable.fromWeb(response.body as any)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    hash.update(buffer)
    onBytes(buffer.length)
    if (!writeStream.write(buffer)) {
      await new Promise((resolve) => writeStream.once('drain', resolve))
    }
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end((error?: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })

  if (file.bytes && bytes !== file.bytes) {
    throw new Error(`Downloaded size mismatch for ${file.path}: expected ${file.bytes}, got ${bytes}`)
  }

  const actualSha256 = file.sha256 ? hash.digest('hex') : ''
  if (file.sha256) {
    if (actualSha256 !== file.sha256) {
      throw new Error(`Checksum mismatch for ${file.path}`)
    }
  }

  if (file.sha1) {
    const actualSha1 = createHash('sha1').update(fs.readFileSync(targetPath)).digest('hex')
    if (actualSha1 !== file.sha1) {
      throw new Error(`Checksum mismatch for ${file.path}`)
    }
  }

  return bytes
}

function directoryBytes(root: string): number {
  let total = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) total += directoryBytes(fullPath)
    else if (entry.isFile()) total += fs.statSync(fullPath).size
  }
  return total
}

function assertSafeRelativePath(value: string): void {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) {
    throw new Error(`Unsafe model-pack file path: ${value}`)
  }
}

function extractArchive(type: 'zip', archivePath: string, targetPath: string): Promise<void> {
  fs.rmSync(targetPath, { recursive: true, force: true })
  fs.mkdirSync(targetPath, { recursive: true })

  if (type === 'zip' && process.platform === 'win32') {
    return runProcess('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }',
      archivePath,
      targetPath,
    ])
  }

  throw new Error(`Archive extraction for ${type} is not supported on ${process.platform}`)
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let errorText = ''
    child.stderr.on('data', (chunk) => {
      errorText += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else reject(new Error(errorText.trim() || `${command} exited with code ${code}`))
    })
  })
}
