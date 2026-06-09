import {
  ArtifactRecord,
  MemoryRecord,
  RecallQuery,
  RecallResult,
} from '@shared/types'
import { ArtifactStore } from './artifact-store'
import { EmbeddingService } from './embedding-service'
import { MemoryStore } from './memory-store'

const TOKEN_SPLIT_REGEX = /[^a-z0-9]+/i
const STOP_WORDS = new Set([
  'about',
  'a',
  'after',
  'all',
  'an',
  'and',
  'are',
  'as',
  'at',
  'before',
  'be',
  'can',
  'context',
  'did',
  'do',
  'by',
  'during',
  'each',
  'from',
  'for',
  'had',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'later',
  'me',
  'more',
  'my',
  'need',
  'needs',
  'now',
  'of',
  'on',
  'or',
  'our',
  'project',
  'remember',
  'review',
  'saved',
  'session',
  'should',
  'show',
  'something',
  'the',
  'their',
  'them',
  'there',
  'these',
  'this',
  'those',
  'to',
  'up',
  'use',
  'using',
  'want',
  'what',
  'when',
  'where',
  'who',
  'why',
  'with',
  'work',
  'working',
])
const LOW_SIGNAL_MEMORY_TITLES = [
  'potential note captured',
  'potential task mentioned',
  'potential note',
  'potential task',
  'screenshot captured for later review',
  'session record saved',
  'session notes saved',
  'class digest saved',
]
const LOW_SIGNAL_MATCH_TERMS = new Set([
  'artifact',
  'artifacts',
  'capture',
  'captured',
  'draft',
  'image',
  'note',
  'notes',
  'record',
  'screenshot',
  'screenshots',
  'summary',
  'task',
  'tasks',
  'transcript',
])
const ARTIFACT_TYPE_BOOSTS: Record<string, number> = {
  'screenshot.image': 0.25,
  'generated.image': 0.2,
  'session.record': -0.4,
  'session.transcript': 0.1,
  'session.answers': 0.2,
  'session.notes': 0.25,
  'session.digest': 0.35,
}
const SEMANTIC_WEIGHT = 0.45
const KEYWORD_WEIGHT = 0.55
const SEMANTIC_SCORE_SCALE = 12
const MIN_SEMANTIC_SIMILARITY = 0.25

