import React, { useEffect, useState } from 'react'
import type {
  ArtifactRecord,
  EntityRecord,
  MemoryListFilters,
  MemoryRecord,
  MemoryUpdateInput,
  RecallResult,
  RelationRecord,
  RuntimeRecallDebugState,
  AuraEntityType,
  AuraMemoryStatus,
  AuraMemoryType,
} from '@shared/types'
import {
  Archive,
  CheckCircle2,
  Clock3,
  Database,
  FileImage,
  FileText,
  FolderOpen,
  Info,
  Link2,
  MessageSquareQuote,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react'

const STATUS_FILTERS: Array<{ key: 'all' | AuraMemoryStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'archived', label: 'Archived' },
]

const TYPE_FILTERS: Array<{ key: 'all' | AuraMemoryType; label: string }> = [
  { key: 'all', label: 'All types' },
  { key: 'note', label: 'Notes' },
  { key: 'task', label: 'Tasks' },
  { key: 'summary', label: 'Summaries' },
  { key: 'fact', label: 'Facts' },
  { key: 'insight', label: 'Insights' },
]

const ENTITY_TYPE_FILTERS: Array<{ key: 'all' | AuraEntityType; label: string }> = [
  { key: 'all', label: 'All types' },
  { key: 'person', label: 'People' },
  { key: 'project', label: 'Projects' },
  { key: 'company', label: 'Companies' },
  { key: 'tool', label: 'Tools' },
  { key: 'routine', label: 'Routines' },
  { key: 'topic', label: 'Topics' },
]

const MEMORY_LIST_LIMIT = 30

interface MemoryEditDraft {
  type: AuraMemoryType
  title: string
  summary: string
  content: string
  tagsText: string
}

