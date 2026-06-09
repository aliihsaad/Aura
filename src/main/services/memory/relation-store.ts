import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  RelationEndpointKind,
  RelationListFilters,
  RelationRecord,
  WhisphryRelationType,
} from '@shared/types'

interface CreateRelationParams {
  type: WhisphryRelationType
  sourceKind: RelationEndpointKind
  sourceId: string
  targetKind: RelationEndpointKind
  targetId: string
  createdAt?: number
  sessionFolderName?: string
  metadata?: Record<string, string | number | boolean | null>
}

export class RelationStore {
  private getRelationsDir(): string {
    return path.join(app.getPath('userData'), 'relations')
  }

  init(): void {
    fs.mkdirSync(this.getRelationsDir(), { recursive: true })
  }

  createRelation(params: CreateRelationParams): RelationRecord {
    return {
      id: randomUUID(),
      type: params.type,
      sourceKind: params.sourceKind,
      sourceId: params.sourceId,
      targetKind: params.targetKind,
      targetId: params.targetId,
      createdAt: params.createdAt ?? Date.now(),
      sessionFolderName: params.sessionFolderName,
      metadata: params.metadata,
    }
  }

  append(relation: RelationRecord): void {
    this.init()
    fs.appendFileSync(this.getPartitionPath(relation.createdAt), `${JSON.stringify(relation)}\n`, 'utf-8')
  }

  upsert(params: CreateRelationParams): RelationRecord {
    this.init()

    const existing = this.findExisting(
      params.type,
      params.sourceKind,
      params.sourceId,
      params.targetKind,
      params.targetId
    )
    if (existing) {
      return existing
    }

    const created = this.createRelation(params)
    this.append(created)
    return created
  }

  listRecent(filters: RelationListFilters = {}): RelationRecord[] {
    this.init()
    const limit = filters.limit ?? 200
    const latestById = new Map<string, RelationRecord>()

    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getRelationsDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const relation = JSON.parse(lines[index]) as RelationRecord
          if (!latestById.has(relation.id)) {
            latestById.set(relation.id, relation)
          }
        } catch (error) {
          console.warn('[RelationStore] Failed to parse relation line:', error)
        }
      }
    }

    return Array.from(latestById.values())
      .filter((relation) => this.matchesFilters(relation, filters))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  listForSource(sourceKind: RelationEndpointKind, sourceId: string): RelationRecord[] {
    return this.listRecent({ sourceKind, sourceId, limit: 200 })
  }

  listForTarget(targetKind: RelationEndpointKind, targetId: string): RelationRecord[] {
    return this.listRecent({ targetKind, targetId, limit: 200 })
  }

  private findExisting(
    type: WhisphryRelationType,
    sourceKind: RelationEndpointKind,
    sourceId: string,
    targetKind: RelationEndpointKind,
    targetId: string
  ): RelationRecord | null {
    for (const file of this.getPartitionFilesDescending()) {
      const filePath = path.join(this.getRelationsDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const relation = JSON.parse(lines[index]) as RelationRecord
          if (
            relation.type === type &&
            relation.sourceKind === sourceKind &&
            relation.sourceId === sourceId &&
            relation.targetKind === targetKind &&
            relation.targetId === targetId
          ) {
            return relation
          }
        } catch (error) {
          console.warn('[RelationStore] Failed to parse relation line:', error)
        }
      }
    }

    return null
  }

  private getPartitionPath(timestamp: number): string {
    const dateKey = new Date(timestamp).toISOString().slice(0, 10)
    return path.join(this.getRelationsDir(), `${dateKey}.jsonl`)
  }

  private getPartitionFilesDescending(): string[] {
    return fs
      .readdirSync(this.getRelationsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))
  }

  private matchesFilters(
    relation: RelationRecord,
    filters: RelationListFilters
  ): boolean {
    if (filters.types && filters.types.length > 0 && !filters.types.includes(relation.type)) {
      return false
    }

    if (filters.sourceKind && relation.sourceKind !== filters.sourceKind) {
      return false
    }

    if (filters.sourceId && relation.sourceId !== filters.sourceId) {
      return false
    }

    if (filters.targetKind && relation.targetKind !== filters.targetKind) {
      return false
    }

    if (filters.targetId && relation.targetId !== filters.targetId) {
      return false
    }

    return true
  }
}
