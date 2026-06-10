import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ToolDefinition } from '@shared/types'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * MCP Client Manager — Phase 2.
 *
 * Connects Aura (as an MCP *client*) to the two Vault stdio servers and
 * bridges their tools into the agent tool surface under stable namespaces:
 *
 *   vault_memory_*  → The Vault's vault-memory server (durable cross-session memory)
 *   vault_collab_*  → the vault-collab coordination server (sessions/handoffs)
 *
 * Graceful degradation is a hard requirement: if a server binary is missing
 * or refuses to start, the manager logs a warning, marks the namespace
 * unavailable, and Aura keeps working exactly as before. A dropped
 * connection is retried with the same exponential backoff envelope as the
 * Phase 1 realtime reconnect (1s × 1.5^n, cap 30s, 8 attempts).
 */

export type VaultNamespace = 'vault_memory' | 'vault_collab'

export type VaultMcpConnectionState =
  | 'disabled'      // toggled off in settings
  | 'unavailable'   // server command not found on this machine
  | 'disconnected'  // not connected (initial, or gave up reconnecting)
  | 'connecting'
  | 'connected'

export interface VaultMcpServerConfig {
  namespace: VaultNamespace
  displayName: string
  command: string
  args: string[]
  env?: Record<string, string>
  /** When set and the path does not exist, skip spawn attempts entirely. */
  requiredPath?: string
}

export interface VaultMcpToolInfo {
  /** Original tool name on the server (e.g. `vault_recall_context`). */
  name: string
  /** Namespaced name exposed to the agent (e.g. `vault_memory_recall_context`). */
  bridgedName: string
  description: string
  inputSchema: Record<string, any>
}

export interface VaultMcpStatusSnapshot {
  vault_memory: { state: VaultMcpConnectionState; toolCount: number }
  vault_collab: { state: VaultMcpConnectionState; toolCount: number }
}

// Same backoff envelope as the Phase 1 realtime WS reconnect.
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_BACKOFF_FACTOR = 1.5
const RECONNECT_MAX_DELAY_MS = 30_000
const RECONNECT_MAX_ATTEMPTS = 8
const CONNECT_TIMEOUT_MS = 90_000
const TOOL_CALL_TIMEOUT_MS = 30_000

// Only a curated subset of server tools is bridged to the agent. The
// vault-collab safety rules forbid Aura (a companion presence, not a task
// agent) from claiming/resolving handoffs or mutating coordination state,
// so its bridge is read-only. Session lifecycle calls (register/heartbeat/
// receive/disconnect) go through AuraCollabSession, not the agent.
const BRIDGED_TOOL_ALLOWLIST: Record<VaultNamespace, Set<string>> = {
  vault_memory: new Set([
    'vault_recall_context',
    'vault_save_memory',
    'vault_find_memory',
    'vault_get_memory_detail',
    'vault_get_latest',
    'vault_list_projects',
    'vault_get_project_briefing',
    'vault_suggest_save_path',
    'vault_count_open_loops',
    'vault_list_open_loops',
  ]),
  vault_collab: new Set([
    'vault_collab_list_sessions',
    'vault_collab_list_inbox',
    'vault_collab_get_handoff_detail',
    'vault_collab_list_discussion_threads',
    'vault_collab_get_discussion_thread',
    'vault_collab_list_events',
  ]),
}

interface ManagedServer {
  config: VaultMcpServerConfig
  enabled: boolean
  state: VaultMcpConnectionState
  client: Client | null
  tools: VaultMcpToolInfo[]
  reconnectAttempts: number
  reconnectTimer: NodeJS.Timeout | null
  /** Guards against the onclose handler firing during intentional shutdown. */
  closingIntentionally: boolean
}

export type VaultMcpStatusListener = (namespace: VaultNamespace, state: VaultMcpConnectionState) => void

export class McpClientManager {
  private servers = new Map<VaultNamespace, ManagedServer>()
  private statusListeners = new Set<VaultMcpStatusListener>()
  private shuttingDown = false

  constructor(configs: VaultMcpServerConfig[], enabledByNamespace: Record<VaultNamespace, boolean>) {
    for (const config of configs) {
      this.servers.set(config.namespace, {
        config,
        enabled: enabledByNamespace[config.namespace] ?? true,
        state: enabledByNamespace[config.namespace] === false ? 'disabled' : 'disconnected',
        client: null,
        tools: [],
        reconnectAttempts: 0,
        reconnectTimer: null,
        closingIntentionally: false,
      })
    }
  }