export class RecallService {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly artifactStore: ArtifactStore,
    private readonly embeddingService?: EmbeddingService
  ) {}

  async search(request: RecallQuery): Promise<RecallResult[]> {
    const normalizedQuery = normalizeSearchText(request.query)
    if (!normalizedQuery) {
      return []
    }

    const tokens = tokenize(normalizedQuery)
    const semanticScoreMap = await this.getSemanticScores(request.query)
    const activeMemories = this.memoryStore.listRecent({
      limit: 250,
      statuses: ['active'],
    })
    const recentArtifacts = this.artifactStore.listRecent({
      limit: 200,
      sessionFolderName: request.sessionFolderName,
    })
    const linkedArtifactIds = Array.from(
      new Set(activeMemories.flatMap((memory) => memory.sourceArtifactIds || []))
    )
    const linkedArtifacts = this.artifactStore.getByIds(linkedArtifactIds)
    const artifactById = new Map(linkedArtifacts.map((artifact) => [artifact.id, artifact]))

    const memoryResults = activeMemories
      .map((memory) => this.buildMemoryResult(memory, tokens, normalizedQuery, request.sessionFolderName, artifactById, semanticScoreMap))
      .filter((result): result is RecallResult => Boolean(result))

    const memoryArtifactIds = new Set(
      memoryResults.flatMap((result) => result.linkedArtifacts?.map((artifact) => artifact.id) || [])
    )

    const artifactResults = recentArtifacts
      .filter((artifact) => !memoryArtifactIds.has(artifact.id))
      .map((artifact) => this.buildArtifactResult(artifact, tokens, normalizedQuery, request.sessionFolderName))
      .filter((result): result is RecallResult => Boolean(result))

    return [...memoryResults, ...artifactResults]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return right.createdAt - left.createdAt
      })
      .slice(0, request.limit ?? 10)
  }

  private async getSemanticScores(query: string): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (!this.embeddingService || !this.embeddingService.isReady()) return map
    const results = await this.embeddingService.searchSemantic(query, 30)
    for (const result of results) {
      if (result.score >= MIN_SEMANTIC_SIMILARITY) {
        map.set(result.memoryId, result.score)
      }
    }
    return map
  }

  private buildMemoryResult(
    memory: MemoryRecord,
    tokens: string[],
    normalizedQuery: string,
    sessionFolderName: string | undefined,
    artifactById: Map<string, ArtifactRecord>,
    semanticScoreMap: Map<string, number>
  ): RecallResult | null {
    const title = normalizeSearchText(memory.title)
    const summary = normalizeSearchText(memory.summary)
    const content = normalizeSearchText(memory.content || '')
    const tags = normalizeSearchText((memory.tags || []).join(' '))
    const metadata = normalizeSearchText(Object.values(memory.metadata || {}).join(' '))
    const session = normalizeSearchText(memory.sessionFolderName || '')
    const titleTokens = tokenize(title)
    const summaryTokens = tokenize(summary)
    const contentTokens = tokenize(content)
    const tagTokens = tokenize(tags)
    const metadataTokens = tokenize(metadata)
    const sessionTokens = tokenize(session)
    const typeTokens = tokenize(memory.type)

    let score = 0
    const matchedTerms = new Set<string>()
    const titleWeight = isLowSignalMemoryTitle(title) ? 0.45 : 1

    if (title.includes(normalizedQuery)) {
      score += 6 * titleWeight
      matchedTerms.add(normalizedQuery)
    }
    if (summary.includes(normalizedQuery)) {
      score += 4
      matchedTerms.add(normalizedQuery)
    }
    if (content.includes(normalizedQuery)) {
      score += 2.5
      matchedTerms.add(normalizedQuery)
    }

    for (const token of tokens) {
      if (titleTokens.includes(token)) {
        score += 2.2 * titleWeight
        addMatchedTerm(matchedTerms, token)
      }
      if (summaryTokens.includes(token)) {
        score += 1.6
        addMatchedTerm(matchedTerms, token)
      }
      if (contentTokens.includes(token)) {
        score += 1.1
        addMatchedTerm(matchedTerms, token)
      }
      if (tagTokens.includes(token)) {
        score += 1.8
        addMatchedTerm(matchedTerms, token)
      }
      if (metadataTokens.includes(token)) {
        score += 0.8
        addMatchedTerm(matchedTerms, token)
      }
      if (sessionTokens.includes(token)) {
        score += 0.8
        addMatchedTerm(matchedTerms, token)
      }
      if (typeTokens.includes(token)) {
        score += 0.9
        addMatchedTerm(matchedTerms, token)
      }
    }

    if (sessionFolderName && memory.sessionFolderName === sessionFolderName) {
      score += 2
    }

    score += recencyScore(memory.updatedAt ?? memory.createdAt)
    score += Math.max(0, memory.confidence ?? 0) * 1.5

    const semanticSimilarity = semanticScoreMap.get(memory.id) ?? 0
    const semanticScore = semanticSimilarity * SEMANTIC_SCORE_SCALE

    if (semanticScore > 0 && score > 0) {
      score = KEYWORD_WEIGHT * score + SEMANTIC_WEIGHT * semanticScore
    } else if (semanticScore > 0) {
      score = semanticScore * 0.85
    }

    const informativeMatchCount = countInformativeMatches(matchedTerms)
    const hasSemanticMatch = semanticSimilarity >= MIN_SEMANTIC_SIMILARITY
    if (!hasSemanticMatch && (matchedTerms.size === 0 || informativeMatchCount === 0 || score < 3)) {
      return null
    }

    return {
      id: memory.id,
      kind: 'memory',
      score: roundScore(score),
      createdAt: memory.createdAt,
      title: memory.title,
      summary: memory.summary,
      matchedTerms: sortMatchedTerms(matchedTerms),
      memory,
      linkedArtifacts: (memory.sourceArtifactIds || [])
        .map((artifactId) => artifactById.get(artifactId))
        .filter((artifact): artifact is ArtifactRecord => Boolean(artifact)),
    }
  }

  private buildArtifactResult(
    artifact: ArtifactRecord,
    tokens: string[],
    normalizedQuery: string,
    sessionFolderName: string | undefined
  ): RecallResult | null {
    const pathText = normalizeSearchText(`${artifact.relativePath || ''} ${artifact.absolutePath}`)
    const session = normalizeSearchText(artifact.sessionFolderName || '')
    const metadata = normalizeSearchText(Object.values(artifact.metadata || {}).join(' '))
    const pathTokens = tokenize(pathText)
    const sessionTokens = tokenize(session)
    const metadataTokens = tokenize(metadata)
    const typeTokens = tokenize(artifact.type)

    let score = 0
    const matchedTerms = new Set<string>()

    if (pathText.includes(normalizedQuery)) {
      score += 4.5
      matchedTerms.add(normalizedQuery)
    }
    if (metadata.includes(normalizedQuery)) {
      score += 2
      matchedTerms.add(normalizedQuery)
    }

    for (const token of tokens) {
      if (pathTokens.includes(token)) {
        score += 1.7
        addMatchedTerm(matchedTerms, token)
      }
      if (typeTokens.includes(token)) {
        score += 1.2
        addMatchedTerm(matchedTerms, token)
      }
      if (sessionTokens.includes(token)) {
        score += 0.8
        addMatchedTerm(matchedTerms, token)
      }
      if (metadataTokens.includes(token)) {
        score += 0.7
        addMatchedTerm(matchedTerms, token)
      }
    }

    if (sessionFolderName && artifact.sessionFolderName === sessionFolderName) {
      score += 1.5
    }

    score += ARTIFACT_TYPE_BOOSTS[artifact.type] ?? 0
    score += recencyScore(artifact.createdAt) * 0.8

    const informativeMatchCount = countInformativeMatches(matchedTerms)
    const hasStrongPhraseMatch = pathText.includes(normalizedQuery) || metadata.includes(normalizedQuery)
    if (matchedTerms.size === 0 || score < 2.8 || (!hasStrongPhraseMatch && informativeMatchCount < 2)) {
      return null
    }

    return {
      id: artifact.id,
      kind: 'artifact',
      score: roundScore(score),
      createdAt: artifact.createdAt,
      title: artifact.relativePath || artifact.absolutePath,
      summary: artifact.type,
      matchedTerms: sortMatchedTerms(matchedTerms),
      artifact,
    }
  }
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(TOKEN_SPLIT_REGEX)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !LOW_SIGNAL_MATCH_TERMS.has(token))
    )
  )
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function recencyScore(timestamp: number): number {
  const ageMs = Math.max(0, Date.now() - timestamp)
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.max(0, 1.75 - ageDays / 14)
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100
}

function addMatchedTerm(matchedTerms: Set<string>, term: string): void {
  if (!LOW_SIGNAL_MATCH_TERMS.has(term)) {
    matchedTerms.add(term)
  }
}

function countInformativeMatches(matchedTerms: Set<string>): number {
  return Array.from(matchedTerms).filter((term) => !LOW_SIGNAL_MATCH_TERMS.has(term)).length
}

function sortMatchedTerms(matchedTerms: Set<string>): string[] {
  return Array.from(matchedTerms)
    .filter((term) => !LOW_SIGNAL_MATCH_TERMS.has(term))
    .sort((left, right) => right.length - left.length)
}

function isLowSignalMemoryTitle(title: string): boolean {
  return LOW_SIGNAL_MEMORY_TITLES.some((candidate) => title.startsWith(candidate))
}
