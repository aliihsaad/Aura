import { EntityRecord, MemoryRecord, WhisphryRelationType } from '@shared/types'
import { EntityExtractionService } from './entity-extraction-service'
import { EntityStore } from './entity-store'
import { RelationStore } from './relation-store'

export class EntityGraphService {
  constructor(
    private readonly entityStore: EntityStore,
    private readonly entityExtractionService: EntityExtractionService,
    private readonly relationStore: RelationStore
  ) {}

  syncMemory(memory: MemoryRecord): EntityRecord[] {
    const candidates = this.entityExtractionService.extractFromMemory(memory)
    const entities = candidates.map((candidate) => this.entityStore.upsert(candidate))

    for (const entity of entities) {
      this.relationStore.upsert({
        type: inferRelationType(entity),
        sourceKind: 'memory',
        sourceId: memory.id,
        targetKind: 'entity',
        targetId: entity.id,
        sessionFolderName: memory.sessionFolderName,
        metadata: {
          entityType: entity.type,
          entityName: entity.name,
          memoryType: memory.type,
        },
      })
    }

    return entities
  }

  backfillMemories(memories: MemoryRecord[]): void {
    for (const memory of memories) {
      try {
        this.syncMemory(memory)
      } catch (error) {
        console.error('[EntityGraph] Failed to sync memory entities:', error)
      }
    }
  }
}

function inferRelationType(entity: EntityRecord): WhisphryRelationType {
  if (entity.type === 'company' || entity.type === 'topic') {
    return 'about'
  }
  if (entity.type === 'tool') {
    return 'mentions'
  }
  return 'derived-from'
}