  onStatusChange(listener: VaultMcpStatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  async connectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.servers.keys()].map((namespace) => this.connect(namespace))
    )
  }

  async disconnectAll(): Promise<void> {
    this.shuttingDown = true
    await Promise.allSettled(
      [...this.servers.keys()].map((namespace) => this.disconnect(namespace))
    )
  }

  async connect(namespace: VaultNamespace): Promise<void> {
    const server = this.servers.get(namespace)
    if (!server) return
    if (!server.enabled) {
      this.setState(server, 'disabled')
      return
    }
    if (server.state === 'connected' || server.state === 'connecting') return

    if (server.config.requiredPath && !fs.existsSync(server.config.requiredPath)) {
      console.warn(
        `[MCP] ${server.config.displayName}: server not found at ${server.config.requiredPath} — continuing without it.`
      )
      this.setState(server, 'unavailable')
      return
    }

    this.setState(server, 'connecting')
    try {
      const transport = new StdioClientTransport({
        command: server.config.command,
        args: server.config.args,
        env: { ...getDefaultEnvironment(), ...(server.config.env ?? {}) },
        stderr: 'ignore',
      })
      const client = new Client({ name: 'aura-desktop', version: '1.0.0' })
      client.onclose = () => this.handleUnexpectedClose(namespace)
      client.onerror = (err) => {
        console.warn(`[MCP] ${server.config.displayName}: transport error:`, err?.message ?? err)
      }

      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })

      const listed = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS })
      server.client = client
      server.tools = (listed.tools ?? [])
        .filter((tool) => BRIDGED_TOOL_ALLOWLIST[namespace].has(tool.name))
        .map((tool) => ({
          name: tool.name,
          bridgedName: bridgeToolName(namespace, tool.name),
          description: tool.description ?? tool.name,
          inputSchema: sanitizeToolSchema(
            (tool.inputSchema as Record<string, any>) ?? { type: 'object', properties: {} }
          ),
        }))
      server.reconnectAttempts = 0
      this.setState(server, 'connected')
      console.log(
        `[MCP] ${server.config.displayName}: connected (${server.tools.length} bridged tools).`
      )
    } catch (err) {
      server.client = null
      server.tools = []
      this.setState(server, 'disconnected')
      console.warn(
        `[MCP] ${server.config.displayName}: connection failed — Aura continues without it.`,
        err instanceof Error ? err.message : err
      )
      this.scheduleReconnect(namespace)
    }
  }

  async disconnect(namespace: VaultNamespace): Promise<void> {
    const server = this.servers.get(namespace)
    if (!server) return
    if (server.reconnectTimer) {
      clearTimeout(server.reconnectTimer)
      server.reconnectTimer = null
    }
    server.closingIntentionally = true
    try {
      await server.client?.close()
    } catch {
      // already gone — nothing to clean up
    }
    server.client = null
    server.tools = []
    server.closingIntentionally = false
    this.setState(server, server.enabled ? 'disconnected' : 'disabled')
  }

  /** Toggle a namespace on/off at runtime (Settings → Memory & Sync). */
  async setEnabled(namespace: VaultNamespace, enabled: boolean): Promise<void> {
    const server = this.servers.get(namespace)
    if (!server || server.enabled === enabled) return
    server.enabled = enabled
    if (enabled) {
      this.setState(server, 'disconnected')
      await this.connect(namespace)
    } else {
      await this.disconnect(namespace)
    }
  }

  isConnected(namespace: VaultNamespace): boolean {
    return this.servers.get(namespace)?.state === 'connected'
  }

  getAvailableTools(namespace: VaultNamespace): VaultMcpToolInfo[] {
    return [...(this.servers.get(namespace)?.tools ?? [])]
  }

  getStatusSnapshot(): VaultMcpStatusSnapshot {
    const snapshot = (namespace: VaultNamespace) => {
      const server = this.servers.get(namespace)
      return {
        state: server?.state ?? 'unavailable',
        toolCount: server?.tools.length ?? 0,
      }
    }
    return { vault_memory: snapshot('vault_memory'), vault_collab: snapshot('vault_collab') }
  }

  /**
   * Call a tool by its original server name. Throws when the namespace is
   * not connected — callers on optional paths catch and degrade.
   */
  async callTool(
    namespace: VaultNamespace,
    toolName: string,
    args: Record<string, any>,
    timeoutMs: number = TOOL_CALL_TIMEOUT_MS
  ): Promise<string> {
    const server = this.servers.get(namespace)
    if (!server || server.state !== 'connected' || !server.client) {
      throw new Error(`${namespace} is not connected`)
    }
    const result = await server.client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout: timeoutMs,
    })
    const text = renderToolResultText(result.content)
    if (result.isError) {
      throw new Error(text || `${toolName} reported an error`)
    }
    return text
  }

  // ── Agent tool bridge ──────────────────────────────────────────────────────

  hasBridgedTool(bridgedName: string): boolean {
    return Boolean(this.resolveBridgedTool(bridgedName))
  }

  /** Discovered tools as OpenRouter-style function definitions for the agent. */
  getBridgedToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = []
    for (const server of this.servers.values()) {
      if (server.state !== 'connected') continue
      for (const tool of server.tools) {
        definitions.push({
          type: 'function',
          function: {
            name: tool.bridgedName,
            description: tool.description.slice(0, 1024),
            parameters: tool.inputSchema,
          },
        })
      }
    }
    return definitions
  }

  /** Execute a bridged (namespaced) tool call coming from the agent. */
  async callBridgedTool(bridgedName: string, args: Record<string, any>): Promise<string> {
    const resolved = this.resolveBridgedTool(bridgedName)
    if (!resolved) {
      return `Tool "${bridgedName}" is not available right now (Vault server offline or tool not bridged).`
    }
    return this.callTool(resolved.namespace, resolved.toolName, args)
  }

  private resolveBridgedTool(bridgedName: string): { namespace: VaultNamespace; toolName: string } | null {
    for (const [namespace, server] of this.servers) {
      if (server.state !== 'connected') continue
      const tool = server.tools.find((t) => t.bridgedName === bridgedName)
      if (tool) return { namespace, toolName: tool.name }
    }
    return null
  }

  // ── Reconnect ──────────────────────────────────────────────────────────────

  private handleUnexpectedClose(namespace: VaultNamespace): void {
    const server = this.servers.get(namespace)
    if (!server || server.closingIntentionally || this.shuttingDown) return
    if (server.state !== 'connected' && server.state !== 'connecting') return
    console.warn(`[MCP] ${server.config.displayName}: connection lost.`)
    server.client = null
    server.tools = []
    this.setState(server, 'disconnected')
    this.scheduleReconnect(namespace)
  }

  private scheduleReconnect(namespace: VaultNamespace): void {
    const server = this.servers.get(namespace)
    if (!server || !server.enabled || this.shuttingDown) return
    if (server.reconnectTimer) return
    if (server.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.warn(
        `[MCP] ${server.config.displayName}: giving up after ${RECONNECT_MAX_ATTEMPTS} reconnect attempts.`
      )
      return
    }

    server.reconnectAttempts += 1
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, server.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    )
    console.log(
      `[MCP] ${server.config.displayName}: reconnect attempt ${server.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS} in ${Math.round(delay)}ms`
    )
    server.reconnectTimer = setTimeout(() => {
      server.reconnectTimer = null
      void this.connect(namespace)
    }, delay)
  }

  private setState(server: ManagedServer, state: VaultMcpConnectionState): void {
    if (server.state === state) return
    server.state = state
    for (const listener of this.statusListeners) {
      try {
        listener(server.config.namespace, state)
      } catch (err) {
        console.warn('[MCP] status listener failed:', err)
      }
    }
  }
}

