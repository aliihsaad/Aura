/**
 * SessionSetup shell — Phase 4 of the mode-isolation refactor.
 *
 * Reads the active agent mode (single source of truth from config),
 * renders a compact mode-tab header so the user can change mode
 * before starting (the picker also lives in Settings/overlay), then
 * delegates to the matching per-mode setup component.
 *
 * Each child component owns its own field state and emits a
 * SessionContext via `onStart`. The shell owns the bottom button bar
 * (Next / Start / Skip / Cancel) and passes it back to the child via
 * `renderFooter` so the child can decide which buttons make sense for
 * its step layout.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageSquareMore, Sparkles } from 'lucide-react'
import type { AgentMode, SessionContext, SessionPreset } from '@shared/types'

import InterviewSetup from './InterviewSetup'
import CompanionSetup from './CompanionSetup'
import SessionPresetBar from './SessionPresetBar'

interface SessionSetupProps {
  onStart: (ctx: SessionContext) => void
  onSkip: () => void
  onCancel: () => void
}

type SetupMode = 'interview' | 'companion'

const SETUP_MODES: Array<{
  value: SetupMode
  label: string
  description: string
  icon: typeof MessageSquareMore
}> = [
  { value: 'interview', label: 'Live Session', description: 'Speech-led support for interviews, meetings, presentations, and classes.', icon: MessageSquareMore },
  { value: 'companion', label: 'Companion', description: 'Quick chat overlay with bubble replies.', icon: Sparkles },
]

function agentModeToSetupMode(agentMode?: AgentMode | null): SetupMode {
  if (agentMode === 'companion') return 'companion'
  return 'interview'
}

function setupModeToAgentMode(setup: SetupMode): AgentMode {
  return setup === 'companion' ? 'companion' : 'interview'
}

export default function SessionSetup({ onStart, onSkip, onCancel }: SessionSetupProps) {
  const [mode, setMode] = useState<SetupMode>('interview')
  // Bumped whenever a preset is applied so the active child remounts and
  // re-reads its initialContext prop instead of carrying over stale state.
  const [formKey, setFormKey] = useState(0)
  // Initial context handed down to the child after a preset apply.
  const [initialContext, setInitialContext] = useState<Partial<SessionContext> | undefined>(undefined)
  // Latest live form state from whichever child is rendered. Captured by
  // the preset bar's "Save current" button.
  const liveContextRef = useRef<SessionContext | undefined>(undefined)

  // Read the active agent mode from config so the wizard reflects the
  // user's prior choice. Single source of truth lives in the main process.
  useEffect(() => {
    let cancelled = false
    window.api.getConfig().then((cfg) => {
      if (cancelled) return
      const am = cfg?.agentMode as AgentMode | undefined
      setMode(agentModeToSetupMode(am))
    })
    return () => { cancelled = true }
  }, [])

  // When the user picks a different mode in the wizard, persist it so
  // the rest of the app (overlay dropdown, Settings, the pipeline
  // factory) sees a single, consistent value before the session starts.
  const switchMode = (next: SetupMode) => {
    setMode(next)
    const nextAgentMode = setupModeToAgentMode(next)
    void window.api.setConfig({ agentMode: nextAgentMode })
  }

  const handleApplyPreset = (preset: SessionPreset): void => {
    if (preset.agentMode !== mode) {
      switchMode(preset.agentMode)
    }
    setInitialContext(preset.context as Partial<SessionContext>)
    // Bump the key so the active child remounts and seeds from initialContext.
    setFormKey((k) => k + 1)
  }

  const getCurrentContext = (): SessionPreset['context'] => {
    const ctx = liveContextRef.current
    if (!ctx) return {}
    return {
      sessionIntent: ctx.sessionIntent,
      companyName: ctx.companyName,
      roleName: ctx.roleName,
      interviewType: ctx.interviewType,
      subject: ctx.subject,
      sessionNotes: ctx.sessionNotes,
      contextFolder: ctx.contextFolder,
    }
  }

  const handleContextChange = (ctx: SessionContext): void => {
    liveContextRef.current = ctx
  }

  const renderFooter = useMemo(
    () =>
      ({ canAdvance, canStart, onBack, onNext, onStart: onChildStart }: {
        canAdvance: boolean
        canStart: boolean
        onBack: (() => void) | null
        onNext: (() => void) | null
        onStart: () => void
      }) => (
        <div className="flex gap-2 pt-1">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-[12px] font-medium text-white/45 hover:text-white/65 hover:bg-white/[0.06] transition-all"
            >
              <span className="inline-flex items-center gap-1">
                <ArrowLeft size={12} />
                Back
              </span>
            </button>
          )}

          {onNext ? (
            <button
              onClick={onNext}
              disabled={!canAdvance}
              className="flex-1 rounded-lg bg-cyan-500/12 border border-cyan-500/20 py-2 text-[12px] font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-all disabled:opacity-45 disabled:pointer-events-none"
            >
              <span className="inline-flex items-center gap-1">
                Next
                <ArrowRight size={12} />
              </span>
            </button>
          ) : (
            <button
              onClick={onChildStart}
              disabled={!canStart}
              className="flex-1 rounded-lg bg-emerald-500/15 border border-emerald-500/20 py-2 text-[12px] font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-all disabled:opacity-45 disabled:pointer-events-none"
            >
              Start Session
            </button>
          )}

          <button
            onClick={onSkip}
            className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-4 py-2 text-[12px] font-medium text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-all"
          >
            Skip
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-white/30 hover:text-white/50 transition-all"
          >
            Cancel
          </button>
        </div>
      ),
    [onSkip, onCancel],
  )

  const setupChildren: Record<SetupMode, React.ComponentType<{
    onStart: (ctx: SessionContext) => void
    renderFooter: typeof renderFooter
    initialContext?: Partial<SessionContext>
    onContextChange?: (ctx: SessionContext) => void
  }>> = {
    interview: InterviewSetup,
    companion: CompanionSetup,
  }
  const ChildComponent = setupChildren[mode]

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[rgba(12,14,18,0.88)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Session Setup</p>
          <p className="mt-1 text-[11px] text-white/28">Pick a mode, then fill its fields.</p>
        </div>
      </div>

      <SessionPresetBar
        agentMode={setupModeToAgentMode(mode)}
        getCurrentContext={getCurrentContext}
        onApplyPreset={handleApplyPreset}
      />

      <div className="grid grid-cols-3 gap-1.5">
        {SETUP_MODES.map((m) => {
          const Icon = m.icon
          const selected = m.value === mode
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => switchMode(m.value)}
              className={`rounded-xl border px-2 py-2 text-left transition-all ${
                selected
                  ? 'border-cyan-500/30 bg-cyan-500/10'
                  : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Icon size={11} className={selected ? 'text-cyan-300' : 'text-white/45'} />
                <span className={`text-[11px] font-semibold ${selected ? 'text-cyan-300' : 'text-white/72'}`}>
                  {m.label}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <ChildComponent
        key={`${mode}-${formKey}`}
        onStart={onStart}
        renderFooter={renderFooter}
        initialContext={initialContext}
        onContextChange={handleContextChange}
      />
    </div>
  )
}
