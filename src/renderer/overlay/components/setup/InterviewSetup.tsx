/**
 * InterviewSetup — Phase 4 of the mode-isolation refactor.
 *
 * Owns the wizard fields for agent-mode 'interview', covering the
 * speech-led live session intents.
 * The parent SessionSetup shell handles step chrome and the mode tabs;
 * this component owns its own field state and emits a SessionContext.
 */

import React, { useEffect, useState } from 'react'
import {
  Building2, Briefcase, BookOpen, StickyNote, ChevronDown, FolderOpen,
  Layers3, Presentation, MessageSquareMore,
} from 'lucide-react'
import type { InterviewType, SessionContext, SessionIntent } from '@shared/types'
import { getSessionIntentSpec } from '@shared/session-intent-policy'

import { inputClass } from './SessionSetup.shared'

interface InterviewSetupProps {
  onStart: (ctx: SessionContext) => void
  renderFooter: (props: {
    canAdvance: boolean
    canStart: boolean
    onBack: (() => void) | null
    onNext: (() => void) | null
    onStart: () => void
  }) => React.ReactNode
  /** Seed the form with these values instead of getLastSessionContext.
   * Used when the parent applies a saved preset. The component remounts
   * via a key bump so this is read once on mount per preset application. */
  initialContext?: Partial<SessionContext>
  /** Fires on every field edit so the parent has a live snapshot it can
   * save as a new preset. */
  onContextChange?: (ctx: SessionContext) => void
}

const INTERVIEW_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'technical', label: 'Technical' },
  { value: 'coding', label: 'Coding' },
  { value: 'system-design', label: 'System Design' },
] satisfies Array<{ value: InterviewType; label: string }>

type LiveSetupIntent = Extract<SessionIntent, 'interview' | 'meeting' | 'presentation' | 'class'>

const LIVE_SESSION_INTENTS: Array<{
  value: LiveSetupIntent
  icon: typeof MessageSquareMore
}> = [
  {
    value: 'interview',
    icon: MessageSquareMore,
  },
  {
    value: 'meeting',
    icon: Layers3,
  },
  {
    value: 'presentation',
    icon: Presentation,
  },
  {
    value: 'class',
    icon: BookOpen,
  },
]