// ── Naming ─────────────────────────────────────────────────────────────────

/**
 * Server tool names already carry a `vault_` prefix (`vault_recall_context`,
 * `vault_collab_list_sessions`). Normalize so every bridged name starts with
 * exactly one namespace prefix:
 *   vault_memory + vault_recall_context      → vault_memory_recall_context
 *   vault_collab + vault_collab_list_sessions → vault_collab_list_sessions
 */
function bridgeToolName(namespace: VaultNamespace, toolName: string): string {
  if (toolName.startsWith(`${namespace}_`)) return toolName
  const stripped = toolName.replace(/^vault_/, '')
  return `${namespace}_${stripped}`
}

/**
 * Reduce an MCP JSON Schema to the conservative subset every consumer
 * accepts. The Gemini Live setup message (realtime engine) rejects
 * draft-07 keys like $schema / additionalProperties, so keep only the
 * OpenAPI-style fields; OpenRouter tolerates the same subset.
 */
const SCHEMA_KEEP_KEYS = new Set([
  'type', 'description', 'enum', 'properties', 'required', 'items',
  'minimum', 'maximum', 'minLength', 'maxLength', 'format', 'default',
])

function sanitizeToolSchema(schema: Record<string, any>): Record<string, any> {
  const sanitize = (node: any): any => {
    if (Array.isArray(node)) return node.map(sanitize)
    if (!node || typeof node !== 'object') return node
    const out: Record<string, any> = {}
    for (const [key, value] of Object.entries(node)) {
      if (!SCHEMA_KEEP_KEYS.has(key)) continue
      if (key === 'properties' && value && typeof value === 'object') {
        const props: Record<string, any> = {}
        for (const [propName, propSchema] of Object.entries(value as Record<string, any>)) {
          props[propName] = sanitize(propSchema)
        }
        out.properties = props
      } else if (key === 'items') {
        out.items = sanitize(value)
      } else {
        out[key] = value
      }
    }
    // A property node carrying only composition keys (anyOf/oneOf) loses its
    // type above — fall back to string so the declaration stays valid.
    if (!out.type && !out.properties && !out.items && !out.enum) out.type = 'string'
    return out
  }
  const sanitized = sanitize(schema)
  if (!sanitized.type) sanitized.type = 'object'
  if (sanitized.type === 'object' && !sanitized.properties) sanitized.properties = {}
  return sanitized
}

