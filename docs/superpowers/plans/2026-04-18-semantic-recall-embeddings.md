# Phase 6: Semantic Recall with Local Embeddings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic recall to Whisphry so the recall engine can surface relevant memories even when they share no exact keywords with the query.

**Architecture:** Local embeddings using `@xenova/transformers` with `all-MiniLM-L6-v2` (384-dim vectors, ~23MB model). Vectors stored in JSONL files (same pattern as existing stores). Hybrid recall blends existing keyword scores with cosine similarity scores. Model loads lazily on first use; existing memories are backfilled on startup.

**Tech Stack:** `@xenova/transformers` (ONNX-based inference), existing JSONL storage pattern, cosine similarity (brute-force — fine for <10K memories).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/main/services/memory/embedding-store.ts` | JSONL persistence for embedding vectors |
| Create | `src/main/services/memory/embedding-service.ts` | Model lifecycle, vector generation, similarity search |
| Modify | `src/shared/types.ts` | Add `EmbeddingRecord` type |
| Modify | `src/main/services/memory/recall-service.ts` | Hybrid keyword + semantic scoring |
| Modify | `src/main/ipc-handlers.ts` | Wire embedding service, embed on memory persist, backfill |
| Modify | `package.json` | Add `@xenova/transformers` dependency |

---

### Task 1: Install dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@xenova/transformers`**

```bash
npm install @xenova/transformers
```

This package bundles ONNX Runtime and handles model downloading/caching automatically. The `externalizeDepsPlugin()` in `electron.vite.config.ts` already keeps all `node_modules` out of the Vite bundle, so no config changes needed.

- [ ] **Step 2: Verify build still works**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @xenova/transformers for local embeddings"
```

---

### Task 2: Add EmbeddingRecord type

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the EmbeddingRecord interface**

Add after the `RelationListFilters` interface (around line 296):

```ts
// ── Embeddings ───────────────────────────────────────────

export interface EmbeddingRecord {
  id: string
  memoryId: string
  vector: number[]
  modelId: string
  createdAt: number
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add EmbeddingRecord type for semantic recall"
```

---

### Task 3: Create embedding-store.ts

**Files:**
- Create: `src/main/services/memory/embedding-store.ts`

This follows the exact same JSONL-append pattern used by `MemoryStore`, `EventStore`, `ArtifactStore`, etc.

- [ ] **Step 1: Create the file**

```ts
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
    const filePath = this.getPartitionPath(record.createdAt)
    fs.appendFileSync(filePath, `${line}\n`, 'utf-8')
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
      .sort()
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/memory/embedding-store.ts
git commit -m "feat: add EmbeddingStore for vector persistence"
```

---

### Task 4: Create embedding-service.ts

**Files:**
- Create: `src/main/services/memory/embedding-service.ts`

This is the core of Phase 6. It manages the transformer model lifecycle, generates embeddings, stores them, and provides semantic search.

- [ ] **Step 1: Create the file**

```ts
import { randomUUID } from 'crypto'
import { MemoryRecord, EmbeddingRecord } from '@shared/types'
import { EmbeddingStore } from './embedding-store'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const VECTOR_DIM = 384
const EMBED_TEXT_MAX_LENGTH = 512

interface CachedEmbedding {
  memoryId: string
  vector: Float32Array
}

export class EmbeddingService {
  private pipeline: any = null
  private loading: Promise<void> | null = null
  private cache: CachedEmbedding[] = []
  private cacheMemoryIds = new Set<string>()

  constructor(private readonly store: EmbeddingStore) {}

  async init(): Promise<void> {
    this.loadCache()
  }

  async embed(memory: MemoryRecord): Promise<void> {
    if (this.cacheMemoryIds.has(memory.id)) return

    try {
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
    } catch (error) {
      console.error('[EmbeddingService] Failed to embed memory:', memory.id, error)
    }
  }

