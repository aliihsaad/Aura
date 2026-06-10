import path from 'path'
import { promises as fs } from 'fs'
import type { LLMService } from '../llm-service'
import type { ContextManager } from '../context-manager'
import type { SessionRuntimeStore } from '../session-runtime-store'
import type {
  BrainConfig,
  BrainScreenshotEntry,
  BrainSummarySection,
  StudyNotesSnapshot,
  StudyResourceLink,
  SubjectState,
  SummaryBullet,
} from '@shared/session-brain-types'
import type { SessionContext, TranscriptEntry } from '@shared/types'
import { atomicWriteFile, readJsonOrNull } from '../../utils/atomic-write'
import { emptySummaryDoc, mergeSummaryDelta, applySubjectDrift, renderSummaryMarkdown, SummaryDoc } from './session-brain-merger'
import { buildSummaryDeltaPrompt, safeParseSummaryDelta, buildScreenshotPrompt, safeParseScreenshotRating } from './session-brain-prompts'
import { ScreenCaptureService } from '../screen-capture'

export interface SessionBrainDeps {
  llmService: LLMService
  contextManager: ContextManager
  runtimeStore: SessionRuntimeStore
  config: BrainConfig
  recordUsage?: (model: string, promptTokens: number, completionTokens: number) => void
  onStudyNotesSnapshot?: (snapshot: StudyNotesSnapshot) => void
  /** Cross-session context recalled from Vault (vault_recall_context) at
   * session start — woven into the brain's context snapshot so answers and
   * realtime reconnects keep cross-session continuity. */
  getVaultRecallContext?: () => string
}

export class SessionBrainService {
  private deps: SessionBrainDeps
  private summaryTimer: NodeJS.Timeout | null = null
  private screenshotTimer: NodeJS.Timeout | null = null
  private summaryTickInFlight = false
  private screenshotTickInFlight = false
  private summaryTickCount = 0
  private screenshotKeptCount = 0
  private subjectState: SubjectState | null = null
  private summaryDoc: SummaryDoc = emptySummaryDoc()
  private sessionFolderName = ''
  private lastSummaryTickUtteranceCount = 0
  private isPaused = false

  constructor(deps: SessionBrainDeps) {
    this.deps = deps
  }

  async start(args: { sessionFolderName: string; sessionContext: SessionContext; startedAt: number }): Promise<void> {
    if (!this.deps.config.brainEnabled) return
    this.sessionFolderName = args.sessionFolderName
    this.summaryTickCount = 0
    this.screenshotKeptCount = 0
    this.lastSummaryTickUtteranceCount = 0
    this.isPaused = false

    const seededSubject = args.sessionContext.subject?.trim() || formatIntentLabel(args.sessionContext)
    this.subjectState = {
      current_subject: seededSubject,
      confidence: 0.6,
      seeded_from: 'session_setup',
      since_ts: args.startedAt,
      history: [{ ts: args.startedAt, subject: seededSubject, reason: 'session_setup' }],
    }
    this.summaryDoc = emptySummaryDoc()

    await this.persistSubject()
    await this.persistSummary()
    this.publishStudyNotesSnapshot()

    this.summaryTimer = setInterval(() => { void this.summaryTick() }, this.deps.config.brainSummaryIntervalMs)
    this.screenshotTimer = setInterval(() => { void this.screenshotTick() }, this.deps.config.brainScreenshotIntervalMs)
  }

  pause(): void { this.isPaused = true }
  resume(): void { this.isPaused = false }