export default function InterviewSetup({
  onStart,
  renderFooter,
  initialContext,
  onContextChange,
}: InterviewSetupProps) {
  const [step, setStep] = useState(1)
  const [sessionIntent, setSessionIntent] = useState<LiveSetupIntent>('interview')
  const [companyName, setCompanyName] = useState('')
  const [roleName, setRoleName] = useState('')
  const [interviewType, setInterviewType] = useState<InterviewType>('general')
  const [subject, setSubject] = useState('')
  const [sessionNotes, setSessionNotes] = useState('')
  const [contextFolders, setContextFolders] = useState<string[]>([])
  const [selectedContextFolder, setSelectedContextFolder] = useState('')
  const [allowContextAutoMatch, setAllowContextAutoMatch] = useState(true)
  const [contextFileCount, setContextFileCount] = useState<number | null>(null)

  useEffect(() => {
    const seedFromContext = (ctx: Partial<SessionContext> | null): void => {
      if (!ctx) return
      const intent = ctx.sessionIntent
      if (intent === 'interview' || intent === 'meeting' || intent === 'presentation' || intent === 'class') {
        setSessionIntent(intent)
      }
      setCompanyName(ctx.companyName || '')
      setRoleName(ctx.roleName || '')
      setInterviewType(ctx.interviewType || 'general')
      setSubject(ctx.subject || '')
      setSessionNotes(ctx.sessionNotes || '')
      setSelectedContextFolder(ctx.contextFolder || '')
      const hasSavedContext =
        Boolean(ctx.companyName || ctx.roleName || ctx.subject || ctx.contextFolder) ||
        (ctx.sessionIntent && ctx.sessionIntent !== 'interview') ||
        ctx.interviewType !== 'general'
      if (hasSavedContext) setAllowContextAutoMatch(false)
    }

    // Preset takes priority — when the parent applied a preset and remounted
    // this child via key bump, initialContext is the source of truth.
    if (initialContext) {
      seedFromContext(initialContext)
    } else {
      window.api.getLastSessionContext().then((ctx: SessionContext | null) => seedFromContext(ctx))
    }
    window.api.listContextFolders().then(setContextFolders)
  }, [initialContext])

  // Push live form state up to the shell so the preset bar can capture it.
  useEffect(() => {
    if (!onContextChange) return
    onContextChange({
      sessionIntent,
      companyName,
      roleName,
      interviewType,
      subject,
      sessionNotes,
      contextFolder: selectedContextFolder,
    })
  }, [
    onContextChange,
    sessionIntent,
    companyName,
    roleName,
    interviewType,
    subject,
    sessionNotes,
    selectedContextFolder,
  ])

  useEffect(() => {
    if (!companyName) return
    if (!allowContextAutoMatch || selectedContextFolder) return
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const match = contextFolders.find((f) => f === slug)
    setSelectedContextFolder(match || '')
  }, [allowContextAutoMatch, companyName, contextFolders, selectedContextFolder])

  useEffect(() => {
    if (!selectedContextFolder) {
      setContextFileCount(null)
      return
    }
    window.api.loadFileContext(selectedContextFolder).then((result) => {
      setContextFileCount(result.files.length)
    })
  }, [selectedContextFolder])

  const selectedIntent = getSessionIntentSpec(sessionIntent)
  const isInterview = selectedIntent.usesInterviewType
  const companyLabel = selectedIntent.organizationLabel
  const roleLabel = selectedIntent.roleLabel
  const subjectLabel = selectedIntent.subjectLabel
  const notesLabel = selectedIntent.notesLabel
  const notesPlaceholder = isInterview
    ? 'Anything specific to this interview...'
    : sessionIntent === 'class'
      ? 'Course goals, current topic, or what you want explained...'
      : 'Anything important about this session...'

  const handleStart = () => {
    onStart({
      sessionIntent,
      companyName,
      roleName,
      interviewType,
      subject,
      sessionNotes,
      contextFolder: selectedContextFolder,
    })
  }

  return (
    <div className="space-y-3">
      {step === 1 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
            <p className="text-[12px] font-medium text-white/78">Session type</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/32">
              How should Whisphry behave in this live session?
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {LIVE_SESSION_INTENTS.map((intentOption) => {
              const Icon = intentOption.icon
              const spec = getSessionIntentSpec(intentOption.value)
              const selected = intentOption.value === sessionIntent
              return (
                <button
                  key={intentOption.value}
                  type="button"
                  onClick={() => setSessionIntent(intentOption.value)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    selected
                      ? 'border-cyan-500/30 bg-cyan-500/10'
                      : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 rounded-lg p-2 ${selected ? 'bg-cyan-500/15 text-cyan-300' : 'bg-white/[0.04] text-white/45'}`}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-white/82">{spec.label}</div>
                      <div className="mt-1 text-[10.5px] leading-relaxed text-white/32">{spec.setupDescription}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
            <p className="text-[12px] font-medium text-white/78">{selectedIntent.label} context</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/32">{selectedIntent.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
                <Building2 size={10} />
                {companyLabel}
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={isInterview ? 'e.g. Google' : 'Optional'}
                className={inputClass}
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
                <Briefcase size={10} />
                {roleLabel}
              </label>
              <input
                type="text"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder={isInterview ? 'e.g. Senior SWE' : 'Optional'}
                className={inputClass}
              />
            </div>
          </div>

          <div className={`grid gap-2 ${isInterview ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isInterview && (
              <div>
                <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
                  <BookOpen size={10} />
                  Interview Type
                </label>
                <div className="relative">
                  <select
                    value={interviewType}
                    onChange={(e) => setInterviewType(e.target.value as InterviewType)}
                    className={`${inputClass} appearance-none pr-7`}
                  >
                    {INTERVIEW_TYPES.map((type) => (
                      <option key={type.value} value={type.value} className="bg-[#1a1c20] text-white/80">
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
                </div>
              </div>
            )}
            <div>
              <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
                <BookOpen size={10} />
                {subjectLabel}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={sessionIntent === 'presentation' ? 'e.g. Q2 roadmap' : 'Optional'}
                className={inputClass}
              />
            </div>
          </div>

          {contextFolders.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="flex items-center gap-1 text-[10px] font-medium text-white/35">
                  <FolderOpen size={10} />
                  Context Folder
                </label>
                <button
                  onClick={() => window.api.openContextFolder()}
                  className="text-[9px] text-cyan-400/50 hover:text-cyan-400/80 transition-colors"
                >
                  Open folder
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <select
                    value={selectedContextFolder}
                    onChange={(e) => {
                      setAllowContextAutoMatch(false)
                      setSelectedContextFolder(e.target.value)
                    }}
                    className={`${inputClass} appearance-none pr-7`}
                  >
                    <option value="" className="bg-[#1a1c20] text-white/80">None (global only)</option>
                    {contextFolders.map((folder) => (
                      <option key={folder} value={folder} className="bg-[#1a1c20] text-white/80">{folder}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none" />
                </div>
                {contextFileCount !== null && contextFileCount > 0 && (
                  <span className="text-[10px] text-emerald-400/55 whitespace-nowrap">
                    {contextFileCount} file{contextFileCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {contextFileCount === 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-2.5 py-2">
                  <span className="mt-0.5 text-[10px] text-amber-400/70">⚠</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10.5px] text-amber-300/75 leading-relaxed">
                      No context files load for this session. Drop{' '}
                      <code className="rounded bg-white/[0.04] px-1 text-amber-200/80">.md</code> /{' '}
                      <code className="rounded bg-white/[0.04] px-1 text-amber-200/80">.txt</code>{' '}
                      files into{' '}
                      <code className="rounded bg-white/[0.04] px-1 text-amber-200/80">_global/</code>
                      {selectedContextFolder ? (
                        <>
                          {' '}or{' '}
                          <code className="rounded bg-white/[0.04] px-1 text-amber-200/80">
                            {selectedContextFolder}/
                          </code>
                        </>
                      ) : null}{' '}
                      so the agent has something to ground answers in.
                    </p>
                    <button
                      type="button"
                      onClick={() => void window.api.openContextFolder()}
                      className="mt-1 text-[10px] font-medium text-amber-300/85 hover:text-amber-200 underline-offset-2 hover:underline"
                    >
                      Open context folder
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div>
            <label className="flex items-center gap-1 text-[10px] font-medium text-white/35 mb-1">
              <StickyNote size={10} />
              {notesLabel}
            </label>
            <textarea
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              placeholder={notesPlaceholder}
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">Session Summary</p>
            <p className="text-[12px] text-white/78">{selectedIntent.label}</p>
            {companyName && <p className="text-[10.5px] text-white/34">{companyLabel}: {companyName}</p>}
            {roleName && <p className="text-[10.5px] text-white/34">{roleLabel}: {roleName}</p>}
            {isInterview && <p className="text-[10.5px] text-white/34">Interview Type: {interviewType}</p>}
            {subject && <p className="text-[10.5px] text-white/34">{subjectLabel}: {subject}</p>}
            {selectedContextFolder && <p className="text-[10.5px] text-white/34">Context Folder: {selectedContextFolder}</p>}
            <p className="text-[10.5px] text-white/28">Answer style: {selectedIntent.answerStyleLabel}</p>
          </div>
        </div>
      )}

      {renderFooter({
        canAdvance: step === 1 ? Boolean(sessionIntent) : true,
        canStart: step === 3,
        onBack: step > 1 ? () => setStep((s) => s - 1) : null,
        onNext: step < 3 ? () => setStep((s) => s + 1) : null,
        onStart: handleStart,
      })}
    </div>
  )
}