  async backfill(memories: MemoryRecord[]): Promise<number> {
    let count = 0
    for (const memory of memories) {
      if (this.cacheMemoryIds.has(memory.id)) continue
      await this.embed(memory)
      count++
    }
    if (count > 0) {
      console.log(`[EmbeddingService] Backfilled ${count} memories`)
    }
    return count
  }

  async searchSemantic(query: string, limit: number): Promise<Array<{ memoryId: string; score: number }>> {
    if (this.cache.length === 0) return []

    try {
      await this.ensureModel()
      const queryVector = await this.generateVector(query)
      if (!queryVector) return []

      const scored = this.cache.map((entry) => ({
        memoryId: entry.memoryId,
        score: cosineSimilarity(queryVector, entry.vector),
      }))

      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, limit)
    } catch (error) {
      console.error('[EmbeddingService] Semantic search failed:', error)
      return []
    }
  }

  isReady(): boolean {
    return this.pipeline !== null
  }

  getCacheSize(): number {
    return this.cache.length
  }

  private loadCache(): void {
    try {
      const records = this.store.loadAll()
      const latestByMemory = new Map<string, EmbeddingRecord>()

      for (const record of records) {
        const existing = latestByMemory.get(record.memoryId)
        if (!existing || record.createdAt > existing.createdAt) {
          latestByMemory.set(record.memoryId, record)
        }
      }

      this.cache = []
      this.cacheMemoryIds.clear()

      for (const record of latestByMemory.values()) {
        this.cache.push({
          memoryId: record.memoryId,
          vector: new Float32Array(record.vector),
        })
        this.cacheMemoryIds.add(record.memoryId)
      }

      console.log(`[EmbeddingService] Loaded ${this.cache.length} cached embeddings`)
    } catch (error) {
      console.error('[EmbeddingService] Failed to load embedding cache:', error)
    }
  }

  private async ensureModel(): Promise<void> {
    if (this.pipeline) return
    if (this.loading) {
      await this.loading
      return
    }

    this.loading = (async () => {
      try {
        console.log('[EmbeddingService] Loading model:', MODEL_ID)
        const { pipeline } = await import('@xenova/transformers')
        this.pipeline = await pipeline('feature-extraction', MODEL_ID)
        console.log('[EmbeddingService] Model loaded successfully')
      } catch (error) {
        console.error('[EmbeddingService] Failed to load model:', error)
        this.loading = null
        throw error
      }
    })()

    await this.loading
  }

  private async generateVector(text: string): Promise<Float32Array | null> {
    if (!this.pipeline) return null
    const truncated = text.slice(0, EMBED_TEXT_MAX_LENGTH)
    const output = await this.pipeline(truncated, { pooling: 'mean', normalize: true })
    return output.data as Float32Array
  }
}