  async stop(): Promise<void> {
    if (this.summaryTimer) { clearInterval(this.summaryTimer); this.summaryTimer = null }
    if (this.screenshotTimer) { clearInterval(this.screenshotTimer); this.screenshotTimer = null }

    try {
      await this.summaryTick()
    } catch (err) {
      console.warn('[session-brain] final summary tick failed:', err)
    }

    if (this.subjectState) {
      const md = renderSummaryMarkdown(this.subjectState, this.summaryDoc)
      const finalFile = path.join(this.deps.contextManager.brainFolderPath(this.sessionFolderName), 'final-summary.md')
      await atomicWriteFile(finalFile, `${md}\n\n_Session ended ${new Date().toISOString()}_`)
    }

    try {
      await this.cleanupBrainScreenshotImages()
    } catch (err) {
      console.warn('[session-brain] screenshot cleanup failed:', err)
    }
  }

  private async summaryTick(): Promise<void> {
    if (this.isPaused) return
    if (this.summaryTickInFlight) return
    if (this.summaryTickCount >= this.deps.config.brainSummaryMaxTicks) return

    const transcript = this.deps.runtimeStore.sessionTranscript
    const finalized = transcript.filter((e) => e.isFinal)
    if (finalized.length - this.lastSummaryTickUtteranceCount < this.deps.config.brainSummaryMinUtterances) return

    this.summaryTickInFlight = true
    try {
      const window = buildTranscriptWindowText(finalized.slice(-60))
      if (!window.trim()) return

      const { systemPrompt, userPrompt } = buildSummaryDeltaPrompt({
        subject: this.subjectState!,
        recentTranscriptWindow: window,
        existingSummary: this.summaryDoc,
      })

      const raw = await this.deps.llmService.cheapTextCompletion({
        systemPrompt,
        userPrompt,
        model: this.deps.config.brainModel,
        jsonSchemaName: 'summary_delta',
        onUsage: (usage) => this.deps.recordUsage?.(usage.model, usage.promptTokens, usage.completionTokens),
      })
      const delta = safeParseSummaryDelta(raw)
      if (!delta) {
        console.warn('[session-brain] could not parse delta, skipping tick')
        return
      }

      if (delta.subject?.drift_detected && this.subjectState) {
        this.subjectState = applySubjectDrift(this.subjectState, {
          current: delta.subject.current,
          confidence: delta.subject.confidence,
          reason: delta.subject.drift_reason ?? undefined,
        })
        await this.persistSubject()
      } else if (delta.subject && this.subjectState) {
        this.subjectState = { ...this.subjectState, confidence: delta.subject.confidence }
        await this.persistSubject()
      }

      this.summaryDoc = mergeSummaryDelta(this.summaryDoc, delta)
      this.summaryTickCount += 1
      this.lastSummaryTickUtteranceCount = finalized.length
      await this.persistSummary()
      this.publishStudyNotesSnapshot()
    } catch (err) {
      console.warn('[session-brain] summary tick failed:', err)
    } finally {
      this.summaryTickInFlight = false
    }
  }

