import * as fs from 'fs'
import * as path from 'path'

/**
 * Per-session telemetry. Writes one JSONL file per session at
 * `<sessionFolder>/telemetry.jsonl`. Each line is one event:
 *   { ts: number, type: string, ...payload }
 *
 * Designed for forensic debugging — every silent issue we've hit
 * (dedup suppression, cooldown blocks, profile-update parse errors,
 * dropped fragments) shows up here so you can rebuild the session
 * timeline without re-running it.
 *
 * Append-only and buffered. Calls cost ~one push to an in-memory array
 * plus a setImmediate flush. fsync is intentionally skipped — the cost
 * is too high per event and a crash mid-session is fine to lose the
 * trailing few events.
 */

export type TelemetryEvent = {
  ts: number
  type: string
  [key: string]: unknown
}

class TelemetryService {
  private active: boolean = false
  private filePath: string | null = null
  private buffer: string[] = []
  private flushScheduled = false

  /** Begin recording for a new session. Truncates any existing file. */
  start(sessionFolderAbs: string): void {
    try {
      fs.mkdirSync(sessionFolderAbs, { recursive: true })
      this.filePath = path.join(sessionFolderAbs, 'telemetry.jsonl')
      this.active = true
      this.buffer = []
      // Always start with a header line so post-mortem tools can detect
      // a fresh session vs a continuation.
      this.record('telemetry.opened', { schemaVersion: 1 })
    } catch (err) {
      console.warn('[telemetry] start failed:', err)
      this.active = false
      this.filePath = null
    }
  }

  /** Stop recording and flush any pending events synchronously. */
  stop(reason?: string): void {
    if (!this.active) return
    this.record('telemetry.closed', { reason: reason ?? 'session-stop' })
    this.flushSync()
    this.active = false
    this.filePath = null
    this.buffer = []
  }

  /** Append an event. No-ops when no session is active. */
  record(type: string, payload: Record<string, unknown> = {}): void {
    if (!this.active || !this.filePath) return
    const event: TelemetryEvent = { ts: Date.now(), type, ...payload }
    try {
      this.buffer.push(JSON.stringify(event))
    } catch {
      // Payload had a circular reference or a non-serialisable value —
      // drop it silently rather than blowing up the heartbeat.
      return
    }
    if (!this.flushScheduled) {
      this.flushScheduled = true
      setImmediate(() => this.flushAsync())
    }
  }

  /** Best-effort async append. Errors are logged; the session keeps running. */
  private flushAsync(): void {
    this.flushScheduled = false
    if (!this.filePath || this.buffer.length === 0) return
    const chunk = this.buffer.join('\n') + '\n'
    this.buffer = []
    fs.appendFile(this.filePath, chunk, 'utf-8', (err) => {
      if (err) console.warn('[telemetry] append failed:', err)
    })
  }

  /** Synchronous flush — used at session-stop so the file is complete on disk. */
  private flushSync(): void {
    this.flushScheduled = false
    if (!this.filePath || this.buffer.length === 0) return
    const chunk = this.buffer.join('\n') + '\n'
    this.buffer = []
    try {
      fs.appendFileSync(this.filePath, chunk, 'utf-8')
    } catch (err) {
      console.warn('[telemetry] sync append failed:', err)
    }
  }
}

export const telemetry = new TelemetryService()
