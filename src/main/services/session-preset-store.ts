import ElectronStore from 'electron-store'
import type { SessionPreset } from '@shared/types'

const Store = (ElectronStore as any).default || ElectronStore

const store = new Store({
  name: 'whisphry-session-presets',
  defaults: {
    presets: [] as SessionPreset[],
  },
})

const MAX_PRESETS = 24
const MAX_NAME_LENGTH = 60

function nowId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function read(): SessionPreset[] {
  const raw = store.get('presets') as SessionPreset[] | undefined
  if (!Array.isArray(raw)) return []
  return raw
}

function write(presets: SessionPreset[]): void {
  store.set('presets', presets)
}

function sanitizeName(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
}

export function listSessionPresets(): SessionPreset[] {
  return read()
    .slice()
    .sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt))
}

export function getSessionPresetById(id: string): SessionPreset | undefined {
  return read().find((p) => p.id === id)
}

export function saveSessionPreset(
  input: Omit<SessionPreset, 'id' | 'createdAt'> & { id?: string }
): SessionPreset {
  const name = sanitizeName(input.name)
  if (!name) throw new Error('preset name is required')

  const all = read()
  // Update if id matches, else create.
  if (input.id) {
    const idx = all.findIndex((p) => p.id === input.id)
    if (idx >= 0) {
      const updated: SessionPreset = {
        ...all[idx],
        name,
        agentMode: input.agentMode,
        context: input.context,
      }
      all[idx] = updated
      write(all)
      return updated
    }
  }

  // Replace by name (case-insensitive) so users don't accumulate duplicates.
  const lowered = name.toLowerCase()
  const dupeIdx = all.findIndex((p) => p.name.toLowerCase() === lowered)
  if (dupeIdx >= 0) {
    const updated: SessionPreset = {
      ...all[dupeIdx],
      name,
      agentMode: input.agentMode,
      context: input.context,
    }
    all[dupeIdx] = updated
    write(all)
    return updated
  }

  const created: SessionPreset = {
    id: nowId(),
    name,
    agentMode: input.agentMode,
    context: input.context,
    createdAt: Date.now(),
  }
  const next = [created, ...all].slice(0, MAX_PRESETS)
  write(next)
  return created
}

export function deleteSessionPreset(id: string): boolean {
  const all = read()
  const next = all.filter((p) => p.id !== id)
  if (next.length === all.length) return false
  write(next)
  return true
}

export function touchSessionPreset(id: string): SessionPreset | undefined {
  const all = read()
  const idx = all.findIndex((p) => p.id === id)
  if (idx < 0) return undefined
  const touched: SessionPreset = { ...all[idx], lastUsedAt: Date.now() }
  all[idx] = touched
  write(all)
  return touched
}
