import { randomUUID } from 'crypto'
import { EmbeddingRecord, MemoryRecord } from '@shared/types'
import { EmbeddingStore } from './embedding-store'

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const VECTOR_DIM = 384
const EMBED_TEXT_MAX_LENGTH = 512

// ── Internal types ────────────────────────────────────────────────────────────

interface CachedEmbedding {
  memoryId: string
  vector: Float32Array
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Build the text to embed for a memory record.
 * Joins title, summary, content (if present), and tags (if present).
 */
export function buildEmbeddingText(memory: MemoryRecord): string {
  const parts: string[] = [memory.title, memory.summary]
  if (memory.content) parts.push(memory.content)
  if (memory.tags && memory.tags.length > 0) parts.push(memory.tags.join(', '))
  return parts.join('. ')
}

/**
 * Compute cosine similarity between two Float32Arrays.
 * Returns 0 if lengths differ or denominator is zero.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  return dot / denom
}

// ── EmbeddingService ──────────────────────────────────────────────────────────

export class EmbeddingService {
  private pipeline: any = null
  private loading: Promise<void> | null = null
  private cache: CachedEmbedding[] = []
  private cacheMemoryIds: Set<string> = new Set()

  constructor(private readonly store: EmbeddingStore) {}

  /**
   * Hydrate the in-memory cache from disk.
   */
  async init(): Promise<void> {
    this.loadCache()
  }

  /**
   * Generate and persist an embedding for a memory record.
   * No-ops silently if the memory is already cached.
   */
  async embed(memory: MemoryRecord): Promise<void> {
    try {
      if (this.cacheMemoryIds.has(memory.id)) return

      await this.ensureModel()

      const text = buildEmbeddingText(memory)
      const vector = await this.generateVector(text)
      if (!vector) return

      const record: EmbeddingRecord = {
        id: randomUUID(),
        memoryId: memory.id,
        vector: Array.from(vector),
        modelId: MODEL_ID,
        createdAt: Date.now(),
      }

      this.store.append(record)

      this.cache.push({ memoryId: memory.id, vector })
      this.cacheMemoryIds.add(memory.id)
    } catch (err) {
      console.error('[EmbeddingService] embed error for memory', memory.id, err)
    }
  }

  /**
   * Embed all memories not already in cache.
   * Returns the count of newly embedded memories.
   */
  async backfill(memories: MemoryRecord[]): Promise<number> {
    let count = 0
    for (const memory of memories) {
      if (this.cacheMemoryIds.has(memory.id)) continue
      await this.embed(memory)
      // embed() may silently fail, check if it was added
      if (this.cacheMemoryIds.has(memory.id)) count++
    }
    return count
  }

  /**
   * Embed a query string and return the top-N most similar memories by cosine similarity.
   */
  async searchSemantic(
    query: string,
    limit: number
  ): Promise<Array<{ memoryId: string; score: number }>> {
    try {
      if (this.cache.length === 0) return []

      await this.ensureModel()

      const queryVector = await this.generateVector(query)
      if (!queryVector) return []

      const scored = this.cache.map((entry) => ({
        memoryId: entry.memoryId,
        score: cosineSimilarity(queryVector, entry.vector),
      }))

      scored.sort((a, b) => b.score - a.score)

      return scored.slice(0, limit)
    } catch (err) {
      console.error('[EmbeddingService] searchSemantic error:', err)
      return []
    }
  }

  /** Returns whether the transformer pipeline is loaded. */
  isReady(): boolean {
    return this.pipeline !== null
  }

  /** Returns the number of entries currently in cache. */
  getCacheSize(): number {
    return this.cache.length
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Load all embedding records from disk into the in-memory cache.
   * Deduplicates by memoryId, keeping the latest record by createdAt.
   */
  private loadCache(): void {
    try {
      const records = this.store.loadAll()

      // Deduplicate: keep the latest record per memoryId
      const latestByMemoryId = new Map<string, EmbeddingRecord>()
      for (const record of records) {
        const existing = latestByMemoryId.get(record.memoryId)
        if (!existing || record.createdAt > existing.createdAt) {
          latestByMemoryId.set(record.memoryId, record)
        }
      }

      this.cache = []
      this.cacheMemoryIds = new Set()

      for (const record of latestByMemoryId.values()) {
        if (record.vector.length !== VECTOR_DIM) {
          console.warn(
            '[EmbeddingService] Skipping record with unexpected vector dim:',
            record.memoryId,
            record.vector.length
          )
          continue
        }
        this.cache.push({
          memoryId: record.memoryId,
          vector: new Float32Array(record.vector),
        })
        this.cacheMemoryIds.add(record.memoryId)
      }

      console.log(`[EmbeddingService] Cache loaded: ${this.cache.length} embeddings`)
    } catch (err) {
      console.error('[EmbeddingService] loadCache error:', err)
    }
  }

  /**
   * Lazy-load the transformer pipeline.
   * Concurrent calls wait on the same promise — only one model load at a time.
   */
  private async ensureModel(): Promise<void> {
    if (this.pipeline) return

    if (this.loading) {
      await this.loading
      return
    }

    this.loading = (async () => {
      try {
        console.log('[EmbeddingService] Loading model:', MODEL_ID)
        // Dynamic import is required — static import fails before model is available
        const { pipeline } = await import('@xenova/transformers')
        this.pipeline = await pipeline('feature-extraction', MODEL_ID)
        console.log('[EmbeddingService] Model loaded:', MODEL_ID)
      } catch (err) {
        console.error('[EmbeddingService] Failed to load model:', err)
        this.pipeline = null
      } finally {
        this.loading = null
      }
    })()

    await this.loading
  }

  /**
   * Run the transformer pipeline on text and return the pooled, normalized vector.
   * Returns null on failure.
   */
  private async generateVector(text: string): Promise<Float32Array | null> {
    try {
      const truncated = text.slice(0, EMBED_TEXT_MAX_LENGTH)
      const output = await this.pipeline(truncated, { pooling: 'mean', normalize: true })
      return output.data as Float32Array
    } catch (err) {
      console.error('[EmbeddingService] generateVector error:', err)
      return null
    }
  }
}
