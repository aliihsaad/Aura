import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { EmbeddingRecord } from '@shared/types'

export class EmbeddingStore {
  private getEmbeddingsDir(): string {
    return path.join(app.getPath('userData'), 'embeddings')
  }

  init(): void {
    fs.mkdirSync(this.getEmbeddingsDir(), { recursive: true })
  }

  append(record: EmbeddingRecord): void {
    this.init()
    const line = JSON.stringify(record)
    fs.appendFileSync(this.getPartitionPath(record.createdAt), `${line}\n`, 'utf-8')
  }

  loadAll(): EmbeddingRecord[] {
    this.init()
    const records: EmbeddingRecord[] = []

    for (const file of this.getPartitionFiles()) {
      const filePath = path.join(this.getEmbeddingsDir(), file)
      const lines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as EmbeddingRecord)
        } catch (error) {
          console.warn('[EmbeddingStore] Failed to parse embedding line:', error)
        }
      }
    }

    return records
  }

  getEmbeddedMemoryIds(): Set<string> {
    const ids = new Set<string>()
    for (const record of this.loadAll()) {
      ids.add(record.memoryId)
    }
    return ids
  }

  private getPartitionPath(timestamp: number): string {
    const dateKey = new Date(timestamp).toISOString().slice(0, 10)
    return path.join(this.getEmbeddingsDir(), `${dateKey}.jsonl`)
  }

  private getPartitionFiles(): string[] {
    return fs
      .readdirSync(this.getEmbeddingsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  }
}