function buildEmbeddingText(memory: MemoryRecord): string {
  const parts = [memory.title, memory.summary]
  if (memory.content) parts.push(memory.content)
  if (memory.tags && memory.tags.length > 0) parts.push(memory.tags.join(' '))
  return parts.join('. ').trim()
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
  return denom === 0 ? 0 : dot / denom
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/memory/embedding-service.ts
git commit -m "feat: add EmbeddingService with local transformer model"
```

---

### Task 5: Add semantic scoring to RecallService

**Files:**
- Modify: `src/main/services/memory/recall-service.ts`

The recall service currently takes `MemoryStore` and `ArtifactStore`. We add `EmbeddingService` as an optional third dependency and blend semantic scores into the existing keyword pipeline.

- [ ] **Step 1: Update constructor to accept EmbeddingService**

In `recall-service.ts`, update the import and constructor:

```ts
// Add to existing imports at top of file:
import { EmbeddingService } from './embedding-service'
```

Replace the constructor:

```ts
export class RecallService {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly artifactStore: ArtifactStore,
    private readonly embeddingService?: EmbeddingService
  ) {}
```

- [ ] **Step 2: Add semantic scoring constants**

Add after the existing `ARTIFACT_TYPE_BOOSTS` constant (around line 110):

```ts
const SEMANTIC_WEIGHT = 0.45
const KEYWORD_WEIGHT = 0.55
const SEMANTIC_SCORE_SCALE = 12
const MIN_SEMANTIC_SIMILARITY = 0.25
```

- [ ] **Step 3: Update the `search` method to include semantic results**

Replace the `search` method with:

```ts
  async search(request: RecallQuery): Promise<RecallResult[]> {
    const normalizedQuery = normalizeSearchText(request.query)
    if (!normalizedQuery) {
      return []
    }

    const tokens = tokenize(normalizedQuery)
    const activeMemories = this.memoryStore.listRecent({
      limit: 250,
      statuses: ['active'],
    })
    const recentArtifacts = this.artifactStore.listRecent({
      limit: 200,
      sessionFolderName: request.sessionFolderName,
    })
    const linkedArtifactIds = Array.from(
      new Set(activeMemories.flatMap((memory) => memory.sourceArtifactIds || []))
    )
    const linkedArtifacts = this.artifactStore.getByIds(linkedArtifactIds)
    const artifactById = new Map(linkedArtifacts.map((artifact) => [artifact.id, artifact]))

    // Get semantic scores if embedding service is available
    const semanticScoreMap = await this.getSemanticScores(request.query)

    const memoryResults = activeMemories
      .map((memory) => this.buildMemoryResult(
        memory, tokens, normalizedQuery, request.sessionFolderName, artifactById, semanticScoreMap
      ))
      .filter((result): result is RecallResult => Boolean(result))

    const memoryArtifactIds = new Set(
      memoryResults.flatMap((result) => result.linkedArtifacts?.map((artifact) => artifact.id) || [])
    )

    const artifactResults = recentArtifacts
      .filter((artifact) => !memoryArtifactIds.has(artifact.id))
      .map((artifact) => this.buildArtifactResult(artifact, tokens, normalizedQuery, request.sessionFolderName))
      .filter((result): result is RecallResult => Boolean(result))

    return [...memoryResults, ...artifactResults]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return right.createdAt - left.createdAt
      })
      .slice(0, request.limit ?? 10)
  }

  private async getSemanticScores(query: string): Promise<Map<string, number>> {
    const map = new Map<string, number>()
    if (!this.embeddingService || !this.embeddingService.isReady()) return map

    const results = await this.embeddingService.searchSemantic(query, 30)
    for (const result of results) {
      if (result.score >= MIN_SEMANTIC_SIMILARITY) {
        map.set(result.memoryId, result.score)
      }
    }
    return map
  }
```

- [ ] **Step 4: Update `buildMemoryResult` to blend semantic score**

Add `semanticScoreMap` parameter and blend the score. Replace the method signature and add blending at the end:

```ts
  private buildMemoryResult(
    memory: MemoryRecord,
    tokens: string[],
    normalizedQuery: string,
    sessionFolderName: string | undefined,
    artifactById: Map<string, ArtifactRecord>,
    semanticScoreMap: Map<string, number>
  ): RecallResult | null {
```

At the end of the method, just before the final `return` block (where `matchedTerms.size === 0` check is), replace the final scoring + return logic:

```ts
    const semanticSimilarity = semanticScoreMap.get(memory.id) ?? 0
    const semanticScore = semanticSimilarity * SEMANTIC_SCORE_SCALE

    // If we have a semantic match, blend scores; otherwise use keyword only
    if (semanticScore > 0 && score > 0) {
      score = KEYWORD_WEIGHT * score + SEMANTIC_WEIGHT * semanticScore
    } else if (semanticScore > 0) {
      // Semantic-only match (no keyword overlap) — still surface it
      score = semanticScore * 0.85
    }

    const informativeMatchCount = countInformativeMatches(matchedTerms)
    const hasSemanticMatch = semanticSimilarity >= MIN_SEMANTIC_SIMILARITY
    if (!hasSemanticMatch && (matchedTerms.size === 0 || informativeMatchCount === 0 || score < 3)) {
      return null
    }

    return {
      id: memory.id,
      kind: 'memory',
      score: roundScore(score),
      createdAt: memory.createdAt,
      title: memory.title,
      summary: memory.summary,
      matchedTerms: sortMatchedTerms(matchedTerms),
      memory,
      linkedArtifacts: (memory.sourceArtifactIds || [])
        .map((artifactId) => artifactById.get(artifactId))
        .filter((artifact): artifact is ArtifactRecord => Boolean(artifact)),
    }
  }
