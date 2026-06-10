import type { SessionContext, TranscriptEntry } from '@shared/types'
import type { McpClientManager } from './mcp-client-manager'

/**
 * Session-boundary Vault memory calls — deliberately lightweight:
 * one `vault_recall_context` at session start (the result is injected into
 * the agent prompt right after soul.md) and one fire-and-forget
 * `vault_save_memory` at session end. Nothing runs mid-session, so the
 * heartbeat/realtime hot paths never wait on Vault.
 */

/** Fallback when no project is configured. 'Aura-Brain' is the Vault
 * project that holds Aura's identity and companion session memories
 * (the engineering project is 'aura-desktop-build'). */
export const DEFAULT_VAULT_MEMORY_PROJECT = 'Aura-Brain'
const RECALL_TIMEOUT_MS = 15_000
const RECALL_LIMIT = 6
const RECALL_MAX_CHARS = 4_000

export async function buildVaultRecallContext(
  manager: McpClientManager,
  sessionContext: SessionContext,
  project: string = DEFAULT_VAULT_MEMORY_PROJECT
): Promise<string> {
  if (!manager.isConnected('vault_memory')) return ''

  const topic = describeSessionTopic(sessionContext)
  try {
    const raw = await manager.callTool(
      'vault_memory',
      'vault_recall_context',
      {
        project,
        query_text: topic || 'recent context for a new companion session',
        limit: RECALL_LIMIT,
      },
      RECALL_TIMEOUT_MS
    )
    const formatted = formatRecallPack(raw)
    if (!formatted) {
      console.log('[VaultMemory] recall returned no relevant memories.')
      return ''
    }
    console.log(`[VaultMemory] recall loaded ${formatted.length} chars of cross-session context.`)
    return formatted
  } catch (err) {
    console.warn('[VaultMemory] recall failed — starting session without Vault context:', err instanceof Error ? err.message : err)
    return ''
  }
}

export interface VaultSessionSavePayload {
  subject: string
  summaryMarkdown: string
  startedAt: number | null
  endedAt: number
  transcript: TranscriptEntry[]
  project?: string
}

/** Fire-and-forget save of the finished session. Never throws. */
export async function saveVaultSessionMemory(
  manager: McpClientManager,
  payload: VaultSessionSavePayload
): Promise<void> {
  if (!manager.isConnected('vault_memory')) {
    console.log('[VaultMemory] save skipped — vault-memory not connected.')
    return
  }

  const summary = payload.summaryMarkdown.trim() || buildTranscriptFallbackSummary(payload.transcript)
  if (!summary) {
    console.log('[VaultMemory] save skipped — nothing noteworthy in this session.')
    return
  }

  const durationMin = payload.startedAt
    ? Math.max(1, Math.round((payload.endedAt - payload.startedAt) / 60_000))
    : null
  const subject = payload.subject.trim() || 'Companion session'
  const dateLabel = new Date(payload.endedAt).toISOString().slice(0, 10)

  try {
    await manager.callTool('vault_memory', 'vault_save_memory', {
      title: `Aura session — ${subject} (${dateLabel})`,
      project: payload.project || DEFAULT_VAULT_MEMORY_PROJECT,
      // The vault-memory schema has no 'conversation' type; 'session' is its
      // canonical equivalent for a finished interactive session.
      memory_type: 'session',
      subject,
      summary: summary.slice(0, 400),
      content: [
        `# Aura companion session — ${subject}`,
        durationMin ? `Duration: ~${durationMin} min, ${payload.transcript.length} transcript entries.` : '',
        '',
        summary,
      ].filter(Boolean).join('\n'),
      tags: ['aura-session', 'companion'],
      keywords: ['aura', 'companion-session', ...subjectKeywords(subject)],
      source_app: 'other',
      routine_type: 'implementation',
      status: 'active',
    })
    console.log('[VaultMemory] session memory saved to Vault.')
  } catch (err) {
    console.warn('[VaultMemory] session save failed:', err instanceof Error ? err.message : err)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function describeSessionTopic(ctx: SessionContext): string {
  return [ctx.subject, ctx.sessionNotes, ctx.companyName, ctx.roleName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' — ')
    .slice(0, 300)
}

/**
 * The recall tool returns a ranked memory pack (JSON or prose). Reduce it to
 * a compact markdown block the prompt can carry without blowing the budget.
 */
function formatRecallPack(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  let body = trimmed
  try {
    const parsed = JSON.parse(trimmed)
    const pack = parsed?.result ?? parsed
    const items: any[] = Array.isArray(pack?.top_matches)
      ? pack.top_matches
      : Array.isArray(pack?.items)
        ? pack.items
        : Array.isArray(pack)
          ? pack
          : []
    if (items.length > 0) {
      const bullets = items.slice(0, RECALL_LIMIT).map((item) => {
        const title = String(item?.title ?? item?.subject ?? 'memory').trim()
        const project = String(item?.project ?? '').trim()
        const summary = String(item?.summary ?? item?.content ?? '').trim().slice(0, 400)
        return `- **${title}**${project ? ` _(${project})_` : ''}${summary ? `: ${summary}` : ''}`
      })
      const contextSummary = String(pack?.context_summary ?? '').trim()
      body = [contextSummary, ...bullets].filter(Boolean).join('\n')
    }
  } catch {
    // already prose/markdown — use as-is
  }

  if (!body.trim()) return ''
  const block = ['## Vault Memory Recall (cross-session)', body.trim()].join('\n')
  return block.length > RECALL_MAX_CHARS ? block.slice(0, RECALL_MAX_CHARS) : block
}

function buildTranscriptFallbackSummary(transcript: TranscriptEntry[]): string {
  const lines = transcript
    .filter((entry) => entry.isFinal && entry.text.trim())
    .slice(-15)
    .map((entry) => `- ${entry.speaker}: ${entry.text.trim().slice(0, 200)}`)
  if (lines.length === 0) return ''
  return ['## Closing transcript excerpt', ...lines].join('\n')
}

function subjectKeywords(subject: string): string[] {
  return subject
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 5)
}
