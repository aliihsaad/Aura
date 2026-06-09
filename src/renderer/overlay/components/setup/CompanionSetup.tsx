/**
 * CompanionSetup — Phase 4 of the mode-isolation refactor.
 *
 * Light setup for companion mode. The
 * voice toggle lives in the overlay control bar (per plan §13.4), so
 * this component only collects optional context + guidance notes.
 */

import React, { useEffect, useState } from 'react'
import { Building2, Briefcase, BookOpen, StickyNote } from 'lucide-react'
import type { SessionContext } from '@shared/types'

import { inputClass } from './SessionSetup.shared'

interface CompanionSetupProps {
  onStart: (ctx: SessionContext) => void
  renderFooter: (props: {
    canAdvance: boolean
    canStart: boolean
    onBack: (() => void) | null
    onNext: (() => void) | null
    onStart: () => void
  }) => React.ReactNode
  initialContext?: Partial<SessionContext>
  onContextChange?: (ctx: SessionContext) => void
}

export default function CompanionSetup({
  onStart,
  renderFooter,
  initialContext,
  onContextChange,
}: CompanionSetupProps) {
  const [companyName, setCompanyName] = useState('')
  const [roleName, setRoleName] = useState('')
  const [subject, setSubject] = useState('')
  const [sessionNotes, setSessionNotes] = useState('')

  useEffect(() => {
    const seed = (ctx: Partial<SessionContext> | null): void => {
      if (!ctx) return
      setCompanyName(ctx.companyName || '')
      setRoleName(ctx.roleName || '')
      setSubject(ctx.subject || '')
      setSessionNotes(ctx.sessionNotes || '')
    }
    if (initialContext) {
      seed(initialContext)
    } else {
      window.api.getLastSessionContext().then((ctx: SessionContext | null) => seed(ctx))
    }
  }, [initialContext])

  useEffect(() => {
    if (!onContextChange) return
    onContextChange({
      sessionIntent: 'quick-help',
      companyName,
      roleName,
      interviewType: 'general',
      subject,
      sessionNotes,
    })
  }, [onContextChange, companyName, roleName, subject, sessionNotes])

  const handleStart = () => {
    onStart({
      sessionIntent: 'quick-help',
      companyName,
      roleName,
      interviewType: 'general',
      subject,
      sessionNotes,
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
        <p className="text-[12px] font-medium text-white/78">Companion mode</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/32">
          Quick chat overlay with sub-second bubble replies. Voice on/off lives in the overlay control bar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
            <Building2 size={10} />
            Topic
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
            <Briefcase size={10} />
            Role
          </label>
          <input
            type="text"
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
          <BookOpen size={10} />
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What are we focused on?"
          className={inputClass}
        />
      </div>

      <div>
        <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
          <StickyNote size={10} />
          Guidance Notes
        </label>
        <textarea
          value={sessionNotes}
          onChange={(e) => setSessionNotes(e.target.value)}
          placeholder="Anything important..."
          rows={3}
          className={`${inputClass} resize-none`}
        />
      </div>

      {renderFooter({
        canAdvance: true,
        canStart: true,
        onBack: null,
        onNext: null,
        onStart: handleStart,
      })}
    </div>
  )
}
