import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  MemoryListFilters,
  MemoryRecord,
  MemoryUpdateInput,
  WhisphryMemoryStatus,
  WhisphryMemoryType,
} from '@shared/types'

interface CreateMemoryParams {
  type: WhisphryMemoryType
  title: string
  summary: string
  content?: string
  status?: WhisphryMemoryStatus
  createdAt?: number
  sessionId?: string
  sessionFolderName?: string
  confidence?: number
  sourceEventIds?: string[]
  sourceArtifactIds?: string[]
  tags?: string[]
  metadata?: Record<string, string | number | boolean | null>
}

export class MemoryStore {
  private getMemoriesDir(): string {
    return path.join(app.getPath('userData'), 'memories')
  }

  init(): void {
    fs.mkdirSync(this.getMemoriesDir(), { recursive: true })
  }

  createMemory(params: CreateMemoryParams): MemoryRecord {
    const createdAt = params.createdAt ?? Date.now()
    return {
      id: randomUUID(),
      type: params.type,
      status: params.status ?? 'draft',
      createdAt,
      updatedAt: createdAt,
      sessionId: params.sessionId,
      sessionFolderName: params.sessionFolderName,
      title: params.title,
      summary: params.summary,
      content: params.content,
      confidence: params.confidence,
      sourceEventIds: params.sourceEventIds,
      sourceArtifactIds: params.sourceArtifactIds,
      tags: params.tags,
      metadata: params.metadata,
    }
  }

  append(memory: MemoryRecord): void {
    this.init()
    const line = JSON.stringify(memory)
    fs.appendFileSync(this.getPartitionPath(memory.updatedAt ?? memory.createdAt), `${line}\n`, 'utf-8')
  }

  updateStatus(id: string, status: WhisphryMemoryStatus): MemoryRecord | null {
    return this.updateMemory(id, { status })
  }

  updateMemory(
    id: string,
    updates: MemoryUpdateInput & { status?: WhisphryMemoryStatus }
  ): MemoryRecord | null {
    this.init()
    const existing = this.getLatestById(id)
    if (!existing) return null

    const updatedAt = Date.now()
    const updatedRecord: MemoryRecord = {
      ...existing,
      status: updates.status ?? existing.status,
      type: updates.type ?? existing.type,
      title: normalizeRequiredText(updates.title, existing.title),
      summary: normalizeRequiredText(updates.summary, existing.summary),
      content: normalizeOptionalText(updates.content, existing.content),
      tags: normalizeTags(updates.tags, existing.tags),
      updatedAt,
    }

    this.append(updatedRecord)
    return updatedRecord
  }

  listRecent(filters: MemoryListFilters = {}): MemoryRecord[] {
    this.init()
    const limit = filters.limit ?? 50
    const statuses = filters.statuses
    const types = filters.types
    const query = normalizeQuery(filters.query)

    const latestById = new Map<string, MemoryRecord>()

    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getMemoriesDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const memory = JSON.parse(lines[index]) as MemoryRecord
          if (!latestById.has(memory.id)) {
            latestById.set(memory.id, memory)
          }
        } catch (error) {
          console.warn('[MemoryStore] Failed to parse memory line:', error)
        }
      }
    }

    return Array.from(latestById.values())
      .filter((memory) => this.matchesFilters(memory, statuses, types, query))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, limit)
  }

  private getPartitionPath(timestamp: number): string {
    const dateKey = new Date(timestamp).toISOString().slice(0, 10)
    return path.join(this.getMemoriesDir(), `${dateKey}.jsonl`)
  }

  private getLatestById(id: string): MemoryRecord | null {
    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getMemoriesDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const memory = JSON.parse(lines[index]) as MemoryRecord
          if (memory.id === id) {
            return memory
          }
        } catch (error) {
          console.warn('[MemoryStore] Failed to parse memory line:', error)
        }
      }
    }

    return null
  }

  private getPartitionFilesDescending(): string[] {
    return fs
      .readdirSync(this.getMemoriesDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))
  }

  private matchesFilters(
    memory: MemoryRecord,
    statuses?: WhisphryMemoryStatus[],
    types?: WhisphryMemoryType[],
    query?: string
  ): boolean {
    if (statuses && statuses.length > 0 && !statuses.includes(memory.status)) {
      return false
    }

    if (types && types.length > 0 && !types.includes(memory.type)) {
      return false
    }

    if (!query) {
      return true
    }

    const haystack = [
      memory.title,
      memory.summary,
      memory.content,
      memory.tags?.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  }
}

function normalizeQuery(query?: string): string | undefined {
  const normalized = query?.trim().toLowerCase()
  return normalized ? normalized : undefined
}

function normalizeRequiredText(nextValue: string | undefined, fallback: string): string {
  const normalized = nextValue?.trim()
  return normalized ? normalized : fallback
}

function normalizeOptionalText(nextValue: string | undefined, fallback?: string): string | undefined {
  if (nextValue === undefined) {
    return fallback
  }

  const normalized = nextValue.trim()
  return normalized ? normalized : undefined
}

function normalizeTags(nextValue: string[] | undefined, fallback?: string[]): string[] | undefined {
  if (!nextValue) {
    return fallback
  }

  const normalized = Array.from(
    new Set(
      nextValue
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  )

  return normalized.length > 0 ? normalized : undefined
}
