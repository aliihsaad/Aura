/**
 * ConversationLog — single source of truth for the agent's dialog state
 * within a session.
 *
 * Every agent surface (heartbeat bubble, answer window, chat input,
 * delegated solve_with_openrouter) reads from + writes to the same log so
 * the model sees real conversation continuity instead of re-deriving an
 * answer from a flat transcript snapshot.
 *
 * Lifecycle: cleared on session start; serialized to
 * sessions/<folder>/conversation.jsonl on session stop.
 */

export type ConversationRole = 'user' | 'agent'

export type ConversationSource =
  | 'transcript'      // finalized STT line
  | 'chat'            // user typed into the overlay chat input
  | 'bubble'          // heartbeat-emitted bubble
  | 'answer-window'   // long-form answer produced by the answer pipeline

export interface ConversationEntry {
  id: string
  timestamp: number
  role: ConversationRole
  source: ConversationSource
  text: string
  /** Optional id of the entry this one responds to (e.g. a bubble's
   *  triggering transcript entry). Useful for replay/debug. */
  triggeredBy?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

let nextId = 1

function makeId(): string {
  return `c${Date.now().toString(36)}_${(nextId++).toString(36)}`
}

export class ConversationLogService {
  private entries: ConversationEntry[] = []

  append(input: Omit<ConversationEntry, 'id' | 'timestamp'> & Partial<Pick<ConversationEntry, 'id' | 'timestamp'>>): ConversationEntry {
    const entry: ConversationEntry = {
      id: input.id ?? makeId(),
      timestamp: input.timestamp ?? Date.now(),
      role: input.role,
      source: input.source,
      text: input.text,
      triggeredBy: input.triggeredBy,
    }
    this.entries.push(entry)
    return entry
  }

  clear(): void {
    this.entries = []
  }

  getAll(): ConversationEntry[] {
    return this.entries.slice()
  }

  /**
   * Returns up to `maxTurns` alternations as ChatMessages ready for an
   * OpenRouter messages array. Consecutive same-role entries are merged
   * into one turn so the result strictly alternates user → assistant →
   * user → assistant (which most providers require).
   *
   * Returns oldest-first.
   */
  getRecentAlternations(maxTurns: number): ChatMessage[] {
    if (maxTurns <= 0 || this.entries.length === 0) return []

    // Walk newest → oldest, collapsing same-role runs into single bundled
    // turns. Stop once we've collected maxTurns alternations.
    const collapsed: ChatMessage[] = []
    let currentRole: ConversationRole | null = null
    let bundle: string[] = []

    const flush = (): void => {
      if (currentRole === null || bundle.length === 0) return
      collapsed.push({
        role: currentRole === 'user' ? 'user' : 'assistant',
        content: bundle.reverse().join('\n').trim(),
      })
      bundle = []
    }

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]
      if (!entry.text.trim()) continue
      if (entry.role !== currentRole) {
        flush()
        currentRole = entry.role
        if (collapsed.length >= maxTurns) break
      }
      bundle.push(entry.text.trim())
    }
    flush()

    if (collapsed.length > maxTurns) collapsed.length = maxTurns

    // We walked newest → oldest; reverse for chronological ChatMessage order.
    return collapsed.reverse()
  }

  /**
   * Newline-delimited JSON serialization (.jsonl) — append-friendly,
   * easy to inspect with `cat conversation.jsonl | jq`.
   */
  serialize(): string {
    return this.entries.map((entry) => JSON.stringify(entry)).join('\n')
  }

  size(): number {
    return this.entries.length
  }
}
