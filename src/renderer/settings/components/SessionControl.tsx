import React, { useState } from 'react'
import { Play, Square, Keyboard, Clock, FileText, FolderOpen, Trash2, Download, ChevronRight } from 'lucide-react'

interface SessionSummary {
  id: string
  title: string
  startedAt: number
  endedAt: number
  durationSeconds: number
  companyName?: string
  roleName?: string
  sessionType?: string
  subject?: string
  transcriptCount: number
  answerCount: number
  noteCount?: number
  folderName: string
}

interface SessionControlProps {
  isSessionActive: boolean
}

export default function SessionControl({ isSessionActive }: SessionControlProps) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadSessions = () => {
    void window.api.getSessions().then((records) => {
      setSessions(Array.isArray(records) ? records : [])
    })
  }

  React.useEffect(() => {
    loadSessions()
  }, [isSessionActive])

  const handleDelete = async (session: SessionSummary) => {
    if (deletingId === session.folderName) {
      await window.api.deleteSession(session.folderName)
      setDeletingId(null)
      loadSessions()
    } else {
      setDeletingId(session.folderName)
      setTimeout(() => setDeletingId((prev) => (prev === session.folderName ? null : prev)), 3000)
    }
  }

  const handleToggle = async () => {
    setError('')
    setLoading(true)
    try {
      if (isSessionActive) {
        await window.api.stopSession()
      } else {
        await window.api.startSession()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to toggle session')
    } finally {
      setLoading(false)
    }
  }

  const shortcuts = [
    ['Ctrl+Shift+O', 'Toggle overlay'],
    ['Ctrl+Shift+S', 'Start / Stop session'],
    ['Ctrl+Shift+C', 'Capture screen'],
    ['Ctrl+Shift+R', 'Regenerate answer'],
    ['Ctrl+Shift+H', 'Hide overlay'],
  ]

  const formatDuration = (seconds: number) => {
    const mins = Math.round(seconds / 60)
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-[18px] font-semibold text-white/90 tracking-tight">Session</h2>
        <p className="text-[13px] text-white/35 mt-1">
          Control live capture sessions and review saved runs.
        </p>
      </div>

      {/* Status + Action Card */}
      <div className={`rounded-2xl border p-5 transition-all duration-300 ${
        isSessionActive
          ? 'bg-emerald-500/[0.04] border-emerald-500/[0.12] status-glow-active'
          : 'bg-white/[0.02] border-white/[0.05] status-glow-inactive'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className={`relative w-3 h-3 rounded-full ${
              isSessionActive ? 'bg-emerald-400 pulse-ring' : 'bg-white/15'
            }`} />
            <div>
              <p className="text-[14px] font-semibold text-white/85">
                {isSessionActive ? 'Session Active' : 'No Active Session'}
              </p>
              <p className="text-[11.5px] text-white/35 mt-0.5">
                {isSessionActive
                  ? 'Capturing activity and generating responses in real-time'
                  : 'Start a session to begin using Aura'}
              </p>
            </div>
          </div>

          <button
            onClick={handleToggle}
            disabled={loading}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-[12.5px] font-semibold transition-all duration-200 btn-press disabled:opacity-50 disabled:pointer-events-none ${
              isSessionActive
                ? 'bg-red-500/12 text-red-400 border border-red-500/15 hover:bg-red-500/18 hover:border-red-500/25'
                : 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/15 hover:bg-emerald-500/18 hover:border-emerald-500/25'
            }`}
          >
            {loading ? (
              'Wait...'
            ) : isSessionActive ? (
              <>
                <Square size={12} />
                Stop
              </>
            ) : (
              <>
                <Play size={12} />
                Start Session
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/8 border border-red-500/12 text-red-400 text-[12.5px]">
          {error}
        </div>
      )}

      {/* Keyboard Shortcuts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Keyboard size={14} className="text-white/25" />
          <h3 className="text-[12px] font-semibold text-white/50 uppercase tracking-wider">
            Shortcuts
          </h3>
        </div>
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.045] overflow-hidden">
          {shortcuts.map(([key, desc], i) => (
            <div
              key={key}
              className={`flex items-center justify-between px-4 py-2.5 ${
                i < shortcuts.length - 1 ? 'border-b border-white/[0.035]' : ''
              }`}
            >
              <span className="text-[12.5px] text-white/50">{desc}</span>
              <kbd className="text-[11px] font-mono bg-white/[0.05] rounded-lg px-2.5 py-1 text-white/55 border border-white/[0.04]">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      {/* Saved Sessions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-white/25" />
          <h3 className="text-[12px] font-semibold text-white/50 uppercase tracking-wider">
            Past Sessions
          </h3>
          {sessions.length > 0 && (
            <span className="ml-auto text-[11px] text-white/25">
              {sessions.length} saved
            </span>
          )}
        </div>

        <div className="space-y-2">
          {sessions.length === 0 && (
            <div className="rounded-2xl bg-white/[0.015] border border-white/[0.04] p-6 text-center">
              <Clock size={20} className="text-white/15 mx-auto mb-2" />
              <p className="text-[12.5px] text-white/30">No sessions yet</p>
              <p className="text-[11px] text-white/20 mt-1">
                Sessions are saved automatically when you stop.
              </p>
            </div>
          )}

          {sessions.slice(0, 10).map((session) => (
            <div
              key={session.id}
              className="rounded-2xl bg-white/[0.02] border border-white/[0.045] p-4 card-premium group"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.04] flex items-center justify-center shrink-0">
                  <FileText size={13} className="text-white/30" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-white/80 truncate leading-snug">
                    {session.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-white/30">
                    <span>{new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span className="w-px h-3 bg-white/10" />
                    <span>{formatDuration(session.durationSeconds)}</span>
                    <span className="w-px h-3 bg-white/10" />
                    <span>{session.transcriptCount} lines</span>
                    <span className="w-px h-3 bg-white/10" />
                    <span>{session.answerCount} answers</span>
                    {Boolean(session.noteCount) && (
                      <>
                        <span className="w-px h-3 bg-white/10" />
                        <span>{session.noteCount} notes</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions — visible on hover */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={() => window.api.openSessionFolder(session.folderName)}
                    className="p-2 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.05] transition-all"
                    title="Open folder"
                  >
                    <FolderOpen size={13} />
                  </button>
                  <button
                    onClick={() => window.api.exportSession(session.folderName, 'md')}
                    className="p-2 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.05] transition-all"
                    title="Export markdown"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(session)}
                    className={`p-2 rounded-lg transition-all ${
                      deletingId === session.folderName
                        ? 'text-red-400 bg-red-500/10'
                        : 'text-white/30 hover:text-red-400 hover:bg-red-500/[0.06]'
                    }`}
                    title={deletingId === session.folderName ? 'Click again to confirm' : 'Delete'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
