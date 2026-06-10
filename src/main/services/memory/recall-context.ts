import {
  ArtifactRecord,
  SessionContext,
  TranscriptEntry,
} from '@shared/types'
import { getSessionBehavior } from '@shared/session-intent-policy'
import { RecallService } from './recall-service'

interface RecallContextBuildOptions {
  recallService: RecallService
  sessionFolderName?: string
  noiseTokens: ReadonlySet<string>
  baseRecallContext?: string
  transcriptEntries?: TranscriptEntry[]
}

const RECALL_RESULT_LIMIT = 3
const MIN_RESULT_SCORE = 3.4
const RELATIVE_SCORE_THRESHOLD = 0.62
const MAX_PROMPT_BLOCK_LENGTH = 900
const MAX_QUERY_TOKENS = 18

export async function buildSessionRecallContext(
  sessionCtx: SessionContext | undefined,
  options: RecallContextBuildOptions
): Promise<string> {
  const query = buildSessionRecallQuery(sessionCtx, options.noiseTokens)
  const behaviorContext = formatSessionBehaviorRecallBlock(sessionCtx)
  if (!query) return behaviorContext
  return mergeRecallContexts(behaviorContext, await formatRecallContextBlock(query, options))
}

export async function buildAnswerRecallContext(
  question: string,
  sessionCtx: SessionContext | undefined,
  options: RecallContextBuildOptions
): Promise<string> {
  const sessionQuery = buildSessionRecallQuery(sessionCtx, options.noiseTokens)
  const answerQuery = compactRecallQueryParts([question, sessionQuery], options.noiseTokens)
  const answerRecall = answerQuery ? await formatRecallContextBlock(answerQuery, options) : ''
  return mergeRecallContexts(options.baseRecallContext, formatSessionBehaviorRecallBlock(sessionCtx), answerRecall)
}

export async function buildScreenshotRecallContext(
  trigger: string,
  sessionCtx: SessionContext | undefined,
  options: RecallContextBuildOptions
): Promise<string> {
  const recentTranscript = (options.transcriptEntries || [])
    .filter((entry) => entry.isFinal)
    .slice(-4)
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join(' ')

  const screenshotQuery = compactRecallQueryParts(
    [trigger.trim(), recentTranscript, buildSessionRecallQuery(sessionCtx, options.noiseTokens)],
    options.noiseTokens
  )

  const screenshotRecall = screenshotQuery
    ? await formatRecallContextBlock(screenshotQuery, options)
    : ''

  return mergeRecallContexts(options.baseRecallContext, formatSessionBehaviorRecallBlock(sessionCtx), screenshotRecall)
}

function buildSessionRecallQuery(
  sessionCtx: SessionContext | undefined,
  noiseTokens: ReadonlySet<string>
): string {
  if (!sessionCtx) return ''

  return compactRecallQueryParts(
    [
      sessionCtx.sessionIntent,
      sessionCtx.companyName,
      sessionCtx.roleName,
      sessionCtx.subject,
      sessionCtx.sessionNotes,
      getSessionBehavior(sessionCtx.sessionIntent || 'quick-help').brainPolicy,
    ],
    noiseTokens
  )
}

function formatSessionBehaviorRecallBlock(sessionCtx: SessionContext | undefined): string {
  if (!sessionCtx) return ''
  const behavior = getSessionBehavior(sessionCtx.sessionIntent || 'quick-help')
  return [
    'Session behavior contract for recall:',
    `Behavior role: ${behavior.agentRole}`,
    `Primary input: ${behavior.primaryInput}`,
    `Remembering policy: ${behavior.brainPolicy}`,
  ].join('\n')
}

async function formatRecallContextBlock(query: string, options: RecallContextBuildOptions): Promise<string> {
  const results = await options.recallService.search({
    query,
    limit: RECALL_RESULT_LIMIT,
    sessionFolderName: options.sessionFolderName,
  })

  if (results.length === 0) {
    return ''
  }

  const topScore = results[0]?.score ?? 0
  const filteredResults = results.filter((result, index) => {
    if (index === 0) return true
    return result.score >= Math.max(MIN_RESULT_SCORE, topScore * RELATIVE_SCORE_THRESHOLD)
  })

  const lines = filteredResults.map((result, index) => {
    const header = `${index + 1}. [${result.kind}] ${truncatePromptText(result.title, 90)}`
    const summary = `Summary: ${truncatePromptText(result.summary, 120)}`
    const matches = result.matchedTerms.length > 0
      ? `Matches: ${result.matchedTerms.slice(0, 3).join(', ')}`
      : ''
    const linkedArtifacts = result.linkedArtifacts && result.linkedArtifacts.length > 0
      ? `Artifacts: ${result.linkedArtifacts
          .slice(0, 1)
          .map((artifact) => truncatePromptText(artifact.relativePath || artifact.absolutePath, 60))
          .join('; ')}`
      : ''

    return [header, summary, matches, linkedArtifacts]
      .filter(Boolean)
      .join('\n')
  })

  const compactLines = lines
    .join('\n\n')
    .slice(0, MAX_PROMPT_BLOCK_LENGTH)
    .trimEnd()

  return `Use this recalled context only when it genuinely helps the current request.\n${compactLines}`
}

function mergeRecallContexts(...contexts: Array<string | undefined>): string {
  const unique = Array.from(new Set(contexts.map((context) => (context || '').trim()).filter(Boolean)))
  return unique.join('\n\n')
}

function truncatePromptText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function compactRecallQueryParts(
  parts: Array<string | undefined>,
  noiseTokens: ReadonlySet<string>
): string {
  const tokens = Array.from(
    new Set(
      parts
        .flatMap((part) => (part || '').split(/[^a-zA-Z0-9]+/))
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 3 && !noiseTokens.has(token))
    )
  )

  return tokens.slice(0, MAX_QUERY_TOKENS).join(' ')
}
