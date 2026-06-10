import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { EventRecord, AuraEventPayload, AuraEventSource, AuraEventType } from '@shared/types'

interface CreateEventParams<TPayload = AuraEventPayload> {
  type: AuraEventType
  source: AuraEventSource
  createdAt?: number
  sessionId?: string
  sessionFolderName?: string
  payload: TPayload
}

export class EventStore {
  private getEventsDir(): string {
    return path.join(app.getPath('userData'), 'events')
  }

  init(): void {
    fs.mkdirSync(this.getEventsDir(), { recursive: true })
  }

  createEvent<TPayload = AuraEventPayload>(params: CreateEventParams<TPayload>): EventRecord<TPayload> {
    return {
      id: randomUUID(),
      type: params.type,
      source: params.source,
      createdAt: params.createdAt ?? Date.now(),
      sessionId: params.sessionId,
      sessionFolderName: params.sessionFolderName,
      payload: params.payload,
    }
  }

  append(event: EventRecord): void {
    this.init()
    const line = JSON.stringify(event)
    fs.appendFileSync(this.getPartitionPath(event.createdAt), `${line}\n`, 'utf-8')
  }

  count(): number {
    this.init()
    const eventsDir = this.getEventsDir()
    let total = 0
    try {
      const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl'))
      for (const file of files) {
        const content = fs.readFileSync(path.join(eventsDir, file), 'utf-8')
        total += content.split('\n').filter((line) => line.trim().length > 0).length
      }
    } catch {
      // eventsDir may not exist yet; return 0
    }
    return total
  }

  private getPartitionPath(timestamp: number): string {
    const dateKey = new Date(timestamp).toISOString().slice(0, 10)
    return path.join(this.getEventsDir(), `${dateKey}.jsonl`)
  }
}