  private async screenshotTick(): Promise<void> {
    if (this.isPaused) return
    if (this.screenshotTickInFlight) return
    if (this.screenshotKeptCount >= this.deps.config.brainScreenshotMaxKept) return
    if (!this.subjectState) return

    this.screenshotTickInFlight = true
    try {
      const finalizedCount = this.deps.runtimeStore.sessionTranscript.filter((e) => e.isFinal).length
      if (finalizedCount === this.lastSummaryTickUtteranceCount && this.summaryTickCount === 0) return

      const capturer = new ScreenCaptureService()
      const jpegBase64 = await capturer.captureToBase64Jpeg()
      if (!jpegBase64) return

      const recentSnippet = this.deps.runtimeStore.sessionTranscript
        .filter((e) => e.isFinal)
        .slice(-6)
        .map((e) => e.text)
        .join(' ')
        .slice(0, 600)

      const { systemPrompt, userPrompt } = buildScreenshotPrompt({
        subject: this.subjectState.current_subject,
        recentTranscriptSnippet: recentSnippet,
      })

      const raw = await this.deps.llmService.cheapVisionCompletion({
        systemPrompt,
        userPrompt,
        imageBase64Jpeg: jpegBase64,
        model: this.deps.config.brainVisionModel,
        onUsage: (usage) => this.deps.recordUsage?.(usage.model, usage.promptTokens, usage.completionTokens),
      })
      const rating = safeParseScreenshotRating(raw)
      if (!rating) {
        console.warn('[session-brain] could not parse screenshot rating, skipping')
        return
      }

      const ts = Date.now()
      const uid = String(ts).slice(-8)

      const folder = this.deps.contextManager.brainScreenshotsFolderPath(this.sessionFolderName)
      const indexFile = path.join(folder, 'index.json')
      const existing = (await readJsonOrNull<BrainScreenshotEntry[]>(indexFile)) ?? []
      const duplicateOf = findDuplicateBrainScreenshot(existing, rating.caption)
      const kept = rating.relevance_score >= this.deps.config.brainScreenshotKeepThreshold && !duplicateOf
      const skipReason: BrainScreenshotEntry['image_skipped_reason'] = duplicateOf
        ? 'duplicate'
        : kept
          ? undefined
          : 'low-relevance'
      let imagePath: string | null = null
      if (kept) {
        await fs.mkdir(folder, { recursive: true })
        imagePath = path.join(folder, `${uid}.jpg`)
        await fs.writeFile(imagePath, Buffer.from(jpegBase64, 'base64'))
        this.screenshotKeptCount += 1
      }

      existing.push({
        uid,
        ts,
        subject_at_capture: this.subjectState.current_subject,
        relevance_score: rating.relevance_score,
        caption: rating.caption,
        kept,
        image_path: imagePath ? path.relative(folder, imagePath) : null,
        duplicate_of: duplicateOf,
        image_skipped_reason: skipReason,
      })
      await atomicWriteFile(indexFile, JSON.stringify(existing, null, 2))
    } catch (err) {
      console.warn('[session-brain] screenshot tick failed:', err)
    } finally {
      this.screenshotTickInFlight = false
    }
  }

  private async cleanupBrainScreenshotImages(): Promise<void> {
    if (!this.sessionFolderName) return

    const folder = this.deps.contextManager.brainScreenshotsFolderPath(this.sessionFolderName)
    const indexFile = path.join(folder, 'index.json')
    const index = (await readJsonOrNull<BrainScreenshotEntry[]>(indexFile)) ?? []
    const deletedAt = Date.now()
    let changed = false
    const referencedFiles = new Set<string>()

    const cleaned: BrainScreenshotEntry[] = []
    for (const entry of index) {
      if (!entry.image_path) {
        cleaned.push(entry)
        continue
      }

      const imagePath = path.resolve(folder, entry.image_path)
      const relative = path.relative(folder, imagePath)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        changed = true
        cleaned.push({ ...entry, image_path: null, image_deleted_at: deletedAt })
        continue
      }

      referencedFiles.add(path.basename(imagePath))
      try {
        await fs.unlink(imagePath)
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.warn('[session-brain] could not delete screenshot:', imagePath, err)
          cleaned.push(entry)
          continue
        }
      }

