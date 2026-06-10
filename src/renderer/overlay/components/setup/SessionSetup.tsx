/**
 * SessionSetup shell — companion-only.
 *
 * Renders the companion setup form plus the preset bar. The child owns
 * its own field state and emits a SessionContext via `onStart`; the
 * shell owns the bottom button bar (Start / Skip / Cancel) and passes
 * it back via `renderFooter`.
 */

import React, { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { SessionContext, SessionPreset } from '@shared/types'

import CompanionSetup from './CompanionSetup'
import SessionPresetBar from './SessionPresetBar'

interface SessionSetupProps {
  onStart: (ctx: SessionContext) => void
  onSkip: () => void
  onCancel: () => void
}

export default function SessionSetup({ onStart, onSkip, onCancel }: SessionSetupProps) {
  // Bumped whenever a preset is applied so the child remounts and
  // re-reads its initialContext prop instead of carrying over stale state.
  const [formKey, setFormKey] = useState(0)
  // Initial context handed down to the child after a preset apply.
  const [initialContext, setInitialContext] = useState<Partial<SessionContext> | undefined>(undefined)
  // Latest live form state from the child. Captured by the preset bar's
  // "Save current" button.
  const liveContextRef = useRef<SessionContext | undefined>(undefined)

  const handleApplyPreset = (preset: SessionPreset): void => {
    setInitialContext(preset.context as Partial<SessionContext>)
    setFormKey((k) => k + 1)
  }

  const getCurrentContext = (): SessionPreset['context'] => {
    const ctx = liveContextRef.current
    if (!ctx) return {}
    return {
      sessionIntent: ctx.sessionIntent,
      companyName: ctx.companyName,
      roleName: ctx.roleName,
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

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[rgba(12,14,18,0.88)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Session Setup</p>
          <p className="mt-1 text-[11px] text-white/28">Optional context for this companion session.</p>
        </div>
      </div>

      <SessionPresetBar
        agentMode="companion"
        getCurrentContext={getCurrentContext}
        onApplyPreset={handleApplyPreset}
      />

      <CompanionSetup
        key={`companion-${formKey}`}
        onStart={onStart}
        renderFooter={renderFooter}
        initialContext={initialContext}
        onContextChange={handleContextChange}
      />
    </div>
  )
}
