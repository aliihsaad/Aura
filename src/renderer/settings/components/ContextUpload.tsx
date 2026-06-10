import { useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  Upload,
  FileText,
  User,
  Lightbulb,
  MessageSquare,
  FolderOpen,
  RefreshCw,
  Check,
  AlertTriangle,
  Folder,
  ChevronDown,
  Briefcase,
  GraduationCap,
  Code2,
  Users,
  Globe,
  Target,
} from 'lucide-react'
import type { ProfileContext } from '@shared/types'

const inputClass =
  'input-premium w-full rounded-xl bg-white/[0.025] border border-white/6 px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/15 focus:border-blue-500/25 focus:outline-none transition-all'

const emptyProfile: ProfileContext = {
  name: '',
  languages: '',
  occupation: '',
  currentFocus: '',
  commsStyle: '',
  extraInstructions: '',
  relationships: '',
}

interface CollapsibleCardProps {
  title: string
  description: string
  icon: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

function CollapsibleCard({ title, description, icon, defaultOpen = false, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.015] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.025] transition-colors"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/55">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white/80">{title}</div>
          <div className="text-[11px] text-white/35 mt-0.5 truncate">{description}</div>
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-white/[0.04]">{children}</div>
      )}
    </div>
  )
}

interface FieldProps {
  label: string
  icon?: ReactNode
  hint?: string
  children: ReactNode
}

function Field({ label, icon, hint, children }: FieldProps) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-white/40 mb-2 uppercase tracking-wider">
        {icon}
        {label}
      </label>
      {hint && <p className="text-[11px] text-white/30 mb-2 -mt-1">{hint}</p>}
      {children}
    </div>
  )
}