      changed = true
      cleaned.push({ ...entry, image_path: null, image_deleted_at: deletedAt })
    }

    try {
      const files = await fs.readdir(folder)
      for (const file of files) {
        if (!/\.jpe?g$/i.test(file) || referencedFiles.has(file)) continue
        const imagePath = path.join(folder, file)
        await fs.unlink(imagePath)
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err
    }

    if (changed) {
      await atomicWriteFile(indexFile, JSON.stringify(cleaned, null, 2))
    }
    this.screenshotKeptCount = 0
  }

  async readContextSnapshot(): Promise<{
    subject: SubjectState | null
    summaryTailMd: string
    latestRelevantScreenshot: BrainScreenshotEntry | null
  }> {
    if (!this.deps.config.brainEnabled || !this.sessionFolderName) {
      return { subject: null, summaryTailMd: '', latestRelevantScreenshot: null }
    }
    const brainPath = this.deps.contextManager.brainFolderPath(this.sessionFolderName)
    const subject = await readJsonOrNull<SubjectState>(path.join(brainPath, 'subject.json'))

    let summaryTail = ''
    try {
      const md = await fs.readFile(path.join(brainPath, 'summary.md'), 'utf8')
      const lines = md.split('\n')
      summaryTail = lines.slice(-80).join('\n')
    } catch {
      summaryTail = ''
    }

    const vaultRecall = this.deps.getVaultRecallContext?.() ?? ''
    if (vaultRecall.trim()) {
      summaryTail = summaryTail.trim()
        ? `${vaultRecall.trim()}\n\n${summaryTail}`
        : vaultRecall.trim()
    }

    const indexFile = path.join(this.deps.contextManager.brainScreenshotsFolderPath(this.sessionFolderName), 'index.json')
    const index = (await readJsonOrNull<BrainScreenshotEntry[]>(indexFile)) ?? []
    const cutoff = Date.now() - 90_000
    const latestRelevant = [...index]
      .reverse()
      .find((e) => e.kept && e.relevance_score >= 0.7 && e.ts >= cutoff) ?? null

    return { subject, summaryTailMd: summaryTail, latestRelevantScreenshot: latestRelevant }
  }

  readStudyNotesSnapshot(): StudyNotesSnapshot | null {
    return this.buildStudyNotesSnapshot()
  }

  /**
   * Condensed in-memory session summary for context injection — used by the
   * realtime pipeline to re-seed a fresh connection after a mid-session
   * model rotation. Returns '' early in a session (no summary tick yet) so
   * callers can skip injection.
   */
  getSummary(): string {
    if (!this.deps.config.brainEnabled || !this.subjectState) return ''
    if (this.summaryTickCount === 0) return ''
    const md = renderSummaryMarkdown(this.subjectState, this.summaryDoc).trim()
    if (!md) return ''
    const lines = md.split('\n')
    return lines.length > 60 ? lines.slice(-60).join('\n') : md
  }

  private async persistSubject(): Promise<void> {
    if (!this.subjectState) return
    const file = path.join(this.deps.contextManager.brainFolderPath(this.sessionFolderName), 'subject.json')
    await atomicWriteFile(file, JSON.stringify(this.subjectState, null, 2))
  }

  private async persistSummary(): Promise<void> {
    if (!this.subjectState) return
    const md = renderSummaryMarkdown(this.subjectState, this.summaryDoc)
    const file = path.join(this.deps.contextManager.brainFolderPath(this.sessionFolderName), 'summary.md')
    await atomicWriteFile(file, md)
  }

  private publishStudyNotesSnapshot(): void {
    const snapshot = this.buildStudyNotesSnapshot()
    if (!snapshot) return
    this.deps.onStudyNotesSnapshot?.(snapshot)
  }

  private buildStudyNotesSnapshot(): StudyNotesSnapshot | null {
    if (!this.subjectState) return null
    return {
      subject: this.subjectState.current_subject,
      updatedAt: Date.now(),
      sections: curateStudyNoteSections(this.summaryDoc.sections),
      resources: buildStudyResources(this.subjectState.current_subject, this.summaryDoc),
    }
  }
}

const STUDY_NOTE_LIMITS: Record<BrainSummarySection, number> = {
  key_points: 4,
  code_shown: 3,
  errors: 2,
  action_items: 2,
  decisions: 1,
}

function curateStudyNoteSections(
  sections: Record<BrainSummarySection, SummaryBullet[]>
): Record<BrainSummarySection, SummaryBullet[]> {
  return {
    key_points: sections.key_points.slice(-STUDY_NOTE_LIMITS.key_points),
    errors: sections.errors.slice(-STUDY_NOTE_LIMITS.errors),
    action_items: sections.action_items.slice(-STUDY_NOTE_LIMITS.action_items),
    decisions: sections.decisions.slice(-STUDY_NOTE_LIMITS.decisions),
    code_shown: sections.code_shown.slice(-STUDY_NOTE_LIMITS.code_shown),
  }
}

