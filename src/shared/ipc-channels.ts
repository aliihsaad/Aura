/**
 * Typed IPC channel registry — Phase 0 of the mode-isolation refactor.
 *
 * Three namespaces:
 *   mode:<mode>:<event>      Per-mode events. Renderers subscribe per active mode.
 *   window:<window>:<event>  Window-level events (open / close / focus / resize / bounds).
 *   kernel:<service>:<event> Shared kernel events (config, stt, clipboard, mode-active, …).
 *
 * Today's flat channels in `IPC` (re-exported below) keep working. New code
 * authored after Phase 0 declares its channel here so the renderer can
 * subscribe per-mode and the main process can prove "one writer per window".
 *
 * The migration plan in `docs/superpowers/plans/2026-04-28-mode-isolation.md`
 * §5 has the full old → new mapping.
 */

import { IPC } from './types'
import type {
  AgentMode,
  AnswerDonePayload,
  ModelSelectionInfo,
} from './types'

export { IPC }

// ── Mode channels ───────────────────────────────────────────

export type Mode = 'companion'

export type ModeChannel<M extends Mode, E extends string> = `mode:${M}:${E}`

export function modeChannel<M extends Mode, E extends string>(mode: M, event: E): ModeChannel<M, E> {
  return `mode:${mode}:${event}` as ModeChannel<M, E>
}

export const ModeChannels = {
  answer: {
    question: 'mode:answer:question',
    answerToken: 'mode:answer:token',
    answerEnd: 'mode:answer:end',
    answerError: 'mode:answer:error',
    modelSelection: 'mode:answer:model-selection',
    presence: 'mode:answer:presence',
  },
  companion: {
    bubbleStart: 'mode:companion:bubble:start',
    bubbleToken: 'mode:companion:bubble:token',
    bubbleEnd: 'mode:companion:bubble:end',
    presence: 'mode:companion:presence',
  },
} as const

// ── Window channels ─────────────────────────────────────────

export type WindowName = 'overlay' | 'answer' | 'canvas' | 'preview' | 'settings'
export type WindowChannel<W extends WindowName, E extends string> = `window:${W}:${E}`

export function windowChannel<W extends WindowName, E extends string>(window: W, event: E): WindowChannel<W, E> {
  return `window:${window}:${event}` as WindowChannel<W, E>
}

// ── Kernel channels ─────────────────────────────────────────

export type KernelChannel<S extends string, E extends string> = `kernel:${S}:${E}`

export function kernelChannel<S extends string, E extends string>(service: S, event: E): KernelChannel<S, E> {
  return `kernel:${service}:${event}` as KernelChannel<S, E>
}

export const KernelChannels = {
  /** Single source-of-truth event whenever the active mode changes. */
  modeActive: 'kernel:mode:active' as const,
  configSet: 'kernel:config:set' as const,
  configData: 'kernel:config:data' as const,
  sttReconnecting: 'kernel:stt:reconnecting' as const,
  clipboardWrite: 'kernel:clipboard:write' as const,
} as const

// ── Channel payload contracts (populated by later phases) ───
//
// Each phase adds entries here as it migrates a channel from the legacy
// flat `IPC` constant to the new namespace. Until a channel appears below,
// the legacy IPC name is the source of truth.
//
// Renderers and main-process code can use this to subscribe in a
// type-checked way (see future preload-bridge work in phase 5).

export interface ChannelPayloads {
  'kernel:mode:active': AgentMode
  'mode:answer:question': string
  'mode:answer:model-selection': ModelSelectionInfo
  'mode:answer:token': string
  'mode:answer:end': string | AnswerDonePayload
}

export type ChannelName = keyof ChannelPayloads