export default function ContextUpload() {
  const [profile, setProfile] = useState<ProfileContext>(emptyProfile)
  const [saved, setSaved] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [contextFolders, setContextFolders] = useState<string[]>([])
  const [contextWarnings, setContextWarnings] = useState<string[]>([])

  // Generic field updater — handles both top-level and nested-block fields.
  const update = <K extends keyof ProfileContext>(key: K, value: ProfileContext[K]): void => {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }
  const loadContextFiles = useCallback(async () => {
    const folders = await window.api.listContextFolders()
    setContextFolders(folders)

    const globalResult = await window.api.loadFileContext()
    const allFiles = [...globalResult.files]
    const allWarnings = [...globalResult.warnings]

    for (const folder of folders) {
      const result = await window.api.loadFileContext(folder)
      const companyFiles = result.files.filter((f) => !f.startsWith('_global/'))
      allFiles.push(...companyFiles)
      allWarnings.push(...result.warnings.filter((w) => !globalResult.warnings.includes(w)))
    }

    setContextFiles(allFiles)
    setContextWarnings(allWarnings)
  }, [])

  const loadProfile = useCallback(async () => {
    const stored = (await window.api.getProfile()) as Partial<ProfileContext> | null
    if (stored) {
      setProfile({
        ...emptyProfile,
        ...stored,
      })
    }
  }, [])

  useEffect(() => {
    void loadProfile()
    void loadContextFiles()
  }, [loadProfile, loadContextFiles])

  const handleSave = async (): Promise<void> => {
    await window.api.setProfile(profile)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }


  const relationshipsFilled = !!profile.relationships

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-[30px] font-light text-white/95 tracking-[-0.02em]">Profile</h2>
        <p className="text-[13px] text-white/35 mt-1">
          Universal facts about you, loaded into every companion session.
        </p>
      </div>

      {/* Identity Essentials — always visible */}
      <div className="space-y-5">
        <Field label="Name" icon={<User size={11} />}>
          <input
            type="text"
            value={profile.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Ali"
            className={inputClass}
          />
        </Field>

        <Field
          label="Languages"
          icon={<Globe size={11} />}
          hint="The agent will match how you speak / code-switch."
        >
          <input
            type="text"
            value={profile.languages}
            onChange={(e) => update('languages', e.target.value)}
            placeholder="English (native), German (fluent), Arabic (basic)"
            className={inputClass}
          />
        </Field>

        <Field
          label="Occupation"
          icon={<Briefcase size={11} />}
          hint="What you do day-to-day, in one line."
        >
          <input
            type="text"
            value={profile.occupation}
            onChange={(e) => update('occupation', e.target.value)}
            placeholder="Web dev student at Ironhack, transitioning from sales"
            className={inputClass}
          />
        </Field>

        <Field
          label="Current Focus"
          icon={<Target size={11} />}
          hint="What you're actively working on this week / month."
        >
          <input
            type="text"
            value={profile.currentFocus}
            onChange={(e) => update('currentFocus', e.target.value)}
            placeholder="Module 2 — React + MongoDB, prepping capstone"
            className={inputClass}
          />
        </Field>

        <Field
          label="Comms Style"
          icon={<MessageSquare size={11} />}
          hint="How you want the agent to talk back."
        >
          <textarea
            value={profile.commsStyle}
            onChange={(e) => update('commsStyle', e.target.value)}
            placeholder="Direct, fix-first then explanation. Skip filler. Short over long."
            rows={2}
            className={`${inputClass} resize-y`}
          />
        </Field>

        <Field label="Standing Instructions">
          <textarea
            value={profile.extraInstructions}
            onChange={(e) => update('extraInstructions', e.target.value)}
            placeholder="Cross-session rules — e.g. respond in the language I use, never apologize, never repeat."
            rows={3}
            className={`${inputClass} resize-y`}
          />
        </Field>
      </div>

      {/* Use-case blocks */}
      <div>
        <h3 className="text-[11px] font-semibold text-white/35 uppercase tracking-wider mb-3">
          Use-case blocks
          <span className="ml-2 text-white/20 normal-case font-normal">— optional</span>
        </h3>

        <div className="space-y-3">
          <CollapsibleCard
            title="Relationships"
            description={
              relationshipsFilled
                ? 'Filled'
                : 'People in your work life — boss, mentor, teammates'
            }
            icon={<Users size={16} />}
            defaultOpen={relationshipsFilled}
          >
            <Field label="Notes">
              <textarea
                value={profile.relationships}
                onChange={(e) => update('relationships', e.target.value)}
                placeholder="Boss = Marcus (engineering manager). Mentor = Lara at Ironhack. Capstone partner = Sam."
                rows={3}
                className={`${inputClass} resize-y`}
              />
            </Field>
          </CollapsibleCard>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className={`w-full rounded-xl py-3.5 text-[13px] font-semibold transition-all duration-250 flex items-center justify-center gap-2 btn-press ${
          saved
            ? 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/20 shadow-[0_0_20px_rgba(52,211,153,0.08)]'
            : 'bg-blue-500/10 text-blue-400 border border-blue-500/15 hover:bg-blue-500/15 hover:border-blue-500/25 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)]'
        }`}
      >
        {saved ? (
          <>
            <Check size={14} />
            Saved
          </>
        ) : (
          'Save Profile'
        )}
      </button>

      {/* File-based Context Section */}
      <div className="border-t border-white/[0.05] pt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Folder size={14} className="text-white/25" />
            <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-[0.18em]">
              Context Files
            </h3>
          </div>
          <button
            onClick={loadContextFiles}
            className="flex items-center gap-1.5 text-[10.5px] text-white/30 hover:text-white/60 transition-colors rounded-lg px-2 py-1 hover:bg-white/[0.03]"
            title="Refresh"
          >
            <RefreshCw size={10} />
            Refresh
          </button>
        </div>

        <p className="text-[11.5px] text-white/30 mb-4 leading-relaxed">
          Drop <code className="text-[10.5px] bg-white/4 rounded px-1.5 py-0.5 text-white/45">.md</code> or{' '}
          <code className="text-[10.5px] bg-white/4 rounded px-1.5 py-0.5 text-white/45">.txt</code> files
          into the context folder. Files in{' '}
          <code className="text-[10.5px] bg-white/4 rounded px-1.5 py-0.5 text-white/45">_global/</code>{' '}
          always load. Company folders load when matched.
        </p>

        {contextFiles.length > 0 && (
          <div className="rounded-2xl bg-white/[0.015] border border-white/[0.045] p-4 mb-3">
            <p className="text-[10.5px] font-semibold text-white/35 uppercase tracking-wider mb-3">
              {contextFiles.length} file{contextFiles.length !== 1 ? 's' : ''} found
            </p>
            <div className="space-y-1.5">
              {contextFiles.map((file) => (
                <div key={file} className="flex items-center gap-2 text-[11.5px] text-white/45">
                  <FileText size={10} className="shrink-0 text-white/20" />
                  <span className="truncate font-mono text-[10.5px]">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {contextFolders.length > 0 && (
          <div className="rounded-2xl bg-white/[0.015] border border-white/[0.045] p-4 mb-3">
            <p className="text-[10.5px] font-semibold text-white/35 uppercase tracking-wider mb-3">
              Company Folders
            </p>
            <div className="flex flex-wrap gap-2">
              {contextFolders.map((folder) => (
                <span
                  key={folder}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/4 border border-white/[0.04] px-2.5 py-1 text-[11px] text-white/45 font-medium"
                >
                  <FolderOpen size={10} className="text-white/25" />
                  {folder}
                </span>
              ))}
            </div>
          </div>
        )}

        {contextWarnings.length > 0 && (
          <div className="rounded-2xl bg-amber-500/[0.04] border border-amber-500/10 p-4 mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle size={11} className="text-amber-400/60" />
              <span className="text-[10.5px] font-semibold text-amber-400/50 uppercase tracking-wider">
                Warnings
              </span>
            </div>
            {contextWarnings.map((warning, i) => (
              <p key={i} className="text-[11px] text-amber-400/50 leading-relaxed">
                {warning}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => window.api.openContextFolder()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-medium text-white/50 bg-white/[0.025] border border-white/[0.05] hover:bg-white/[0.045] hover:text-white/70 hover:border-white/[0.07] transition-all btn-press"
          >
            <FolderOpen size={13} />
            Context Folder
          </button>
          <button
            onClick={() => window.api.openAppDataFolder()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-[12px] font-medium text-white/50 bg-white/[0.025] border border-white/[0.05] hover:bg-white/[0.045] hover:text-white/70 hover:border-white/[0.07] transition-all btn-press"
          >
            <FolderOpen size={13} />
            App Data
          </button>
        </div>
      </div>
    </div>
  )
}
