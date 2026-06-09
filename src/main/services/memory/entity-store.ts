import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  EntityListFilters,
  EntityRecord,
  WhisphryEntityType,
} from '@shared/types'

interface CreateEntityParams {
  type: WhisphryEntityType
  name: string
  normalizedName: string
  createdAt?: number
  updatedAt?: number
  summary?: string
  sourceMemoryIds?: string[]
  sourceArtifactIds?: string[]
  sourceEventIds?: string[]
  sessionFolderNames?: string[]
  aliases?: string[]
  tags?: string[]
  metadata?: Record<string, string | number | boolean | null>
}

export class EntityStore {
  private getEntitiesDir(): string {
    return path.join(app.getPath('userData'), 'entities')
  }

  init(): void {
    fs.mkdirSync(this.getEntitiesDir(), { recursive: true })
  }

  createEntity(params: CreateEntityParams): EntityRecord {
    const createdAt = params.createdAt ?? Date.now()
    return {
      id: randomUUID(),
      type: params.type,
      name: params.name,
      normalizedName: params.normalizedName,
      createdAt,
      updatedAt: params.updatedAt ?? createdAt,
      summary: params.summary,
      sourceMemoryIds: params.sourceMemoryIds,
      sourceArtifactIds: params.sourceArtifactIds,
      sourceEventIds: params.sourceEventIds,
      sessionFolderNames: params.sessionFolderNames,
      aliases: params.aliases,
      tags: params.tags,
      metadata: params.metadata,
    }
  }

  append(entity: EntityRecord): void {
    this.init()
    fs.appendFileSync(this.getPartitionPath(entity.updatedAt ?? entity.createdAt), `${JSON.stringify(entity)}\n`, 'utf-8')
  }

  upsert(params: CreateEntityParams): EntityRecord {
    this.init()

    const existing = this.getLatestByTypeAndNormalizedName(params.type, params.normalizedName)
    if (!existing) {
      const created = this.createEntity(params)
      this.append(created)
      return created
    }

    const merged = mergeEntity(existing, params)
    if (entitiesEquivalent(existing, merged)) {
      return existing
    }

    this.append(merged)
    return merged
  }

  listRecent(filters: EntityListFilters = {}): EntityRecord[] {
    this.init()
    const limit = filters.limit ?? 50
    const types = filters.types
    const query = normalizeQuery(filters.query)
    const latestById = new Map<string, EntityRecord>()

    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getEntitiesDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const entity = JSON.parse(lines[index]) as EntityRecord
          if (!latestById.has(entity.id)) {
            latestById.set(entity.id, entity)
          }
        } catch (error) {
          console.warn('[EntityStore] Failed to parse entity line:', error)
        }
      }
    }

    return Array.from(latestById.values())
      .filter((entity) => this.matchesFilters(entity, types, query))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, limit)
  }

  private getLatestByTypeAndNormalizedName(
    type: WhisphryEntityType,
    normalizedName: string
  ): EntityRecord | null {
    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getEntitiesDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const entity = JSON.parse(lines[index]) as EntityRecord
          if (entity.type === type && entity.normalizedName === normalizedName) {
            return entity
          }
        } catch (error) {
          console.warn('[EntityStore] Failed to parse entity line:', error)
        }
      }
    }

    return null
  }

  private getPartitionPath(timestamp: number): string {
    const dateKey = new Date(timestamp).toISOString().slice(0, 10)
    return path.join(this.getEntitiesDir(), `${dateKey}.jsonl`)
  }

  private getPartitionFilesDescending(): string[] {
    return fs
      .readdirSync(this.getEntitiesDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))
  }

  private matchesFilters(
    entity: EntityRecord,
    types?: WhisphryEntityType[],
    query?: string
  ): boolean {
    if (types && types.length > 0 && !types.includes(entity.type)) {
      return false
    }

    if (!query) {
      return true
    }

    const haystack = [
      entity.type,
      entity.name,
      entity.summary,
      entity.aliases?.join(' '),
      entity.tags?.join(' '),
      entity.sessionFolderNames?.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(query)
  }
}

function mergeEntity(existing: EntityRecord, updates: CreateEntityParams): EntityRecord {
  const updatedAt = Date.now()

  return {
    ...existing,
    name: pickPreferredName(existing.name, updates.name),
    summary: pickPreferredSummary(existing.summary, updates.summary),
    sourceMemoryIds: mergeStringArrays(existing.sourceMemoryIds, updates.sourceMemoryIds),
    sourceArtifactIds: mergeStringArrays(existing.sourceArtifactIds, updates.sourceArtifactIds),
    sourceEventIds: mergeStringArrays(existing.sourceEventIds, updates.sourceEventIds),
    sessionFolderNames: mergeStringArrays(existing.sessionFolderNames, updates.sessionFolderNames),
    aliases: mergeStringArrays(existing.aliases, updates.aliases),
    tags: mergeStringArrays(existing.tags, updates.tags),
    metadata: mergeMetadata(existing.metadata, updates.metadata),
    updatedAt,
  }
}

function mergeStringArrays(
  current?: string[],
  incoming?: string[]
): string[] | undefined {
  const merged = Array.from(new Set([...(current || []), ...(incoming || [])].filter(Boolean)))
  return merged.length > 0 ? merged : undefined
}

function mergeMetadata(
  current?: Record<string, string | number | boolean | null>,
  incoming?: Record<string, string | number | boolean | null>
): Record<string, string | number | boolean | null> | undefined {
  if (!current && !incoming) return undefined
  return {
    ...(current || {}),
    ...(incoming || {}),
  }
}

function pickPreferredName(current: string, incoming: string): string {
  return incoming.trim().length > current.trim().length ? incoming : current
}

function pickPreferredSummary(current?: string, incoming?: string): string | undefined {
  if (!current) return incoming
  if (!incoming) return current
  return incoming.length > current.length ? incoming : current
}

function entitiesEquivalent(left: EntityRecord, right: EntityRecord): boolean {
  return JSON.stringify(left) === JSON.stringify({
    ...right,
    updatedAt: left.updatedAt,
  })
}

function normalizeQuery(query?: string): string | undefined {
  const normalized = query?.trim().toLowerCase()
  return normalized ? normalized : undefined
}
