import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import {
  ParsedProfileMd,
  parseProfileMd,
} from '@shared/profile-md'

/**
 * profile.md storage layer (I/O only). All parsing/rendering lives in
 * `@shared/profile-md` and stays Electron-free so the merger can be tested
 * from a Node script.
 */

export {
  parseProfileMd,
  renderProfileMd,
  findSection,
  getAgentContent,
} from '@shared/profile-md'
export type {
  ParsedProfileMd,
  ProfileMdSection,
  ProfileMdSpan,
} from '@shared/profile-md'

export function profileMdPath(): string {
  return path.join(app.getPath('userData'), 'profile', 'profile.md')
}

export function voiceMdPath(): string {
  return path.join(app.getPath('userData'), 'profile', 'voice.md')
}

/** Read profile.md from disk. Returns empty parsed shape if the file is missing. */
export function readProfileMd(): ParsedProfileMd {
  const file = profileMdPath()
  if (!fs.existsSync(file)) {
    return { sections: [] }
  }
  const raw = fs.readFileSync(file, 'utf-8')
  return parseProfileMd(raw)
}

/** Read profile.md as raw markdown, or empty string if missing. */
export function readProfileMdRaw(): string {
  return readMdRaw(profileMdPath())
}

/** Read voice.md as raw markdown, or empty string if missing. */
export function readVoiceMdRaw(): string {
  return readMdRaw(voiceMdPath())
}

/**
 * Atomic write — temp file + rename. Mirrors the `atomic-write` helper used
 * by session-brain state.
 */
export function writeProfileMd(content: string): void {
  writeMdAtomic(profileMdPath(), content)
}

export function writeVoiceMd(content: string): void {
  writeMdAtomic(voiceMdPath(), content)
}

function readMdRaw(file: string): string {
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf-8')
}

function writeMdAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, file)
}
