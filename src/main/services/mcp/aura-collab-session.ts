import type { McpClientManager } from './mcp-client-manager'

/**
 * Aura's presence on the vault-collab coordination layer.
 *
 * Registers one session per app run, drains attention once on startup,
 * heartbeats every 60s while the app is open, and disconnects cleanly on
 * quit. Aura is a companion, not a task agent: it never claims handoffs or
 * mutates coordination state — presence and attention only.
 *
 * The owner token returned by registration stays private inside this class;
 * other services (and the renderer) only ever see the session UID.
 */

const HEARTBEAT_INTERVAL_MS = 60_000
const COLLAB_PROJECT = 'aura-desktop'

export interface AuraCollabStatus {
  connected: boolean
  sessionUid: string | null
}

export interface AuraCollabSessionDeps {
  manager: McpClientManager
  isEnabled: () => boolean
  getWorkspacePath: () => string
}

export class AuraCollabSession {
  private deps: AuraCollabSessionDeps
  private sessionUid: string | null = null
  private sessionToken: string | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private registering = false

  constructor(deps: AuraCollabSessionDeps) {
    this.deps = deps
    // Re-register automatically when the collab connection (re)appears —
    // covers both first connect after launch and post-drop reconnects.
    deps.manager.onStatusChange((namespace, state) => {
      if (namespace !== 'vault_collab') return
      if (state === 'connected') {
        void this.start()
      } else {
        this.stopHeartbeat()
        // A lost transport invalidates nothing server-side, but our stdio
        // pipe is gone; a fresh registration follows on reconnect.
        this.sessionUid = null
        this.sessionToken = null
      }
    })
  }

  getStatus(): AuraCollabStatus {
    return {
      connected: this.deps.manager.isConnected('vault_collab') && this.sessionUid !== null,
      sessionUid: this.sessionUid,
    }
  }

  /** Register presence + drain attention. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (!this.deps.isEnabled()) return
    if (!this.deps.manager.isConnected('vault_collab')) return
    if (this.sessionUid || this.registering) return

    this.registering = true
    try {
      const raw = await this.deps.manager.callTool('vault_collab', 'vault_collab_register_session', {
        // 'electron' is not a recognized clientType on the server — 'other'
        // plus an explicit display name is the closest faithful mapping.
        clientType: 'other',
        displayName: 'Aura Companion (Electron)',
        project: COLLAB_PROJECT,
        role: 'companion',
        workspacePath: this.deps.getWorkspacePath(),
        deliveryMode: 'manual_poll',
        capabilities: { companion_presence: true, auto_claim: false },
      })
      const session = parseResultObject(raw)
      const uid = String(session?.sessionUid ?? '')
      const token = String(session?.sessionToken ?? '')
      if (!uid || !token) {
        console.warn('[VaultCollab] registration response missing session uid/token — staying unregistered.')
        return
      }
      this.sessionUid = uid
      this.sessionToken = token
      console.log(`[VaultCollab] registered presence session ${uid}`)

      await this.drain().catch((err) => {
        console.warn('[VaultCollab] startup attention drain failed:', err instanceof Error ? err.message : err)
      })
      this.startHeartbeat()
    } catch (err) {
      console.warn('[VaultCollab] presence registration failed:', err instanceof Error ? err.message : err)
    } finally {
      this.registering = false
    }
  }

  /** One non-blocking attention drain. Returns a renderer-safe summary. */
  async drain(): Promise<{ drained: boolean; itemCount: number }> {
    if (!this.sessionUid || !this.sessionToken) {
      return { drained: false, itemCount: 0 }
    }
    const raw = await this.deps.manager.callTool('vault_collab', 'vault_collab_receive', {
      sessionUid: this.sessionUid,
      sessionToken: this.sessionToken,
      advanceCursor: true,
      includeCurrentHandoffs: false,
    })
    const result = parseResultObject(raw)
    const itemCount = Array.isArray(result?.items) ? result.items.length : 0
    console.log(`[VaultCollab] attention drained: ${itemCount} item(s).`)
    return { drained: true, itemCount }
  }

  /** Disconnect cleanly (app quit or settings toggle off). */
  async stop(): Promise<void> {
    this.stopHeartbeat()
    if (!this.sessionUid || !this.sessionToken) return
    const uid = this.sessionUid
    const token = this.sessionToken
    this.sessionUid = null
    this.sessionToken = null
    try {
      await this.deps.manager.callTool(
        'vault_collab',
        'vault_collab_disconnect_session',
        { sessionUid: uid, sessionToken: token },
        5_000
      )
      console.log(`[VaultCollab] presence session ${uid} disconnected.`)
    } catch (err) {
      console.warn('[VaultCollab] clean disconnect failed:', err instanceof Error ? err.message : err)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat()
    }, HEARTBEAT_INTERVAL_MS)
    // Don't let a background timer keep the process alive on quit.
    this.heartbeatTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.sessionUid || !this.sessionToken) return
    if (!this.deps.manager.isConnected('vault_collab')) return
    try {
      await this.deps.manager.callTool('vault_collab', 'vault_collab_heartbeat_session', {
        sessionUid: this.sessionUid,
        sessionToken: this.sessionToken,
      })
    } catch (err) {
      console.warn('[VaultCollab] heartbeat failed:', err instanceof Error ? err.message : err)
    }
  }
}

/** Server tools return `{"result": {...}}` as a JSON text block. */
function parseResultObject(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return (parsed.result ?? parsed) as Record<string, any>
    }
  } catch {
    // non-JSON tool output — treat as missing
  }
  return null
}