```

- [ ] **Step 5: Update RecallQuery callers for async**

The `search` method is now `async`. Update the `RecallQuery` return type usage in `recall-context.ts` — in `formatRecallContextBlock`, change:

```ts
const results = options.recallService.search({
```

to:

```ts
const results = await options.recallService.search({
```

And make `formatRecallContextBlock` async:

```ts
async function formatRecallContextBlock(query: string, options: RecallContextBuildOptions): Promise<string> {
```

Propagate `async/await` to `buildSessionRecallContext`, `buildAnswerRecallContext`, and `buildScreenshotRecallContext` — all three become `async` returning `Promise<string>`.

Then update all callers in `ipc-handlers.ts` that call these functions to `await` them. Search for `buildSessionRecallContext`, `buildAnswerRecallContext`, `buildScreenshotRecallContext` in `ipc-handlers.ts` and add `await`.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/main/services/memory/recall-service.ts src/main/services/memory/recall-context.ts
git commit -m "feat: hybrid recall with semantic similarity scoring"
```

---

### Task 6: Wire embedding service into app lifecycle

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Import and instantiate**

Add imports at the top of `ipc-handlers.ts`:

```ts
import { EmbeddingStore } from './services/memory/embedding-store'
import { EmbeddingService } from './services/memory/embedding-service'
```

Add instantiation after `const relationStore = new RelationStore()` (around line 123):

```ts
const embeddingStore = new EmbeddingStore()
const embeddingService = new EmbeddingService(embeddingStore)
```

- [ ] **Step 2: Pass embeddingService to RecallService**

Change the `recallService` construction from:

```ts
const recallService = new RecallService(memoryStore, artifactStore)
```

to:

```ts
const recallService = new RecallService(memoryStore, artifactStore, embeddingService)
```

- [ ] **Step 3: Initialize embedding store and trigger backfill on startup**

In `setupIpcHandlers()`, after `relationStore.init()` (line 200), add:

```ts
  embeddingStore.init()
  embeddingService.init().then(() => {
    const activeMemories = memoryStore.listRecent({ limit: 500, statuses: ['active'] })
    embeddingService.backfill(activeMemories).catch((error) =>
      console.error('[EmbeddingService] Backfill failed:', error)
    )
  }).catch((error) => console.error('[EmbeddingService] Init failed:', error))
```

- [ ] **Step 4: Embed new memories on creation**

In the `memoryPipeline` constructor callback (around line 135-137), add embedding after entity sync:

```ts
const memoryPipeline = new MemoryPipelineService(
  eventStore,
  artifactStore,
  memoryStore,
  extractionService,
  () => contextManager.getAppDataPath(),
  (memory) => {
    entityGraphService.syncMemory(memory)
    embeddingService.embed(memory).catch((error) =>
      console.error('[EmbeddingService] Failed to embed new memory:', error)
    )
  }
)
```

- [ ] **Step 5: Await async recall calls**

Search `ipc-handlers.ts` for all calls to `buildSessionRecallContext`, `buildAnswerRecallContext`, `buildScreenshotRecallContext` and `recallService.search`. Add `await` to each call. The containing functions should already be `async` (IPC handlers are).

For the `RECALL_SEARCH` handler (around line 394), update:

```ts
  ipcMain.handle(IPC.RECALL_SEARCH, async (_event, query: RecallQuery) => {
    return await recallService.search(query)
  })
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: wire embedding service into app lifecycle"
```

---

### Task 7: Full build verification and runtime test

- [ ] **Step 1: Clean build**

```bash
rm -rf out && npm run build
```

Expected: clean build, no TypeScript errors, no warnings from embedding imports.

- [ ] **Step 2: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: Phase 6 — semantic recall with local embeddings (complete)"
```
