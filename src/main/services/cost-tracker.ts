/**
 * Per-session token usage tracker. Sums prompt + completion tokens across
 * every LLM call (heartbeat, profile-update, voice-update, brain ticks)
 * for the current session. Reset on session start, read by the overlay
 * for the running cost meter.
 *
 * Tokens-only — pricing data goes stale too fast to embed. Multiply
 * totals by current OpenRouter rates externally if you need USD.
 */

export interface UsageSnapshot {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callCount: number
  byModel: Record<string, { promptTokens: number; completionTokens: number; calls: number }>
}

class CostTracker {
  private snapshot: UsageSnapshot = this.empty()
  private listeners = new Set<(snapshot: UsageSnapshot) => void>()

  reset(): void {
    this.snapshot = this.empty()
    this.broadcast()
  }

  add(model: string, promptTokens: number, completionTokens: number): void {
    if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return
    const p = Math.max(0, Math.floor(Number(promptTokens) || 0))
    const c = Math.max(0, Math.floor(Number(completionTokens) || 0))
    if (p === 0 && c === 0) return

    this.snapshot.promptTokens += p
    this.snapshot.completionTokens += c
    this.snapshot.totalTokens = this.snapshot.promptTokens + this.snapshot.completionTokens
    this.snapshot.callCount += 1

    const slug = model || 'unknown'
    if (!this.snapshot.byModel[slug]) {
      this.snapshot.byModel[slug] = { promptTokens: 0, completionTokens: 0, calls: 0 }
    }
    this.snapshot.byModel[slug].promptTokens += p
    this.snapshot.byModel[slug].completionTokens += c
    this.snapshot.byModel[slug].calls += 1

    this.broadcast()
  }

  get(): UsageSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  subscribe(listener: (snapshot: UsageSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private empty(): UsageSnapshot {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
      byModel: {},
    }
  }

  private broadcast(): void {
    const snap = cloneSnapshot(this.snapshot)
    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch (err) {
        console.warn('[cost-tracker] listener threw:', err)
      }
    }
  }
}

function cloneSnapshot(snap: UsageSnapshot): UsageSnapshot {
  return {
    promptTokens: snap.promptTokens,
    completionTokens: snap.completionTokens,
    totalTokens: snap.totalTokens,
    callCount: snap.callCount,
    byModel: Object.fromEntries(
      Object.entries(snap.byModel).map(([k, v]) => [
        k,
        { promptTokens: v.promptTokens, completionTokens: v.completionTokens, calls: v.calls },
      ])
    ),
  }
}

export const costTracker = new CostTracker()
