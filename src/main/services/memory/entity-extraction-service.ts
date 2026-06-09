import {
  EntityRecord,
  MemoryRecord,
  WhisphryEntityType,
} from '@shared/types'

type EntityCandidate = Omit<EntityRecord, 'id'>

const TOOL_KEYWORDS: Array<{ label: string; matches: string[] }> = [
  { label: 'Electron', matches: ['electron'] },
  { label: 'React', matches: ['react'] },
  { label: 'TypeScript', matches: ['typescript', 'ts'] },
  { label: 'JavaScript', matches: ['javascript', 'js'] },
  { label: 'Node.js', matches: ['node', 'nodejs', 'node.js'] },
  { label: 'Vite', matches: ['vite'] },
  { label: 'Tailwind', matches: ['tailwind', 'tailwindcss'] },
  { label: 'Next.js', matches: ['next.js', 'nextjs'] },
  { label: 'Express', matches: ['express', 'expressjs'] },
  { label: 'Deepgram', matches: ['deepgram'] },
  { label: 'OpenRouter', matches: ['openrouter'] },
  { label: 'SQLite', matches: ['sqlite'] },
  { label: 'PostgreSQL', matches: ['postgresql', 'postgres', 'psql'] },
  { label: 'MongoDB', matches: ['mongodb', 'mongo'] },
  { label: 'Redis', matches: ['redis'] },
  { label: 'Python', matches: ['python'] },
  { label: 'Docker', matches: ['docker'] },
  { label: 'Git', matches: ['git'] },
  { label: 'GitHub', matches: ['github'] },
  { label: 'Figma', matches: ['figma'] },
  { label: 'Playwright', matches: ['playwright'] },
  { label: 'Tesseract', matches: ['tesseract'] },
  { label: 'Whisper', matches: ['whisper'] },
  { label: 'AWS', matches: ['aws', 'amazon web services'] },
  { label: 'Vercel', matches: ['vercel'] },
  { label: 'Supabase', matches: ['supabase'] },
  { label: 'VS Code', matches: ['vscode', 'vs code'] },
  { label: 'npm', matches: ['npm'] },
]

export class EntityExtractionService {
  extractFromMemory(memory: MemoryRecord): EntityCandidate[] {
    const candidates: EntityCandidate[] = []
    const metadata = memory.metadata || {}
    const text = normalizeText([
      memory.title,
      memory.summary,
      memory.content,
      memory.tags?.join(' '),
    ]
      .filter(Boolean)
      .join(' '))

    const companyName = readMetadataString(metadata.companyName)
    if (companyName) {
      candidates.push(this.buildCandidate('company', companyName, memory, `Company referenced by memory “${memory.title}”.`))
    }

    const subject = readMetadataString(metadata.subject)
    if (subject) {
      candidates.push(this.buildCandidate('topic', subject, memory, `Topic derived from memory subject for “${memory.title}”.`))
    }

    const roleName = readMetadataString(metadata.roleName)
    if (roleName) {
      candidates.push(this.buildCandidate('topic', roleName, memory, `Role referenced by memory "${memory.title}".`))
    }

    const interviewType = readMetadataString(metadata.interviewType)
    if (interviewType) {
      candidates.push(this.buildCandidate('routine', formatRoutineName(interviewType), memory, `Routine context inferred from ${interviewType} capture.`))
    }

    for (const tool of TOOL_KEYWORDS) {
      if (tool.matches.some((token) => includesToken(text, token))) {
        candidates.push(this.buildCandidate('tool', tool.label, memory, `Tool mentioned in memory “${memory.title}”.`))
      }
    }

    return dedupeCandidates(candidates)
  }

  private buildCandidate(
    type: WhisphryEntityType,
    name: string,
    memory: MemoryRecord,
    summary: string
  ): EntityCandidate {
    return {
      type,
      name,
      normalizedName: normalizeEntityName(name),
      createdAt: memory.updatedAt ?? memory.createdAt,
      updatedAt: memory.updatedAt ?? memory.createdAt,
      summary,
      sourceMemoryIds: [memory.id],
      sessionFolderNames: memory.sessionFolderName ? [memory.sessionFolderName] : undefined,
      tags: ['entity', 'memory-derived', type],
      metadata: {
        memoryType: memory.type,
        memoryStatus: memory.status,
      },
    }
  }
}

function dedupeCandidates(candidates: EntityCandidate[]): EntityCandidate[] {
  const byKey = new Map<string, EntityCandidate>()

  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.normalizedName}`
    if (!byKey.has(key)) {
      byKey.set(key, candidate)
    }
  }

  return Array.from(byKey.values())
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeEntityName(value: string): string {
  return value.toLowerCase().replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function readMetadataString(value: string | number | boolean | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function formatRoutineName(interviewType: string): string {
  const compact = interviewType.replace(/[-_]+/g, ' ').trim()
  return `${compact.charAt(0).toUpperCase()}${compact.slice(1)} interview`
}

function includesToken(text: string, token: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(token.toLowerCase())}(\\s|$)`, 'i').test(text)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
