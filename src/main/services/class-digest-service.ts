import { AnswerSnapshot, ClassDigest, MeetingNote, SessionContext, TranscriptEntry } from '@shared/types'

interface BuildClassDigestOptions {
  transcript: TranscriptEntry[]
  answers: AnswerSnapshot[]
  meetingNotes: MeetingNote[]
  sessionContext: SessionContext
}

interface TranscriptWindow {
  text: string
  timestamp: number
  lastTimestamp: number
}

const CONCEPT_TERMS = [
  'javascript',
  'jsx',
  'react',
  'vite',
  'npm',
  'dependency',
  'package',
  'terminal',
  'component',
  'props',
  'return',
  'curly braces',
  'variable shadowing',
  'source of truth',
  'confetti',
  'react-use',
  'react confetti',
  'mocha',
  'jasmine',
  'testing',
]

const LOW_SIGNAL_PATTERNS = [
  /^(?:okay|alright|cool|yeah|yep|so|well|thanks|thank you|bye bye)[\s.!,]*$/i,
  /\b(?:jersey shore|trash italiano|heartbroken|thank you everybody)\b/i,
  /\b(?:last week that you'll have with me|start teaching my own class)\b/i,
]

export class ClassDigestService {
  buildDigest(options: BuildClassDigestOptions): ClassDigest | undefined {
    const windows = buildTranscriptWindows(options.transcript)
    const keyPoints = pickKeyPoints(windows, options.meetingNotes)
    const commandsAndPackages = pickCommandsAndPackages(windows, options.answers)
    const errorsAndFixes = pickErrorsAndFixes(windows, options.answers)
    const screenEvidence = pickScreenEvidence(options.answers)
    const actionItems = pickActionItems(windows)
    const followUpQuestions = pickFollowUpQuestions(windows, options.meetingNotes, keyPoints)

    const hasDigestContent =
      keyPoints.length > 0 ||
      commandsAndPackages.length > 0 ||
      errorsAndFixes.length > 0 ||
      screenEvidence.length > 0 ||
      actionItems.length > 0 ||
      followUpQuestions.length > 0

    if (!hasDigestContent) return undefined

    return {
      generatedAt: Date.now(),
      summary: buildSummary(options.sessionContext, keyPoints, commandsAndPackages, errorsAndFixes, screenEvidence),
      keyPoints,
      commandsAndPackages,
      errorsAndFixes,
      screenEvidence,
      actionItems,
      followUpQuestions,
    }
  }
}

function buildTranscriptWindows(transcript: TranscriptEntry[]): TranscriptWindow[] {
  const windows: TranscriptWindow[] = []
  let current: TranscriptWindow | null = null

  for (const entry of transcript) {
    if (!entry.isFinal || entry.speaker === 'user') continue
    const text = cleanText(entry.text)
    if (!text || isLowSignal(text)) continue

    const timestamp = entry.timestamp || Date.now()
    const gapMs = current ? timestamp - current.lastTimestamp : 0

    if (!current || gapMs > 7000 || wordCount(current.text) > 48) {
      if (current && wordCount(current.text) >= 8) windows.push(current)
      current = { text, timestamp, lastTimestamp: timestamp }
      continue
    }

    current = {
      ...current,
      text: cleanText(`${current.text} ${text}`),
      lastTimestamp: timestamp,
    }
  }

  if (current && wordCount(current.text) >= 8) windows.push(current)
  return windows
}

function pickKeyPoints(windows: TranscriptWindow[], notes: MeetingNote[]): string[] {
  const candidates = [
    ...notes.map((note) => cleanText(note.text)),
    ...windows
      .filter((window) => scoreConceptWindow(window.text) > 0)
      .sort((a, b) => scoreConceptWindow(b.text) - scoreConceptWindow(a.text))
      .map((window) => window.text),
  ]

  return uniqueUseful(candidates)
    .filter((text) => wordCount(text) >= 8)
    .slice(0, 12)
}

function pickCommandsAndPackages(windows: TranscriptWindow[], answers: AnswerSnapshot[]): string[] {
  const texts = [
    ...windows.map((window) => window.text),
    ...answers.flatMap((answer) => [answer.question, answer.answer]),
  ]
  const results: string[] = []

  for (const text of texts) {
    const normalized = cleanText(text)
    const commandMatches = normalized.match(/\b(?:npm|npx|pnpm|yarn)\s+(?:install|i|create|run|add|dev|build|test)\s+[\w@./:-]+/gi)
    if (commandMatches) results.push(...commandMatches.map((match) => `Command: ${match}`))

    for (const pkg of ['react-confetti', 'react-use', 'vite', 'mocha', 'jasmine', 'react router dom', 'axios', 'styled components']) {
      if (normalized.toLowerCase().includes(pkg)) {
        results.push(`Package/topic: ${pkg}`)
      }
    }
  }

  return uniqueUseful(results).slice(0, 12)
}

function pickErrorsAndFixes(windows: TranscriptWindow[], answers: AnswerSnapshot[]): string[] {
  const candidates = [
    ...windows.map((window) => window.text),
    ...answers.map((answer) => `${answer.question} ${answer.answer}`),
  ]

  return uniqueUseful(
    candidates
      .filter((text) => /\b(?:error|failed|not found|not installed|could not be resolved|dependency|fix|kill the server|run dev)\b/i.test(text))
      .map((text) => cleanText(text))
  ).slice(0, 8)
}

function pickScreenEvidence(answers: AnswerSnapshot[]): string[] {
  const screenAnswers = answers.filter(isScreenAnalysisAnswer)
  const evidence: string[] = []

  for (const answer of screenAnswers) {
    const snippets = extractScreenEvidenceSnippets(answer.answer)
    if (snippets.length === 0) {
      const fallback = firstUsefulSentences(answer.answer, 2)
      if (fallback) evidence.push(formatScreenEvidence(answer, fallback))
      continue
    }

    for (const snippet of snippets) {
      evidence.push(formatScreenEvidence(answer, snippet))
    }
  }

  return uniqueUseful(evidence).slice(0, 12)
}

function pickActionItems(windows: TranscriptWindow[]): string[] {
  return uniqueUseful(
    windows
      .map((window) => window.text)
      .filter((text) => /\b(?:you have to|you need to|you should|don't forget|remember|keep that in mind|try to|practice)\b/i.test(text))
      .map((text) => cleanText(text))
  ).slice(0, 10)
}

function pickFollowUpQuestions(windows: TranscriptWindow[], notes: MeetingNote[], keyPoints: string[]): string[] {
  const transcriptQuestions = windows
    .map((window) => window.text)
    .filter((text) => text.trim().endsWith('?'))
  const noteQuestions = notes.map((note) => note.followUp)
  const generatedQuestions = keyPoints.slice(0, 4).map((point) => buildFollowUp(point))

  return uniqueUseful([...transcriptQuestions, ...noteQuestions, ...generatedQuestions])
    .filter((text) => text.endsWith('?'))
    .slice(0, 10)
}

function buildSummary(
  sessionContext: SessionContext,
  keyPoints: string[],
  commandsAndPackages: string[],
  errorsAndFixes: string[],
  screenEvidence: string[]
): string {
  const subject = sessionContext.subject?.trim() || formatIntent(sessionContext.sessionIntent)
  const parts = [`${subject} covered ${keyPoints.length || 'several'} key learning points.`]
  if (commandsAndPackages.length > 0) parts.push(`${commandsAndPackages.length} commands/packages were mentioned.`)
  if (errorsAndFixes.length > 0) parts.push(`${errorsAndFixes.length} errors or fixes were captured.`)
  if (screenEvidence.length > 0) parts.push(`${screenEvidence.length} screen observations were used as evidence.`)
  return parts.join(' ')
}

function buildFollowUp(point: string): string {
  const topic = point.replace(/\.$/, '').slice(0, 120)
  if (/\b(?:error|dependency|install|package|npm)\b/i.test(point)) {
    return `What exact command or dependency fixes ${topic}?`
  }
  if (/\b(?:jsx|curly braces|return|javascript)\b/i.test(point)) {
    return `Can you give a JSX example for ${topic}?`
  }
  return `What is the practical takeaway from ${topic}?`
}

function scoreConceptWindow(text: string): number {
  const normalized = text.toLowerCase()
  let score = 0
  for (const term of CONCEPT_TERMS) {
    if (normalized.includes(term)) score += term.includes(' ') ? 2 : 1
  }
  if (/\b(?:important|remember|keep that in mind|you have to|you need to|don't forget)\b/i.test(text)) score += 2
  if (/\b(?:example|basically|means|because|so)\b/i.test(text)) score += 1
  return score
}

function uniqueUseful(items: string[]): string[] {
  const seen = new Set<string>()
  const results: string[] = []

  for (const item of items) {
    const cleaned = cleanText(item)
    if (!cleaned || isLowSignal(cleaned)) continue
    if (wordCount(cleaned) < 3) continue
    const key = cleaned.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    results.push(cleaned)
  }

  return results
}

function isScreenAnalysisAnswer(answer: AnswerSnapshot): boolean {
  const question = answer.question.toLowerCase()
  const route = (answer.routingReason || '').toLowerCase()
  return (
    question.includes('screen') ||
    question.includes('screenshot') ||
    route.includes('screen analysis') ||
    route.includes('vision')
  )
}

function extractScreenEvidenceSnippets(answer: string): string[] {
  const lines = answer
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)

  const snippets: string[] = []
  let inUsefulSection = false

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (/^#+\s*/.test(line) || /^\*\*.+\*\*:?\s*$/.test(line)) {
      inUsefulSection =
        lower.includes('clearly visible') ||
        lower.includes('direct answer') ||
        lower.includes('how to fix') ||
        lower.includes('what is visible') ||
        lower.includes('what i can see')
      continue
    }

    if (lower.includes('what is uncertain') || lower.includes('uncertain or unreadable')) {
      inUsefulSection = false
      continue
    }

    if (inUsefulSection || looksLikeScreenEvidence(line)) {
      snippets.push(cleanScreenEvidence(line))
    }
  }

  return uniqueUseful(snippets)
    .filter((snippet) => wordCount(snippet) >= 5)
    .slice(0, 4)
}

function looksLikeScreenEvidence(line: string): boolean {
  return /\b(?:visible|shows?|displaying|terminal|error|dependency|vs code|file explorer|package\.json|app\.jsx|main\.jsx|vite|react|npm|install|imported|not found|could not be resolved|fix|run)\b/i.test(line)
}

function cleanScreenEvidence(line: string): string {
  return line
    .replace(/^\*\*([^*]+)\*\*:?\s*/, '$1: ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstUsefulSentences(text: string, limit: number): string {
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => wordCount(sentence) >= 6 && !/uncertain|unreadable/i.test(sentence))
    .slice(0, limit)

  return sentences.join(' ')
}

function formatScreenEvidence(answer: AnswerSnapshot, snippet: string): string {
  const time = new Date(answer.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const label = answer.question && answer.question !== 'Screen Analysis'
    ? answer.question.replace(/^Screen context:\s*/i, '').slice(0, 90)
    : 'screen capture'
  return `[${time}] ${label}: ${snippet}`
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function isLowSignal(text: string): boolean {
  return LOW_SIGNAL_PATTERNS.some((pattern) => pattern.test(text))
}

function formatIntent(intent: SessionContext['sessionIntent']): string {
  switch (intent) {
    case 'meeting':
      return 'Meeting'
    case 'presentation':
      return 'Presentation'
    case 'quick-help':
      return 'Quick help session'
    default:
      return 'Interview'
  }
}