function buildStudyResources(subject: string, doc: SummaryDoc): StudyResourceLink[] {
  const text = [
    subject,
    ...Object.values(doc.sections).flatMap((bullets) => bullets.map((bullet) => bullet.text)),
  ].join(' ').toLowerCase()
  const promiseScore = countMatches(text, /\b(?:promise|promises|promise\.all|async|await|then|catch)\b/g)
  const reactScore = countMatches(text, /\b(?:react|jsx|component|props|state|hook|useeffect|usestate)\b/g)

  const resources: StudyResourceLink[] = []
  const add = (title: string, url: string, reason: string): void => {
    if (!resources.some((resource) => resource.url === url)) resources.push({ title, url, reason })
  }

  if (promiseScore > 0) {
    add('MDN Promise', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise', 'Promise concepts, states, chaining, and examples')
  }
  if (/\bpromise\.all\b/.test(text)) {
    add('MDN Promise.all', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all', 'Reference for resolving multiple promises together')
  }
  if (/\b(async|await|async function)\b/.test(text)) {
    add('MDN async function', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function', 'Async function syntax and await behavior')
  }
  if (reactScore >= 2 && reactScore >= promiseScore) {
    add('React documentation', 'https://react.dev/learn', 'Core React concepts and examples')
  }
  if (/\b(vite|dev server|vite config)\b/.test(text)) {
    add('Vite guide', 'https://vite.dev/guide/', 'Vite project and configuration reference')
  }
  if (/\b(tailwind|tailwindcss|utility class|css)\b/.test(text)) {
    add('Tailwind CSS documentation', 'https://tailwindcss.com/docs', 'Utility classes and setup reference')
  }
  if (/\b(javascript|closure|scope|promise|async|array|object|function)\b/.test(text)) {
    add('MDN JavaScript guide', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', 'Trusted JavaScript language reference')
  }
  if (/\b(typescript|type|interface|generic)\b/.test(text)) {
    add('TypeScript handbook', 'https://www.typescriptlang.org/docs/handbook/intro.html', 'TypeScript language and typing reference')
  }
  if (/\b(test|mocha|jasmine|assert|unit test)\b/.test(text)) {
    add('MDN testing overview', 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Testing', 'General web testing concepts')
  }

  if (resources.length === 0) {
    add('MDN Learn Web Development', 'https://developer.mozilla.org/en-US/docs/Learn_web_development', 'Broad web-development study reference')
  }

  return resources.slice(0, 5)
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

function findDuplicateBrainScreenshot(entries: BrainScreenshotEntry[], caption: string): string | undefined {
  const captionTokens = screenshotCaptionTokenSet(caption)
  if (captionTokens.size < 3) return undefined

  for (const entry of [...entries].reverse()) {
    if (!entry.kept || !entry.caption) continue
    const previousTokens = screenshotCaptionTokenSet(entry.caption)
    if (previousTokens.size < 3) continue
    if (captionJaccard(captionTokens, previousTokens) >= 0.78) return entry.uid
  }

  return undefined
}

function screenshotCaptionTokenSet(caption: string): Set<string> {
  const tokens = caption
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3)
  return new Set(tokens)
}

function captionJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function buildTranscriptWindowText(entries: TranscriptEntry[]): string {
  return entries
    .map((e, i) => {
      const t = formatLocalBrainTime(e.timestamp)
      return `L${i + 1} [${t}] ${e.speaker}: ${e.text}`
    })
    .join('\n')
}

function formatLocalBrainTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatIntentLabel(ctx: SessionContext): string {
  return ctx.companyName && ctx.roleName ? `${ctx.companyName} — ${ctx.roleName}` : 'Live session'
}