export default function MemoryViewer() {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [recentEntities, setRecentEntities] = useState<EntityRecord[]>([])
  const [linkedArtifacts, setLinkedArtifacts] = useState<Record<string, ArtifactRecord>>({})
  const [memoryEntityMap, setMemoryEntityMap] = useState<Record<string, EntityRecord[]>>({})
  const [recentArtifacts, setRecentArtifacts] = useState<ArtifactRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [recallQuery, setRecallQuery] = useState('')
  const [recallResults, setRecallResults] = useState<RecallResult[]>([])
  const [recallLoading, setRecallLoading] = useState(false)
  const [runtimeRecallDebug, setRuntimeRecallDebug] = useState<RuntimeRecallDebugState | null>(null)
  const [runtimeRecallLoading, setRuntimeRecallLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | AuraMemoryStatus>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | AuraMemoryType>('all')
  const [updatingIds, setUpdatingIds] = useState<string[]>([])
  const [entityTypeFilter, setEntityTypeFilter] = useState<'all' | AuraEntityType>('all')
  const [entitySearch, setEntitySearch] = useState('')
  const [editingMemoryId, setEditingMemoryId] = useState('')
  const [editDraft, setEditDraft] = useState<MemoryEditDraft | null>(null)
  const [expandedMemoryIds, setExpandedMemoryIds] = useState<string[]>([])

  const buildFilters = (): MemoryListFilters => ({
    limit: MEMORY_LIST_LIMIT,
    statuses: statusFilter === 'all' ? undefined : [statusFilter],
    types: typeFilter === 'all' ? undefined : [typeFilter],
    query: search.trim() || undefined,
  })

  const loadData = async () => {
    setLoading(true)
    setError('')

    try {
      const records = await window.api.getRecentMemories(buildFilters())
      const nextMemories = Array.isArray(records) ? records : []
      setMemories(nextMemories)

      const artifactIds = Array.from(
        new Set(
          nextMemories.flatMap((memory) => memory.sourceArtifactIds || [])
        )
      )

      const [recentEntityRecords, recentArtifactRecords, linkedArtifactRecords, relationRecords] = await Promise.all([
        window.api.getRecentEntities({
          limit: 50,
          types: entityTypeFilter === 'all' ? undefined : [entityTypeFilter],
          query: entitySearch.trim() || undefined,
        }),
        window.api.getRecentArtifacts({ limit: 12 }),
        artifactIds.length > 0 ? window.api.getArtifactsByIds(artifactIds) : Promise.resolve([]),
        window.api.getRecentRelations({ limit: 500 }),
      ])

      const safeEntities = Array.isArray(recentEntityRecords) ? recentEntityRecords : []
      setRecentEntities(safeEntities)
      setRecentArtifacts(Array.isArray(recentArtifactRecords) ? recentArtifactRecords : [])
      setLinkedArtifacts(
        (Array.isArray(linkedArtifactRecords) ? linkedArtifactRecords : []).reduce<Record<string, ArtifactRecord>>(
          (accumulator, artifact) => {
            accumulator[artifact.id] = artifact
            return accumulator
          },
          {}
        )
      )

      // Build memory → entity map from relations
      const entityById = new Map(safeEntities.map((e) => [e.id, e]))
      const nextMap: Record<string, EntityRecord[]> = {}
      for (const rel of (Array.isArray(relationRecords) ? relationRecords : []) as RelationRecord[]) {
        if (rel.sourceKind === 'memory' && rel.targetKind === 'entity') {
          const entity = entityById.get(rel.targetId)
          if (entity) {
            ;(nextMap[rel.sourceId] ||= []).push(entity)
          }
        }
      }
      setMemoryEntityMap(nextMap)
    } catch (err: any) {
      setError(err.message || 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [statusFilter, typeFilter, entityTypeFilter])

  const applySearch = async () => {
    await loadData()
  }

  const runRecall = async () => {
    const query = recallQuery.trim()
    if (!query) {
      setRecallResults([])
      return
    }

    setRecallLoading(true)
    setError('')

    try {
      const results = await window.api.searchRecall({
        query,
        limit: 8,
      })
      setRecallResults(Array.isArray(results) ? results : [])
    } catch (err: any) {
      setError(err.message || 'Failed to search recall')
    } finally {
      setRecallLoading(false)
    }
  }

  const loadRuntimeRecallDebug = async () => {
    setRuntimeRecallLoading(true)
    try {
      const state = await window.api.getRuntimeRecallDebug()
      setRuntimeRecallDebug(state || null)
    } catch (err: any) {
      setError(err.message || 'Failed to load runtime recall state')
    } finally {
      setRuntimeRecallLoading(false)
    }
  }

  useEffect(() => {
    void loadRuntimeRecallDebug()
  }, [])

  const updateStatus = async (memoryId: string, status: AuraMemoryStatus) => {
    setUpdatingIds((current) => [...current, memoryId])
    setError('')

    try {
      await window.api.updateMemoryStatus(memoryId, status)
      await loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to update memory')
    } finally {
      setUpdatingIds((current) => current.filter((id) => id !== memoryId))
    }
  }

  const startEditing = (memory: MemoryRecord) => {
    setEditingMemoryId(memory.id)
    setEditDraft({
      type: memory.type,
      title: memory.title,
      summary: memory.summary,
      content: memory.content || '',
      tagsText: (memory.tags || []).join(', '),
    })
  }

  const cancelEditing = () => {
    setEditingMemoryId('')
    setEditDraft(null)
  }

  const toggleExpanded = (memoryId: string) => {
    setExpandedMemoryIds((current) =>
      current.includes(memoryId)
        ? current.filter((id) => id !== memoryId)
        : [...current, memoryId]
    )
  }

  const saveMemory = async (memoryId: string) => {
    if (!editDraft) {
      return
    }

    const title = editDraft.title.trim()
    const summary = editDraft.summary.trim()

    if (!title || !summary) {
      setError('Title and summary are required to save a memory')
      return
    }

    setUpdatingIds((current) => [...current, memoryId])
    setError('')

    const updates: MemoryUpdateInput = {
      type: editDraft.type,
      title,
      summary,
      content: editDraft.content,
      tags: parseTags(editDraft.tagsText),
    }

    try {
      await window.api.updateMemory(memoryId, updates)
      cancelEditing()
      await loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to update memory')
    } finally {
      setUpdatingIds((current) => current.filter((id) => id !== memoryId))
    }
  }

  const renderActions = (memory: MemoryRecord) => {
    const disabled = updatingIds.includes(memory.id)

    if (editingMemoryId === memory.id) {
      return (
        <>
          <button
            onClick={() => void saveMemory(memory.id)}
            disabled={disabled}
            className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1 text-[10.5px] text-emerald-300/80 transition-colors hover:bg-emerald-500/14 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={cancelEditing}
            disabled={disabled}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      )
    }

    if (memory.status === 'draft') {
      return (
        <>
          <button
            onClick={() => void updateStatus(memory.id, 'active')}
            disabled={disabled}
            className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1 text-[10.5px] text-emerald-300/80 transition-colors hover:bg-emerald-500/14 disabled:opacity-50"
          >
            Activate
          </button>
          <button
            onClick={() => void updateStatus(memory.id, 'archived')}
            disabled={disabled}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
          >
            Archive
          </button>
          <button
            onClick={() => startEditing(memory)}
            disabled={disabled}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
          >
            Edit
          </button>
        </>
      )
    }

    if (memory.status === 'active') {
      return (
        <>
          <button
            onClick={() => void updateStatus(memory.id, 'resolved')}
            disabled={disabled}
            className="rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-2.5 py-1 text-[10.5px] text-cyan-300/80 transition-colors hover:bg-cyan-500/14 disabled:opacity-50"
          >
            Resolve
          </button>
          <button
            onClick={() => void updateStatus(memory.id, 'archived')}
            disabled={disabled}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
          >
            Archive
          </button>
          <button
            onClick={() => startEditing(memory)}
            disabled={disabled}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
          >
            Edit
          </button>
        </>
      )
    }

    return (
      <>
        <button
          onClick={() => void updateStatus(memory.id, 'draft')}
          disabled={disabled}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
        >
          Restore draft
        </button>
        <button
          onClick={() => startEditing(memory)}
          disabled={disabled}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
        >
          Edit
        </button>
      </>
    )
  }

  const renderArtifactIcon = (artifact: ArtifactRecord) => {
    if (artifact.type === 'screenshot.image') {
      return <FileImage size={12} className="text-cyan-300/70" />
    }

    return <FileText size={12} className="text-white/45" />
  }

  const memoryArtifacts = (memory: MemoryRecord) =>
    (memory.sourceArtifactIds || [])
      .map((artifactId) => linkedArtifacts[artifactId])
      .filter((artifact): artifact is ArtifactRecord => Boolean(artifact))

  const renderRecallArtifacts = (artifacts: ArtifactRecord[]) => {
    if (artifacts.length === 0) {
      return null
    }

    return (
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/28">
          <Link2 size={10} />
          Linked artifacts
        </div>
        <div className="space-y-2">
          {artifacts.map((artifact) => (
            <div
              key={artifact.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/10 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-white/65">
                  {renderArtifactIcon(artifact)}
                  <span className="truncate">{artifact.relativePath || artifact.absolutePath}</span>
                </div>
                <div className="mt-1 text-[10.5px] text-white/25">
                  {artifact.type}
                  {artifact.sessionFolderName ? ` • ${artifact.sessionFolderName}` : ''}
                </div>
              </div>
              <button
                onClick={() => void window.api.openArtifact(artifact.id)}
                className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
              >
                Open
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[18px] font-semibold text-white/90 tracking-tight">Memory</h2>
        <p className="mt-1 text-[13px] text-white/35">
          Review extracted memories, inspect their source files, and archive noise before recall gets more autonomous.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void applySearch()
              }
            }}
            placeholder="Search memories, content, or tags"
            className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] py-2.5 pl-9 pr-3 text-[12.5px] text-white/80 placeholder:text-white/20 focus:border-white/[0.12] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void applySearch()}
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
          >
            Search
          </button>
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            title="Refresh memories and artifacts"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/28">Status</div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setStatusFilter(filter.key)}
                className={`rounded-full border px-3 py-1 text-[10.5px] uppercase tracking-wider transition-colors ${
                  statusFilter === filter.key
                    ? 'border-cyan-400/20 bg-cyan-500/[0.08] text-cyan-300/85'
                    : 'border-white/[0.06] bg-white/[0.02] text-white/40 hover:bg-white/[0.05] hover:text-white/65'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/28">Type</div>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setTypeFilter(filter.key)}
                className={`rounded-full border px-3 py-1 text-[10.5px] uppercase tracking-wider transition-colors ${
                  typeFilter === filter.key
                    ? 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300/85'
                    : 'border-white/[0.06] bg-white/[0.02] text-white/40 hover:bg-white/[0.05] hover:text-white/65'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/12 bg-red-500/8 p-4 text-[12.5px] text-red-400">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareQuote size={14} className="text-white/25" />
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-white/50">
              Recall
            </h3>
          </div>
          <p className="mt-1 text-[12px] text-white/28">
            Query active memories first, with linked artifacts attached to the strongest matches.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
            <input
              value={recallQuery}
              onChange={(event) => setRecallQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void runRecall()
                }
              }}
              placeholder="What should Aura remember about this project, person, or task?"
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] py-2.5 pl-9 pr-3 text-[12.5px] text-white/80 placeholder:text-white/20 focus:border-white/[0.12] focus:outline-none"
            />
          </div>
          <button
            onClick={() => void runRecall()}
            className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.08] px-4 py-2 text-[11px] text-cyan-300/80 transition-colors hover:bg-cyan-500/[0.12]"
          >
            Search Recall
          </button>
        </div>

        <div className="rounded-2xl border border-white/[0.045] bg-white/[0.02] p-4">
          {recallLoading ? (
            <div className="py-4 text-center text-[12px] text-white/30">Searching recall...</div>
          ) : recallResults.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-white/25">
              {recallQuery.trim()
                ? 'No active memories matched that query yet'
                : 'Run a recall query to test retrieval against active memory'}
            </div>
          ) : (
            <div className="space-y-3">
              {recallResults.map((result) => (
                <div
                  key={`${result.kind}-${result.id}`}
                  className="rounded-2xl border border-white/[0.05] bg-black/10 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-500/[0.12] bg-cyan-500/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300/80">
                          {result.kind}
                        </span>
                        <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/40">
                          score {result.score.toFixed(2)}
                        </span>
                        {result.matchedTerms.length > 0 && (
                          <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/35">
                            {result.matchedTerms.slice(0, 3).join(', ')}
                          </span>
                        )}
                      </div>

                      <h3 className="mt-3 text-[13px] font-medium leading-snug text-white/85">
                        {result.title}
                      </h3>
                      <p className="mt-2 text-[12px] leading-relaxed text-white/45">
                        {result.summary}
                      </p>

                      {result.memory && renderRecallArtifacts(result.linkedArtifacts || [])}

                      {result.artifact && (
                        <div className="mt-4">
                          <button
                            onClick={() => void window.api.openArtifact(result.artifact!.id)}
                            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10.5px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                          >
                            Open artifact
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 text-right text-[10.5px] text-white/25">
                      {new Date(result.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Info size={14} className="text-white/25" />
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-white/50">
                Runtime Recall Debug
              </h3>
            </div>
            <p className="mt-1 text-[12px] text-white/28">
              Inspect the exact recall blocks currently being injected into live prompts.
            </p>
          </div>
          <button
            onClick={() => void loadRuntimeRecallDebug()}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        </div>

        <div className="rounded-2xl border border-white/[0.045] bg-white/[0.02] p-4 space-y-4">
          {runtimeRecallLoading ? (
            <div className="py-4 text-center text-[12px] text-white/30">Loading runtime recall...</div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <RuntimeRecallCard
                  title="Session Recall"
                  meta={runtimeRecallDebug?.sessionFolderName || 'No active session folder'}
                  content={runtimeRecallDebug?.sessionRecallContext}
                />
                <RuntimeRecallCard
                  title="Last Answer Recall"
                  meta={runtimeRecallDebug?.lastAnswerQuestion || 'No answer recall yet'}
                  content={runtimeRecallDebug?.lastAnswerRecallContext}
                />
                <RuntimeRecallCard
                  title="Last Screenshot Recall"
                  meta={runtimeRecallDebug?.lastScreenshotTrigger || 'No screenshot recall yet'}
                  content={runtimeRecallDebug?.lastScreenshotRecallContext}
                />
              </div>

              <div className="text-[10.5px] text-white/25">
                {runtimeRecallDebug?.updatedAt
                  ? `Updated ${new Date(runtimeRecallDebug.updatedAt).toLocaleString()}`
                  : 'No runtime recall has been injected yet'}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-white/35">
            Entities
          </div>
          <div className="text-[11px] text-white/25">
            {recentEntities.length} visible
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              type="text"
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadData() }}
              placeholder="Search entities..."
              className="w-full rounded-lg border border-white/[0.06] bg-black/20 py-1.5 pl-8 pr-3 text-[11px] text-white/80 outline-none placeholder:text-white/20 focus:border-violet-400/30"
            />
          </div>
          <button
            onClick={() => void loadData()}
            className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5 text-[11px] text-white/50 transition-colors hover:text-white/80"
          >
            <Search size={13} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ENTITY_TYPE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setEntityTypeFilter(key)}
              className={`rounded-full border px-2.5 py-0.5 text-[10.5px] transition-colors ${
                entityTypeFilter === key
                  ? 'border-violet-400/40 bg-violet-400/10 text-violet-300'
                  : 'border-white/[0.06] text-white/35 hover:text-white/55'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-white/[0.045] bg-white/[0.02] p-4">
          {recentEntities.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-white/25">
              {entityTypeFilter !== 'all' || entitySearch.trim()
                ? 'No matching entities'
                : 'No entities derived yet'}
            </div>
          ) : (
            <div className="space-y-2">
              {recentEntities.map((entity) => (
                <div
                  key={entity.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/10 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-white/72">
                      <Link2 size={12} className="text-cyan-300/70" />
                      <span className="truncate">{entity.name}</span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-white/25">
                      {entity.type}
                      {entity.sourceMemoryIds && entity.sourceMemoryIds.length > 0
                        ? ` • ${entity.sourceMemoryIds.length} mem${entity.sourceMemoryIds.length === 1 ? 'ory' : 'ories'}`
                        : ''}
                      {entity.sessionFolderNames && entity.sessionFolderNames.length > 0
                        ? ` • ${entity.sessionFolderNames[0]}`
                        : ''}
                    </div>
                    {entity.summary && (
                      <div className="mt-2 text-[11px] leading-relaxed text-white/38">
                        {entity.summary}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-[10.5px] text-white/25">
                    {new Date(entity.updatedAt ?? entity.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-white/35">
            {memories.length} memory item{memories.length === 1 ? '' : 's'}
          </div>
          <div className="text-[11px] text-white/25">
            Latest {MEMORY_LIST_LIMIT}
            {statusFilter === 'all' ? '' : ' • '}
            {statusFilter === 'all' ? 'All statuses' : `Status: ${statusFilter}`}
            {typeFilter === 'all' ? '' : ` • Type: ${typeFilter}`}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/[0.04] bg-white/[0.015] p-6 text-center text-[12.5px] text-white/30">
            Loading memories...
          </div>
        ) : memories.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.04] bg-white/[0.015] p-6 text-center">
            <Database size={20} className="mx-auto mb-2 text-white/15" />
            <p className="text-[12.5px] text-white/30">No memories match the current filters</p>
            <p className="mt-1 text-[11px] text-white/20">
              Capture activity, or widen the filters if you are looking for older records.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.04] bg-white/[0.015] p-2">
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
            {memories.map((memory) => {
              const sourceArtifacts = memoryArtifacts(memory)
              const isEditing = editingMemoryId === memory.id && editDraft
              const isExpanded = expandedMemoryIds.includes(memory.id)

              return (
                <div
                  key={memory.id}
                  className="card-premium rounded-2xl border border-white/[0.045] bg-white/[0.02] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-500/[0.12] bg-cyan-500/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300/80">
                          {memory.type}
                        </span>
                        <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/40">
                          {memory.status}
                        </span>
                        {typeof memory.confidence === 'number' && (
                          <span className="rounded-full border border-emerald-500/[0.1] bg-emerald-500/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300/75">
                            {Math.round(memory.confidence * 100)}%
                          </span>
                        )}
                        {(memoryEntityMap[memory.id] || []).slice(0, 4).map((entity) => (
                          <span
                            key={entity.id}
                            className="rounded-full border border-violet-500/[0.12] bg-violet-500/[0.08] px-2 py-0.5 text-[10px] text-violet-300/80"
                          >
                            {entity.name}
                          </span>
                        ))}
                        {(memoryEntityMap[memory.id] || []).length > 4 && (
                          <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/30">
                            +{(memoryEntityMap[memory.id] || []).length - 4}
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-3 space-y-3">
                          <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                            <label className="space-y-1">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-white/28">Type</div>
                              <select
                                value={editDraft.type}
                                onChange={(event) =>
                                  setEditDraft((current) =>
                                    current
                                      ? { ...current, type: event.target.value as AuraMemoryType }
                                      : current
                                  )
                                }
                                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-white/80 focus:border-white/[0.12] focus:outline-none"
                              >
                                {TYPE_FILTERS.filter((filter) => filter.key !== 'all').map((filter) => (
                                  <option key={filter.key} value={filter.key} className="bg-[#0b0d11] text-white">
                                    {filter.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="space-y-1">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-white/28">Tags</div>
                              <input
                                value={editDraft.tagsText}
                                onChange={(event) =>
                                  setEditDraft((current) =>
                                    current ? { ...current, tagsText: event.target.value } : current
                                  )
                                }
                                placeholder="comma, separated, tags"
                                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-white/80 placeholder:text-white/20 focus:border-white/[0.12] focus:outline-none"
                              />
                            </label>
                          </div>

                          <label className="space-y-1">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/28">Title</div>
                            <input
                              value={editDraft.title}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current ? { ...current, title: event.target.value } : current
                                )
                              }
                              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-white/80 focus:border-white/[0.12] focus:outline-none"
                            />
                          </label>

                          <label className="space-y-1">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/28">Summary</div>
                            <textarea
                              value={editDraft.summary}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current ? { ...current, summary: event.target.value } : current
                                )
                              }
                              rows={3}
                              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-white/80 focus:border-white/[0.12] focus:outline-none"
                            />
                          </label>

                          <label className="space-y-1">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/28">Detail</div>
                            <textarea
                              value={editDraft.content}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current ? { ...current, content: event.target.value } : current
                                )
                              }
                              rows={5}
                              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-white/75 focus:border-white/[0.12] focus:outline-none"
                            />
                          </label>
                        </div>
                      ) : (
                        <>
                          <h3 className="mt-3 text-[13px] font-medium leading-snug text-white/85">
                            {memory.title}
                          </h3>

                          <p className={`mt-2 text-[12px] leading-relaxed text-white/45 ${isExpanded ? '' : 'line-clamp-3'}`}>
                            {memory.summary}
                          </p>

                          {isExpanded && memory.content && memory.content !== memory.summary && (
                            <p className="mt-2 break-words text-[11.5px] leading-relaxed text-white/28">
                              {memory.content}
                            </p>
                          )}
                        </>
                      )}

                      {isExpanded && sourceArtifacts.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/28">
                            <Link2 size={10} />
                            Source artifacts
                          </div>
                          <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                            {sourceArtifacts.map((artifact) => (
                              <div
                                key={artifact.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/10 px-3 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 text-[11px] text-white/65">
                                    {renderArtifactIcon(artifact)}
                                    <span className="truncate">{artifact.relativePath || artifact.absolutePath}</span>
                                  </div>
                                  <div className="mt-1 text-[10.5px] text-white/25">
                                    {artifact.type}
                                    {artifact.sessionFolderName ? ` • ${artifact.sessionFolderName}` : ''}
                                  </div>
                                </div>
                                <button
                                  onClick={() => void window.api.openArtifact(artifact.id)}
                                  className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                                >
                                  Open
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {!isEditing && (
                          <button
                            onClick={() => toggleExpanded(memory.id)}
                            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10.5px] text-white/45 transition-colors hover:bg-white/[0.05]"
                          >
                            {isExpanded ? 'Collapse' : 'Details'}
                          </button>
                        )}
                        {renderActions(memory)}
                      </div>
                    </div>

                    <div className="space-y-1 text-right text-[10.5px] text-white/25">
                      <div className="flex items-center justify-end gap-1.5">
                        <Clock3 size={10} />
                        <span>{new Date(memory.createdAt).toLocaleString()}</span>
                      </div>
                      {memory.updatedAt && memory.updatedAt !== memory.createdAt && (
                        <div className="flex items-center justify-end gap-1.5">
                          <CheckCircle2 size={10} />
                          <span>Updated {new Date(memory.updatedAt).toLocaleString()}</span>
                        </div>
                      )}
                      {memory.tags && memory.tags.length > 0 && (
                        <div className="flex items-center justify-end gap-1.5">
                          <Tag size={10} />
                          <span>{memory.tags.slice(0, 2).join(', ')}</span>
                        </div>
                      )}
                      {memory.status === 'archived' && (
                        <div className="flex items-center justify-end gap-1.5">
                          <Archive size={10} />
                          <span>Archived</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-white/35">
            Recent artifacts
          </div>
          <div className="text-[11px] text-white/25">
            {recentArtifacts.length} visible
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.045] bg-white/[0.02] p-4">
          {recentArtifacts.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-white/25">
              No recent artifacts yet
            </div>
          ) : (
            <div className="space-y-2">
              {recentArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-black/10 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-white/65">
                      {renderArtifactIcon(artifact)}
                      <span className="truncate">{artifact.relativePath || artifact.absolutePath}</span>
                    </div>
                    <div className="mt-1 text-[10.5px] text-white/25">
                      {artifact.type}
                      {artifact.sessionFolderName ? ` • ${artifact.sessionFolderName}` : ''}
                      {` • ${new Date(artifact.createdAt).toLocaleString()}`}
                    </div>
                  </div>
                  <button
                    onClick={() => void window.api.openArtifact(artifact.id)}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                  >
                    <FolderOpen size={11} />
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function RuntimeRecallCard({
  title,
  meta,
  content,
}: {
  title: string
  meta: string
  content?: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.05] bg-black/10 p-4">
      <div className="text-[11px] uppercase tracking-wider text-white/35">{title}</div>
      <div className="mt-2 text-[11px] text-white/45 break-words">{meta}</div>
      <div className="mt-3 rounded-xl border border-white/[0.05] bg-[#050608] p-3">
        {content ? (
          <pre className="whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-white/60 font-mono">
            {content}
          </pre>
        ) : (
          <div className="text-[11px] text-white/20">No recall block captured</div>
        )}
      </div>
    </div>
  )
}

function parseTags(tagsText: string): string[] {
  return Array.from(
    new Set(
      tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  )
}
