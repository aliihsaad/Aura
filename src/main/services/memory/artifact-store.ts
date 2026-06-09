import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  ArtifactListFilters,
  ArtifactRecord,
  WhisphryArtifactType,
  WhisphryEventType,
} from '@shared/types'

interface CreateArtifactParams {
  type: WhisphryArtifactType
  createdAt?: number
  sessionId?: string
  sessionFolderName?: string
  absolutePath: string
  relativePath?: string
  mimeType?: string
  sourceEventId?: string
  sourceEventType?: WhisphryEventType
  metadata?: Record<string, string | number | boolean | null>
}

export class ArtifactStore {
  private getArtifactsDir(): string {
    return path.join(app.getPath('userData'), 'artifacts')
  }

  init(): void {
    fs.mkdirSync(this.getArtifactsDir(), { recursive: true })
  }

  createArtifact(params: CreateArtifactParams): ArtifactRecord {
    return {
      id: randomUUID(),
      type: params.type,
      createdAt: params.createdAt ?? Date.now(),
      sessionId: params.sessionId,
      sessionFolderName: params.sessionFolderName,
      absolutePath: params.absolutePath,
      relativePath: params.relativePath,
      mimeType: params.mimeType,
      sourceEventId: params.sourceEventId,
      sourceEventType: params.sourceEventType,
      metadata: params.metadata,
    }
  }

  append(artifact: ArtifactRecord): void {
    this.init()
    const line = JSON.stringify(artifact)
    fs.appendFileSync(this.getPartitionPath(artifact.createdAt), `${line}\n`, 'utf-8')
  }

  listRecent(filters: ArtifactListFilters = {}): ArtifactRecord[] {
    this.init()
    const limit = filters.limit ?? 50
    const types = filters.types
    const query = normalizeQuery(filters.query)
    const latestById = new Map<string, ArtifactRecord>()

    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getArtifactsDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const artifact = JSON.parse(lines[index]) as ArtifactRecord
          if (!latestById.has(artifact.id)) {
            latestById.set(artifact.id, artifact)
          }
        } catch (error) {
          console.warn('[ArtifactStore] Failed to parse artifact line:', error)
        }
      }
    }

    return Array.from(latestById.values())
      .filter((artifact) => this.matchesFilters(artifact, types, filters.sessionFolderName, query))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  getByIds(ids: string[]): ArtifactRecord[] {
    if (ids.length === 0) return []

    const uniqueIds = new Set(ids)
    const results = new Map<string, ArtifactRecord>()

    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getArtifactsDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const artifact = JSON.parse(lines[index]) as ArtifactRecord
          if (uniqueIds.has(artifact.id) && !results.has(artifact.id)) {
            results.set(artifact.id, artifact)
          }
        } catch (error) {
          console.warn('[ArtifactStore] Failed to parse artifact line:', error)
        }
      }

      if (results.size >= uniqueIds.size) {
        break
      }
    }

    return ids
      .map((id) => results.get(id))
      .filter((artifact): artifact is ArtifactRecord => Boolean(artifact))
  }

  getById(id: string): ArtifactRecord | null {
    const result = this.getByIds([id])
    return result[0] ?? null
  }

  private getPartitionPath(timestamp: number): string {
    const dateKey = new Date(timestamp).toISOString().slice(0, 10)
    return path.join(this.getArtifactsDir(), `${dateKey}.jsonl`)
  }

  private getPartitionFilesDescending(): string[] {
    return fs
      .readdirSync(this.getArtifactsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))
  }

  private matchesFilters(
    artifact: ArtifactRecord,
    types?: WhisphryArtifactType[],
    sessionFolderName?: string,
    query?: string
  ): boolean {
    if (types && types.length > 0 && !types.includes(artifact.type)) {
      return false
    }

    if (sessionFolderName && artifact.sessionFolderName !== sessionFolderName) {
      return false
    }

    if (!query) {
      return true
    }

    const haystack = [
      artifact.type,
      artifact.relativePath,
      artifact.absolutePath,
      artifact.sessionFolderName,
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
