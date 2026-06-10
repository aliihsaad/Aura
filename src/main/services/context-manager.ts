import ElectronStore from 'electron-store'
const Store = (ElectronStore as any).default || ElectronStore
import { ProfileContext, SessionContext, UserContext, SessionRecord, SessionSummary, TranscriptEntry, AnswerSnapshot, SessionReport } from '@shared/types'
import type { BrainSummarySection, StudyNotesSnapshot, SummaryBullet } from '@shared/session-brain-types'
import { getSessionIntentSpec } from '@shared/session-intent-policy'
import { app, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const defaultProfile: ProfileContext = {
  name: '',
  languages: '',
  occupation: '',
  currentFocus: '',
  commsStyle: '',
  extraInstructions: '',
  relationships: '',
}

const store = new Store({
  name: 'whisphry-context',
  defaults: {
    contexts: {} as Record<string, any>,
    activeContextId: 'default',
    profile: defaultProfile,
    lastSessionContext: null as SessionContext | null,
  },
})

const defaultSessionContext: SessionContext = {
  sessionIntent: 'quick-help',
  companyName: '',
  roleName: '',
  subject: '',
  sessionNotes: '',
}

export class ContextManager {
  private sessionContext: SessionContext | null = null

  /** Strip path separators and parent-directory references to prevent path traversal */
  private sanitizeFolderName(folderName: string): string {
    return path.basename(folderName).replace(/\.\./g, '')
  }

  getProfile(): ProfileContext {
    const stored = store.get('profile') as Partial<ProfileContext> | undefined
    return mergeProfileWithDefaults(stored)
  }

  setProfile(profile: ProfileContext): void {
    store.set('profile', mergeProfileWithDefaults(profile))
  }

  getSessionContext(): SessionContext {
    return { ...defaultSessionContext, ...(this.sessionContext || {}) }
  }

  setSessionContext(ctx: SessionContext): void {
    const merged = { ...defaultSessionContext, ...ctx }
    this.sessionContext = merged
    // Persist as last session context for pre-filling next time
    store.set('lastSessionContext', merged)
  }

  clearSessionContext(): void {
    this.sessionContext = null
  }

  getLastSessionContext(): SessionContext {
    const last = store.get('lastSessionContext') as SessionContext | null
    return { ...defaultSessionContext, ...(last || {}) }
  }

  // Flattened legacy view — keeps existing call sites (prompts, llm-service) working.
  // Universal profile fields fold into the flat UserContext shape.
  getContext(): UserContext {
    const profile = this.getProfile()
    const session = this.getSessionContext()
    return {
      extraInstructions: profile.extraInstructions,
      sessionIntent: session.sessionIntent,
      companyName: session.companyName,
      roleName: session.roleName,
      name: profile.name,
      preferredAnswerStyle: profile.commsStyle,
      subject: session.subject,
      sessionNotes: session.sessionNotes,
    }
  }

  // Legacy setContext for backward compat — folds flat legacy fields back into nested schema.
  setContext(context: Partial<UserContext>): void {
    const profile = this.getProfile()
    if (context.extraInstructions !== undefined) profile.extraInstructions = context.extraInstructions
    if (context.name !== undefined) profile.name = context.name
    if (context.preferredAnswerStyle !== undefined) profile.commsStyle = context.preferredAnswerStyle
    this.setProfile(profile)
  }

  // ── File Context System ────────────────────────────────────

  private static readonly MAX_FILE_SIZE = 50 * 1024 // 50KB per file
  private static readonly MAX_TOTAL_CONTEXT = 200 * 1024 // 200KB total
  private static readonly SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.text'])

  getAppDataPath(): string {
    return app.getPath('userData')
  }

  /** Ensure required folder structure exists */
  initFolders(): void {
    const base = this.getAppDataPath()
    const dirs = [
      path.join(base, 'profile'),
      path.join(base, 'context', '_global'),
      path.join(base, 'sessions'),
    ]
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /** List subfolders in context/ (excluding _global) */
  listContextFolders(): string[] {
    const contextDir = path.join(this.getAppDataPath(), 'context')
    if (!fs.existsSync(contextDir)) return []

    return fs
      .readdirSync(contextDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '_global')
      .map((entry) => entry.name)
      .sort()
  }

  /** Load all context files from _global/ and optionally a company folder */
  loadFileContext(company?: string): { content: string; files: string[]; warnings: string[] } {
    const contextDir = path.join(this.getAppDataPath(), 'context')
    const warnings: string[] = []
    const loadedFiles: string[] = []
    let totalSize = 0
    const parts: string[] = []

    const loadFolder = (folderPath: string, label: string): void => {
      if (!fs.existsSync(folderPath)) return

      const files = fs
        .readdirSync(folderPath, { withFileTypes: true })
        .filter((f) => f.isFile() && ContextManager.SUPPORTED_EXTENSIONS.has(path.extname(f.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))

      for (const file of files) {
        const filePath = path.join(folderPath, file.name)
        const stat = fs.statSync(filePath)

        if (stat.size > ContextManager.MAX_FILE_SIZE) {
          warnings.push(`Skipped ${label}/${file.name} (${Math.round(stat.size / 1024)}KB > 50KB limit)`)
          continue
        }

        if (totalSize + stat.size > ContextManager.MAX_TOTAL_CONTEXT) {
          warnings.push(`Skipped ${label}/${file.name} — total context limit (200KB) reached`)
          continue
        }

        const content = fs.readFileSync(filePath, 'utf-8').trim()
        if (content) {
          parts.push(`--- ${label}/${file.name} ---\n${content}`)
          loadedFiles.push(`${label}/${file.name}`)
          totalSize += stat.size
        }
      }
    }

    // Always load _global
    loadFolder(path.join(contextDir, '_global'), '_global')

    // Load company-specific folder if provided
    if (company) {
      const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      if (slug) {
        const companyDir = path.join(contextDir, slug)
        // Auto-create company folder so user can drop files in
        if (!fs.existsSync(companyDir)) {
          fs.mkdirSync(companyDir, { recursive: true })
        }
        loadFolder(companyDir, slug)
      }
    }

    if (warnings.length > 0) {
      console.warn('[FileContext] Warnings:', warnings.join('; '))
    }

    return {
      content: parts.join('\n\n'),
      files: loadedFiles,
      warnings,
    }
  }

  openContextFolder(): void {
    const contextDir = path.join(this.getAppDataPath(), 'context')
    fs.mkdirSync(contextDir, { recursive: true })
    shell.openPath(contextDir)
  }

  openAppDataFolder(): void {
    shell.openPath(this.getAppDataPath())
  }

  // ── Session File System ────────────────────────────────────

  /** Generate a slugified folder name for a session. Used at both session-start
   * (for runtime artifacts like screenshots) and session-save so both land in
   * the same folder. */
  buildSessionFolderName(record: Pick<SessionRecord, 'startedAt' | 'sessionIntent' | 'companyName' | 'roleName' | 'subject'>): string {
    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56)
    const parts = [formatSessionFolderTimestamp(record.startedAt)]
    if (record.subject) parts.push(slugify(record.subject))
    if (record.companyName) parts.push(slugify(record.companyName))
    if (record.roleName) parts.push(slugify(record.roleName))
    if (parts.length === 1 && record.sessionIntent) parts.push(slugify(record.sessionIntent))
    return parts.join('_')
  }

  private sessionFolderName(record: Pick<SessionRecord, 'startedAt' | 'sessionIntent' | 'companyName' | 'roleName' | 'subject'>): string {
    return this.buildSessionFolderName(record)
  }

  /** Path to the per-session brain state folder (subject.json, summary.md, …). */
  brainFolderPath(folderName: string): string {
    folderName = this.sanitizeFolderName(folderName)
    return path.join(this.getAppDataPath(), 'sessions', folderName, 'brain')
  }

  /** Path to the brain's screenshot index + kept JPGs. Sibling of session-level
   * screenshots/ (which holds user-triggered analysis frames). */
  brainScreenshotsFolderPath(folderName: string): string {
    return path.join(this.brainFolderPath(folderName), 'screenshots')
  }

  /** Save a session record to the filesystem */
  saveSession(record: SessionRecord): string {
    const sessionsDir = path.join(this.getAppDataPath(), 'sessions')
    const folderName = this.sessionFolderName(record)
    const sessionDir = path.join(sessionsDir, folderName)
    fs.mkdirSync(sessionDir, { recursive: true })

    // Save session.json
    const sessionFile: SessionRecord & { folderName: string } = { ...record, folderName }
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(sessionFile, null, 2), 'utf-8')

    // Generate transcript.md
    const transcriptMd = this.buildTranscriptMd(record)
    fs.writeFileSync(path.join(sessionDir, 'transcript.md'), transcriptMd, 'utf-8')

    // Generate answers.md
    const answersMd = this.buildAnswersMd(record)
    fs.writeFileSync(path.join(sessionDir, 'answers.md'), answersMd, 'utf-8')

    // Generate notes.md (session report + study notes)
    const notesMd = this.buildNotesMd(record.studyNotes, record.sessionReport)
    fs.writeFileSync(path.join(sessionDir, 'notes.md'), notesMd, 'utf-8')

    return folderName
  }

  /** Save a screenshot to a session folder, returns the filename */
  saveScreenshot(folderName: string, imageBase64: string): string {
    folderName = this.sanitizeFolderName(folderName)
    const screenshotsDir = path.join(this.getAppDataPath(), 'sessions', folderName, 'screenshots')
    fs.mkdirSync(screenshotsDir, { recursive: true })

    const existing = fs.readdirSync(screenshotsDir).filter((f) => f.endsWith('.jpg'))
    const index = String(existing.length + 1).padStart(3, '0')
    const filename = `${index}.jpg`

    const buffer = Buffer.from(imageBase64, 'base64')
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer)
    return filename
  }

  /** List all sessions from filesystem, sorted by date descending */
  listSessions(): SessionSummary[] {
    const sessionsDir = path.join(this.getAppDataPath(), 'sessions')
    if (!fs.existsSync(sessionsDir)) return []

    const folders = fs
      .readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())

    const summaries: SessionSummary[] = []

    for (const folder of folders) {
      const sessionJsonPath = path.join(sessionsDir, folder.name, 'session.json')
      if (!fs.existsSync(sessionJsonPath)) continue

      try {
        const data = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8')) as SessionRecord
        summaries.push({
          id: data.id,
          title: data.title,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          durationSeconds: data.durationSeconds,
          sessionIntent: data.sessionIntent,
          companyName: data.companyName,
          roleName: data.roleName,
          subject: data.subject,
          contextFolder: data.contextFolder,
          workspacePath: data.workspacePath,
          transcriptCount: data.transcript?.length ?? 0,
          answerCount: data.answers?.length ?? 0,
          folderName: folder.name,
        })
      } catch (err) {
        console.warn(`[Sessions] Failed to read ${folder.name}/session.json:`, err)
      }
    }

    return summaries.sort((a, b) => b.startedAt - a.startedAt)
  }

  /** Load full session detail from filesystem */
  getSessionDetail(folderName: string): SessionRecord | null {
    folderName = this.sanitizeFolderName(folderName)
    const sessionJsonPath = path.join(this.getAppDataPath(), 'sessions', folderName, 'session.json')
    if (!fs.existsSync(sessionJsonPath)) return null

    try {
      return JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8')) as SessionRecord
    } catch {
      return null
    }
  }

  /** Delete a session folder */
  deleteSession(folderName: string): boolean {
    folderName = this.sanitizeFolderName(folderName)
    const sessionDir = path.join(this.getAppDataPath(), 'sessions', folderName)
    if (!fs.existsSync(sessionDir)) return false

    fs.rmSync(sessionDir, { recursive: true, force: true })
    return true
  }

  /** Export session as markdown, returns the file path */
  exportSession(folderName: string, format: 'md' | 'json'): string | null {
    folderName = this.sanitizeFolderName(folderName)
    const sessionDir = path.join(this.getAppDataPath(), 'sessions', folderName)
    if (!fs.existsSync(sessionDir)) return null

    if (format === 'json') {
      const jsonPath = path.join(sessionDir, 'session.json')
      return fs.existsSync(jsonPath) ? jsonPath : null
    }

    // For md, return transcript.md path (generate if missing)
    const mdPath = path.join(sessionDir, 'transcript.md')
    if (!fs.existsSync(mdPath)) {
      const record = this.getSessionDetail(folderName)
      if (!record) return null
      fs.writeFileSync(mdPath, this.buildTranscriptMd(record), 'utf-8')
    }
    return mdPath
  }

  /** Open a session folder in Explorer */
  openSessionFolder(folderName: string): void {
    folderName = this.sanitizeFolderName(folderName)
    const sessionDir = path.join(this.getAppDataPath(), 'sessions', folderName)
    if (fs.existsSync(sessionDir)) {
      shell.openPath(sessionDir)
    }
  }

  /** Migrate sessions from electron-store to filesystem */
  migrateSessionsFromStore(sessionStore: any): void {
    const sessionsDir = path.join(this.getAppDataPath(), 'sessions')
    const existingFolders = fs.existsSync(sessionsDir)
      ? fs.readdirSync(sessionsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
      : 0

    // Only migrate if sessions/ is empty
    if (existingFolders > 0) return

    const sessions = sessionStore.get('sessions', []) as SessionRecord[]
    if (sessions.length === 0) return

    console.log(`[Migration] Migrating ${sessions.length} sessions from electron-store to filesystem...`)

    for (const record of sessions) {
      try {
        this.saveSession(record)
      } catch (err) {
        console.warn(`[Migration] Failed to migrate session ${record.id}:`, err)
      }
    }

    // Clear from electron-store after successful migration
    sessionStore.set('sessions', [])
    console.log('[Migration] Session migration complete')
  }

  private buildTranscriptMd(record: SessionRecord): string {
    const startDate = new Date(record.startedAt)
    const endDate = new Date(record.endedAt)
    const dateStr = startDate.toISOString().slice(0, 10)
    const startTime = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    const endTime = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    const durationMin = Math.round(record.durationSeconds / 60)

    const lines: string[] = [
      '# Session Transcript',
      buildSessionSummaryLine(record),
      record.contextFolder ? `**Context Folder:** ${record.contextFolder}` : '',
      record.workspacePath ? `**Workspace:** ${record.workspacePath}` : '',
      `**Date:** ${dateStr} ${startTime} – ${endTime} (${durationMin} min)`,
      '',
      '---',
      '',
    ]

    for (const entry of record.transcript) {
      const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      const speaker = getPersistedTranscriptSpeakerLabel(entry, record)
      lines.push(`**[${time}] ${speaker}:**`)
      lines.push(entry.text)
      lines.push('')
    }

    return lines.join('\n')
  }

  private buildNotesMd(studyNotes?: StudyNotesSnapshot, sessionReport?: SessionReport): string {
    const lines: string[] = ['# Session Notes', '']
    let wroteContent = false

    if (sessionReport) {
      wroteContent = true
      const time = new Date(sessionReport.createdAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      lines.push('## Session Report')
      lines.push(`**Title:** ${sessionReport.title}`)
      lines.push(`**Created:** ${time}`)
      lines.push('')
      lines.push(sessionReport.markdown.trim())
      lines.push('')
      lines.push('---')
      lines.push('')
    }

    if (studyNotes && hasStudyNotes(studyNotes)) {
      wroteContent = true
      lines.push('## Study Notes')
      lines.push('')
      appendStudyNotesSections(lines, studyNotes, '###')
      lines.push('---')
      lines.push('')
    }

    if (!wroteContent) {
      lines.push('No notes captured.')
      lines.push('')
      return lines.join('\n')
    }

    return lines.join('\n')
  }

  private buildAnswersMd(record: SessionRecord): string {
    const lines: string[] = ['# Session Answers', '']

    record.answers.forEach((answer, i) => {
      const time = new Date(answer.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      lines.push(`## Q${i + 1} — ${answer.question}`)
      lines.push(`**Time:** ${time}`)
      if (answer.modelId) {
        lines.push(`**Model:** ${answer.modelId}`)
      }
      if (answer.routingReason) {
        lines.push(`**Route:** ${answer.routingReason}`)
      }
      lines.push('')
      lines.push(answer.answer)
      lines.push('')
      lines.push('---')
      lines.push('')
    })

    return lines.join('\n')
  }

  /** Read raw resume file content. Returns text for TXT/MD, pdfBase64 for PDF. */
  readResumeFile(filePath: string): { text?: string; pdfBase64?: string; ext: string } {
    const ext = filePath.toLowerCase().split('.').pop() || ''

    if (ext === 'pdf') {
      const buffer = fs.readFileSync(filePath)
      return { pdfBase64: buffer.toString('base64'), ext }
    }

    if (ext === 'txt' || ext === 'md') {
      return { text: fs.readFileSync(filePath, 'utf-8'), ext }
    }

    throw new Error(`Unsupported file format: ${ext}`)
  }

  /** Save AI-structured resume markdown to profile folder */
  saveResumeMd(content: string): string {
    const resumePath = path.join(this.getAppDataPath(), 'profile', 'resume.md')
    fs.mkdirSync(path.dirname(resumePath), { recursive: true })
    fs.writeFileSync(resumePath, content, 'utf-8')
    return resumePath
  }
}

const STUDY_SECTIONS: Array<{ section: BrainSummarySection; label: string }> = [
  { section: 'key_points', label: 'Key Concepts' },
  { section: 'code_shown', label: 'Code / Exercises' },
  { section: 'errors', label: 'Errors / Pitfalls' },
  { section: 'action_items', label: 'Study Tasks' },
  { section: 'decisions', label: 'Recommendations' },
]

function buildStudyNotesMd(snapshot: StudyNotesSnapshot): string {
  const lines: string[] = [`# Study Notes: ${snapshot.subject}`, '']
  appendStudyNotesSections(lines, snapshot, '##')
  return lines.join('\n')
}

function appendStudyNotesSections(lines: string[], snapshot: StudyNotesSnapshot, headingPrefix: '##' | '###'): void {
  for (const { section, label } of STUDY_SECTIONS) {
    const bullets = snapshot.sections[section] ?? []
    if (bullets.length === 0) continue
    lines.push(`${headingPrefix} ${label}`)
    for (const bullet of bullets) {
      lines.push(formatStudyBullet(bullet))
    }
    lines.push('')
  }

  if (snapshot.resources.length > 0) {
    lines.push(headingPrefix === '##' ? '## Resources' : '### Resources')
    for (const resource of snapshot.resources) {
      lines.push(`- [${resource.title}](${resource.url}) - ${resource.reason}`)
    }
    lines.push('')
  }

  if (lines.length === 2) {
    lines.push('No study notes captured.')
    lines.push('')
  }
}

function formatStudyBullet(bullet: SummaryBullet): string {
  const refs: string[] = []
  if (bullet.transcript_lines) refs.push(`transcript:${bullet.transcript_lines}`)
  if (bullet.screenshot_uid) refs.push(`screenshot:${bullet.screenshot_uid}`)
  const refText = refs.length ? ` (${refs.join(', ')})` : ''
  return `- [${bullet.ts_label}] ${bullet.text}${refText}`
}

function getPersistedTranscriptSpeakerLabel(
  entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>,
  record: Pick<SessionRecord, 'sessionIntent'>
): string {
  if (entry.speaker === 'user') {
    return entry.source === 'chat' ? 'You (chat)' : 'You'
  }

  if (entry.speaker === 'unknown') {
    if (entry.source === 'chat' || entry.audioSource === 'chat') return 'Aura'
    return 'Unknown'
  }

  return getSessionIntentSpec(record.sessionIntent).externalTranscriptLabel
}

function hasStudyNotes(snapshot: StudyNotesSnapshot): boolean {
  return snapshot.resources.length > 0 ||
    Object.values(snapshot.sections).some((bullets) => bullets.length > 0)
}

/**
 * Hydrate a stored profile against the current schema. Fills in any missing
 * fields (universal or nested blocks) with defaults so callers never have to
 * defensively check. Tolerates the legacy flat shape too — old `resume`,
 * `jobDescription`, `skillsSummary`, `preferredAnswerStyle` get folded into
 * the nested locations.
 */
function mergeProfileWithDefaults(stored: Partial<ProfileContext> | undefined): ProfileContext {
  const s = (stored || {}) as Partial<ProfileContext> & {
    // legacy flat fields, tolerated for any pre-schema-bump store
    resume?: string
    jobDescription?: string
    skillsSummary?: string
    preferredAnswerStyle?: string
  }
  return {
    name: s.name ?? defaultProfile.name,
    languages: s.languages ?? defaultProfile.languages,
    occupation: s.occupation ?? defaultProfile.occupation,
    currentFocus: s.currentFocus ?? defaultProfile.currentFocus,
    commsStyle: s.commsStyle ?? s.preferredAnswerStyle ?? defaultProfile.commsStyle,
    extraInstructions: s.extraInstructions ?? defaultProfile.extraInstructions,
    relationships: s.relationships ?? defaultProfile.relationships,
  }
}

function buildSessionSummaryLine(record: SessionRecord): string {
  const parts = [
    `**Intent:** ${formatSessionIntent(record.sessionIntent)}`,
    record.companyName ? `**Company:** ${record.companyName}` : '',
    record.roleName ? `**Role:** ${record.roleName}` : '',
    record.subject ? `**Subject:** ${record.subject}` : '',
  ].filter(Boolean)

  return parts.join(' | ')
}

function appendDigestSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return
  lines.push(`## ${title}`)
  lines.push('')
  for (const item of items) {
    lines.push(`- ${item}`)
  }
  lines.push('')
}

function formatSessionFolderTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}_${hour}${minute}${second}`
}

function formatSessionIntent(_intent?: SessionRecord['sessionIntent']): string {
  return 'Quick Help'
}
