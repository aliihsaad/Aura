import {
  ArtifactRecord,
  EventRecord,
  MemoryRecord,
  SessionContext,
  TranscriptFinalizedEventPayload,
  WhisphryArtifactType,
  WhisphryEventPayload,
  WhisphryEventSource,
  WhisphryEventType,
} from '@shared/types'
import * as path from 'path'
import { ArtifactStore } from './artifact-store'
import { EventStore } from './event-store'
import { ExtractionService } from './extraction-service'
import { MemoryStore } from './memory-store'

interface RecordEventParams<TPayload = WhisphryEventPayload> {
  type: WhisphryEventType
  source: WhisphryEventSource
  createdAt?: number
  sessionId?: string
  sessionFolderName?: string
  payload: TPayload
}

interface RegisterArtifactParams {
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

export class MemoryPipelineService {
  constructor(
    private readonly eventStore: EventStore,
    private readonly artifactStore: ArtifactStore,
    private readonly memoryStore: MemoryStore,
    private readonly extractionService: ExtractionService,
    private readonly getAppDataPath: () => string,
    private readonly onMemoryPersisted?: (memory: MemoryRecord) => void
  ) {}

  recordEvent<TPayload = WhisphryEventPayload>(
    params: RecordEventParams<TPayload>,
    sessionContext?: SessionContext
  ): EventRecord<TPayload> | undefined {
    try {
      const event = this.eventStore.createEvent(params)
      this.eventStore.append(event as unknown as EventRecord<WhisphryEventPayload>)

      if (event.type === 'transcript.finalized') {
        this.persistExtractedMemories(
          this.extractionService.extractFromTranscriptEvent(
            event as unknown as EventRecord<TranscriptFinalizedEventPayload>,
            sessionContext
          )
        )
      }

      return event
    } catch (error) {
      console.error('[EventStore] Failed to record event:', error)
      return undefined
    }
  }

  registerArtifact(params: RegisterArtifactParams): ArtifactRecord | undefined {
    try {
      const artifact = this.artifactStore.createArtifact(params)
      this.artifactStore.append(artifact)
      this.persistExtractedMemories(this.extractionService.extractFromArtifact(artifact))
      return artifact
    } catch (error) {
      console.error('[ArtifactStore] Failed to register artifact:', error)
      return undefined
    }
  }

  getSessionArtifactAbsolutePath(folderName: string, pathSegments: string[]): string {
    return path.join(this.getAppDataPath(), 'sessions', folderName, ...pathSegments)
  }

  getSessionArtifactRelativePath(folderName: string, pathSegments: string[]): string {
    return ['sessions', folderName, ...pathSegments].join('/')
  }

  private persistExtractedMemories(memories: Array<Omit<MemoryRecord, 'id'>>): void {
    for (const memoryInput of memories) {
      try {
        const memory = this.memoryStore.createMemory(memoryInput)
        this.memoryStore.append(memory)
        this.onMemoryPersisted?.(memory)
      } catch (error) {
        console.error('[MemoryStore] Failed to persist extracted memory:', error)
      }
    }
  }
}
