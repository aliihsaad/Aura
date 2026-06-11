import React, { useCallback, useEffect, useState } from 'react'
import { Link2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'

/**
 * Memory & Sync — Vault MCP connections (Phase 2).
 *
 * Two master toggles (vault-memory / vault-collab presence) with live
 * connection dots, plus per-tool toggles for every bridged Vault tool so the
 * user controls exactly what the agent may call.
 */

type ConnectionState = 'disabled' | 'unavailable' | 'disconnected' | 'connecting' | 'connected'

interface VaultToolStatus {
  namespace: 'vault_memory' | 'vault_collab'
  name: string
  description: string
  enabled: boolean
}

interface VaultMcpStatus {
  vaultMemory: { state: ConnectionState; toolCount: number; enabled: boolean }
  vaultCollab: { state: ConnectionState; toolCount: number; enabled: boolean; sessionUid: string | null }
  tools: VaultToolStatus[]
}

const STATE_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  unavailable: 'Not installed',
  disabled: 'Off',
}

function StatusDot({ state }: { state: ConnectionState }) {
  const color =
    state === 'connected'
      ? 'bg-emerald-400'
      : state === 'connecting'
        ? 'bg-amber-400'
        : 'bg-red-400/80'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color} ${state === 'connecting' ? 'animate-pulse' : ''}`} />
      <span className="text-[11px] text-white/40">{STATE_LABELS[state]}</span>
    </span>
  )
}

export default function VaultSyncSettings() {
  const [status, setStatus] = useState<VaultMcpStatus | null>(null)
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [memoryProject, setMemoryProject] = useState('')
  const [collabEnabled, setCollabEnabled] = useState(true)
  const [disabledTools, setDisabledTools] = useState<string[]>([])
  const [draining, setDraining] = useState(false)
  const [drainNote, setDrainNote] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await (window.api as any).vaultMcpStatus()
      if (next) setStatus(next as VaultMcpStatus)
    } catch {
      // main process not ready yet — next poll picks it up
    }
  }, [])

  useEffect(() => {
    void (window.api.getConfig() as Promise<any>).then((config) => {
      setMemoryEnabled(config?.vaultMemoryEnabled ?? true)
      setMemoryProject(typeof config?.vaultMemoryProject === 'string' ? config.vaultMemoryProject : '')
      setCollabEnabled(config?.vaultCollabEnabled ?? true)
      setDisabledTools(Array.isArray(config?.vaultDisabledTools) ? config.vaultDisabledTools : [])
    })
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const saveMemoryProject = async (value: string) => {
    await window.api.setConfig({ vaultMemoryProject: value.trim() })
  }

  const setServerEnabled = async (key: 'vaultMemoryEnabled' | 'vaultCollabEnabled', value: boolean) => {
    if (key === 'vaultMemoryEnabled') setMemoryEnabled(value)
    else setCollabEnabled(value)
    await window.api.setConfig({ [key]: value })
    // connection state flips asynchronously — poll right after the toggle
    setTimeout(() => void refresh(), 750)
  }

  const toggleTool = async (toolName: string) => {
    const next = disabledTools.includes(toolName)
      ? disabledTools.filter((name) => name !== toolName)
      : [...disabledTools, toolName]
    setDisabledTools(next)
    await window.api.setConfig({ vaultDisabledTools: next })
    void refresh()
  }

  const drainNow = async () => {
    setDraining(true)
    setDrainNote('')
    try {
      const result = await (window.api as any).vaultCollabDrain()
      setDrainNote(
        result?.success
          ? `Drained ${result.itemCount ?? 0} attention item(s).`
          : `Drain failed: ${result?.error ?? 'not registered'}`
      )
    } catch (err: any) {
      setDrainNote(`Drain failed: ${err?.message ?? err}`)
    } finally {
      setDraining(false)
      setTimeout(() => setDrainNote(''), 5000)
    }
  }

  const memoryState: ConnectionState = status?.vaultMemory.state ?? (memoryEnabled ? 'connecting' : 'disabled')
  const collabState: ConnectionState = status?.vaultCollab.state ?? (collabEnabled ? 'connecting' : 'disabled')
  const memoryTools = (status?.tools ?? []).filter((tool) => tool.namespace === 'vault_memory')
  const collabTools = (status?.tools ?? []).filter((tool) => tool.namespace === 'vault_collab')

  const toolRow = (tool: VaultToolStatus) => {
    const enabled = !disabledTools.includes(tool.name)
    return (
      <div key={tool.name} className="flex items-center justify-between gap-3 py-1.5">
        <div className="min-w-0">
          <div className={`text-[11.5px] font-mono ${enabled ? 'text-white/60' : 'text-white/25 line-through'}`}>
            {tool.name}
          </div>
          <div className="text-[10.5px] text-white/25 truncate">{tool.description}</div>
        </div>
        <button onClick={() => void toggleTool(tool.name)} className="shrink-0 text-white/60 hover:text-white/80 transition-colors">
          {enabled ? <ToggleRight size={22} className="text-blue-400" /> : <ToggleLeft size={22} />}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link2 size={14} className="text-white/25" />
        <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
          Memory &amp; Sync
        </h3>
      </div>

      <div className="glass-card rounded-2xl p-7 space-y-5">
        {/* vault-memory */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[12.5px] text-white/60">Vault memory</span>
                <StatusDot state={memoryState} />
              </div>
              <div className="text-[11px] text-white/30 mt-0.5">
                Durable cross-session memory. Recalls relevant context when a session starts and
                saves a session summary when it ends.
              </div>
            </div>
            <button
              onClick={() => void setServerEnabled('vaultMemoryEnabled', !memoryEnabled)}
              className="text-white/60 hover:text-white/80 transition-colors"
            >
              {memoryEnabled ? <ToggleRight size={28} className="text-blue-400" /> : <ToggleLeft size={28} />}
            </button>
          </div>
          {memoryEnabled && (
            <div className="mt-3">
              <label className="block text-[10.5px] text-white/30 uppercase tracking-wider mb-1.5">
                Vault memory project
              </label>
              <input
                type="text"
                value={memoryProject}
                onChange={(e) => setMemoryProject(e.target.value)}
                onBlur={() => void saveMemoryProject(memoryProject)}
                placeholder="e.g. Aura-Brain"
                spellCheck={false}
                className="w-full rounded-xl bg-black/20 border border-white/[0.06] px-3 py-2 text-[12px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-blue-400/40 transition-colors"
              />
              <p className="text-[10.5px] text-white/25 mt-1.5">
                Memories save to and recall from this existing Vault project. Leave empty to keep
                Vault memory off — Aura never creates projects on its own.
              </p>
            </div>
          )}
          {memoryEnabled && memoryTools.length > 0 && (
            <div className="mt-3 ml-1 border-l border-white/5 pl-4">
              <div className="text-[10.5px] text-white/30 uppercase tracking-wider mb-1">Agent tools</div>
              {memoryTools.map(toolRow)}
            </div>
          )}
        </div>

        <div className="border-t border-white/4" />

        {/* vault-collab */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[12.5px] text-white/60">Vault collab presence</span>
                <StatusDot state={collabState} />
              </div>
              <div className="text-[11px] text-white/30 mt-0.5">
                Registers Aura on the shared coordination layer. Reading is automatic; any write
                (publish, claim, resolve…) requires your per-action confirmation.
                {status?.vaultCollab.sessionUid && (
                  <span className="block font-mono text-white/20 mt-0.5 truncate">
                    {status.vaultCollab.sessionUid}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => void setServerEnabled('vaultCollabEnabled', !collabEnabled)}
              className="text-white/60 hover:text-white/80 transition-colors"
            >
              {collabEnabled ? <ToggleRight size={28} className="text-blue-400" /> : <ToggleLeft size={28} />}
            </button>
          </div>
          {collabEnabled && (
            <div className="mt-3 ml-1 border-l border-white/5 pl-4 space-y-2">
              {collabTools.length > 0 && (
                <div>
                  <div className="text-[10.5px] text-white/30 uppercase tracking-wider mb-1">
                    Agent tools — writes always ask you first
                  </div>
                  {collabTools.map(toolRow)}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void drainNow()}
                  disabled={draining || collabState !== 'connected'}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-blue-400/80 bg-blue-500/[0.06] border border-blue-500/[0.1] hover:bg-blue-500/[0.12] disabled:opacity-40 transition-all"
                >
                  <RefreshCw size={11} className={draining ? 'animate-spin' : ''} />
                  Drain attention
                </button>
                {drainNote && <span className="text-[10.5px] text-white/35">{drainNote}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
