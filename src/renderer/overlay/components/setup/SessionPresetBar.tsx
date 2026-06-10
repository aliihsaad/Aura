import { useEffect, useState } from 'react'
import { Bookmark, Check, Plus, X } from 'lucide-react'
import type { SessionPreset } from '@shared/types'

interface SessionPresetBarProps {
  /** Active mode in the wizard. Save-button captures this with the form state. */
  agentMode: 'companion'
  /** Snapshot of the current child form, gathered when the user clicks Save. */
  getCurrentContext: () => SessionPreset['context']
  /** Called after a preset is applied. Parent should adopt the agentMode and
   * reload the matching child form so its inputs reflect the preset. */
  onApplyPreset: (preset: SessionPreset) => void
}

/**
 * Horizontal chip row above the mode tabs in SessionSetup. Lets the user
 * one-click apply a saved preset (e.g. "Tuesday Ironhack class") instead
 * of refilling every field. Includes a "Save current" affordance that
 * captures the live form state.
 */
export default function SessionPresetBar({
  agentMode,
  getCurrentContext,
  onApplyPreset,
}: SessionPresetBarProps) {
  const [presets, setPresets] = useState<SessionPreset[]>([])
  const [savingName, setSavingName] = useState<string | null>(null) // null = idle, '' = prompting
  const [justSavedId, setJustSavedId] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    const list = (await window.api.listSessionPresets?.()) ?? []
    setPresets(list as SessionPreset[])
  }

  useEffect(() => {
    void reload()
  }, [])

  const handleApply = async (preset: SessionPreset): Promise<void> => {
    onApplyPreset(preset)
    void window.api.touchSessionPreset?.(preset.id)
    void reload()
  }

  const handleDelete = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    await window.api.deleteSessionPreset?.(id)
    void reload()
  }

  const handleSave = async (): Promise<void> => {
    const name = (savingName ?? '').trim()
    if (!name) return
    const saved = await window.api.saveSessionPreset?.({
      name,
      agentMode,
      context: getCurrentContext() as Record<string, unknown>,
    })
    setSavingName(null)
    if (saved) {
      setJustSavedId(saved.id)
      setTimeout(() => setJustSavedId(null), 2000)
    }
    void reload()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Bookmark size={11} className="text-white/30" />
        <p className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">
          Presets
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const isFresh = preset.id === justSavedId
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleApply(preset)}
              className={`group inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all ${
                isFresh
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/[0.06] bg-white/[0.025] text-white/65 hover:bg-white/[0.05] hover:text-white/85 hover:border-white/[0.1]'
              }`}
              title={`${preset.agentMode} • ${preset.context.companyName || ''} ${preset.context.subject ? `• ${preset.context.subject}` : ''}`}
            >
              {isFresh ? <Check size={10} /> : null}
              <span className="max-w-[160px] truncate">{preset.name}</span>
              <span
                role="button"
                aria-label="Delete preset"
                onClick={(e) => void handleDelete(e, preset.id)}
                className="ml-0.5 rounded p-0.5 text-white/25 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
              >
                <X size={10} />
              </span>
            </button>
          )
        })}

        {savingName === null ? (
          <button
            type="button"
            onClick={() => setSavingName('')}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-white/[0.08] bg-transparent px-2 py-1 text-[11px] font-medium text-white/40 transition-all hover:border-cyan-500/25 hover:text-cyan-300/80"
          >
            <Plus size={10} />
            Save current as preset
          </button>
        ) : (
          <div className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] px-1.5 py-0.5">
            <input
              autoFocus
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
                if (e.key === 'Escape') setSavingName(null)
              }}
              placeholder="Preset name…"
              maxLength={60}
              className="w-44 bg-transparent px-1 py-0.5 text-[11px] text-white/80 placeholder:text-white/25 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!(savingName ?? '').trim()}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/15 disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setSavingName(null)}
              className="rounded px-1 py-0.5 text-[10px] text-white/40 hover:text-white/60"
              aria-label="Cancel"
            >
              <X size={10} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