function renderToolResultText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const parts: string[] = []
  for (const item of content) {
    if (item && typeof item === 'object' && (item as any).type === 'text') {
      parts.push(String((item as any).text ?? ''))
    }
  }
  return parts.join('\n').trim()
}

// ── Default server configs ─────────────────────────────────────────────────

export interface VaultServerConfigOverrides {
  memoryCommand?: string
  memoryArgs?: string[]
  collabCommand?: string
  collabArgs?: string[]
}

/**
 * Resolve launch configs for both Vault servers. Matches the transport The
 * Vault itself uses (stdio, see the-vault/mcp-standalone and ~/.claude.json):
 *
 *   vault-memory: the standalone node.exe + dist/index.js shipped inside the
 *                 installed The Vault app resources.
 *   vault-collab: `npm exec --package github:aliihsaad/vault-collab --
 *                 vault-collab-mcp --db <home>/Vault/extensions/vault-collab/...`
 *
 * Nothing is hard-wired: env vars beat stored config, stored config beats
 * the defaults derived from the user's home directory.
 */
export function resolveVaultServerConfigs(overrides: VaultServerConfigOverrides = {}): VaultMcpServerConfig[] {
  const home = os.homedir()

  const memoryDefaultRoot = path.join(home, 'AppData', 'Local', 'Programs', 'The Vault', 'resources', 'mcp')
  const memoryCommand =
    process.env.VAULT_MEMORY_MCP_COMMAND ||
    overrides.memoryCommand ||
    path.join(memoryDefaultRoot, 'node.exe')
  const memoryArgs =
    parseEnvArgs(process.env.VAULT_MEMORY_MCP_ARGS) ||
    overrides.memoryArgs ||
    [path.join(memoryDefaultRoot, 'dist', 'index.js')]

  const collabDb = path.join(home, 'Vault', 'extensions', 'vault-collab', 'vault-collab.db')
  const npmExecArgs = [
    'exec', '--yes',
    '--package', 'https://github.com/aliihsaad/vault-collab',
    '--', 'vault-collab-mcp',
    '--db', collabDb,
  ]
  // On Windows `npm` is a .cmd shim, which plain spawn() can't execute —
  // route through cmd /c exactly like a shell would.
  const collabDefaultCommand = process.platform === 'win32' ? 'cmd' : 'npm'
  const collabDefaultArgs = process.platform === 'win32' ? ['/c', 'npm', ...npmExecArgs] : npmExecArgs
  const collabCommand = process.env.VAULT_COLLAB_MCP_COMMAND || overrides.collabCommand || collabDefaultCommand
  const collabArgs = parseEnvArgs(process.env.VAULT_COLLAB_MCP_ARGS) || overrides.collabArgs || collabDefaultArgs

  return [
    {
      namespace: 'vault_memory',
      displayName: 'vault-memory',
      command: memoryCommand,
      args: memoryArgs,
      // Only gate on the default install path; custom commands may rely on PATH.
      requiredPath: path.isAbsolute(memoryCommand) ? memoryCommand : undefined,
    },
    {
      namespace: 'vault_collab',
      displayName: 'vault-collab',
      command: collabCommand,
      args: collabArgs,
    },
  ]
}

function parseEnvArgs(raw: string | undefined): string[] | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // fall through to whitespace split
    }
  }
  return trimmed.split(/\s+/)
}
