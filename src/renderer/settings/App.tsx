import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Radio, FileText, Settings, Monitor, FolderOpen, Zap, StickyNote, Plus, Search, Star, Trash2, Clock, Eye, EyeOff, Download, Database } from 'lucide-react'
import ApiConfig from './components/ApiConfig'
import ContextUpload from './components/ContextUpload'
import MemoryViewer from './components/MemoryViewer'
import SessionControl from './components/SessionControl'
import pkg from '../../../package.json'

type Tab = 'session' | 'memory' | 'context' | 'config'

const APP_VERSION = pkg.version

const tabs: { id: Tab; label: string; desc: string; icon: React.ElementType }[] = [
  { id: 'session', label: 'Session', desc: 'Live control & history', icon: Radio },
  { id: 'memory', label: 'Memory', desc: 'Drafts & signals', icon: Database },
  { id: 'context', label: 'Profile', desc: 'Your info & context', icon: FileText },
  { id: 'config', label: 'Settings', desc: 'Keys & preferences', icon: Settings },
]

// ── Decoy Notes App ──────────────────────────────────────────────
// Shown by default. Triple-click the logo to reveal the real dashboard.
// Press Escape while in real dashboard to switch back to decoy.

const DECOY_NOTES = [
  {
    id: 1,
    title: 'Meeting prep - Q3 planning',
    content: 'Review last quarter metrics before the meeting.\n\n- Revenue targets vs actuals\n- Customer churn analysis\n- Engineering velocity trends\n- Hiring pipeline status\n\nAction items from last sync:\n1. Update the roadmap slide deck\n2. Finalize budget proposals\n3. Schedule 1:1s with team leads',
    date: 'Today',
    starred: true,
  },
  {
    id: 2,
    title: 'Grocery list',
    content: '- Milk\n- Eggs\n- Bread\n- Chicken breast\n- Broccoli\n- Rice\n- Olive oil\n- Coffee beans\n- Bananas',
    date: 'Today',
    starred: false,
  },
  {
    id: 3,
    title: 'Book recommendations',
    content: 'From the team book club discussion:\n\n1. "Designing Data-Intensive Applications" - Martin Kleppmann\n2. "The Manager\'s Path" - Camille Fournier\n3. "Staff Engineer" - Will Larson\n4. "System Design Interview" - Alex Xu',
    date: 'Yesterday',
    starred: true,
  },
  {
    id: 4,
    title: 'Workout plan - March',
    content: 'Monday: Upper body\nTuesday: Cardio + core\nWednesday: Lower body\nThursday: Rest\nFriday: Full body\nSaturday: Long run\nSunday: Rest\n\nGoal: 4x per week minimum',
    date: 'Mar 14',
    starred: false,
  },
  {
    id: 5,
    title: 'Project ideas',
    content: '- Personal finance tracker with charts\n- Recipe organizer with meal planning\n- Habit tracker with streaks\n- Reading list with progress bars',
    date: 'Mar 12',
    starred: false,
  },
]

function DecoyNotesApp() {
  const [selectedNote, setSelectedNote] = useState(DECOY_NOTES[0])
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = searchQuery
    ? DECOY_NOTES.filter(
        (n) =>
          n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : DECOY_NOTES

  return (
    <div className="flex h-screen bg-[#1a1a2e] text-white overflow-hidden">
      {/* Sidebar - note list */}
      <aside className="w-[260px] shrink-0 bg-[#16162a] border-r border-white/[0.06] flex flex-col">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-white/[0.04]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <StickyNote size={16} className="text-amber-400/80" />
              <h1 className="text-[14px] font-semibold text-white/90">Whisphry</h1>
            </div>
            <button className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-all">
              <Plus size={16} />
            </button>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg pl-8 pr-3 py-2 text-[12px] text-white/80 placeholder:text-white/20 focus:outline-none focus:border-white/[0.12] transition-all"
            />
          </div>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {filtered.map((note) => (
            <button
              key={note.id}
              onClick={() => setSelectedNote(note)}
              className={`w-full text-left px-3 py-3 rounded-lg transition-all duration-150 ${
                selectedNote.id === note.id
                  ? 'bg-amber-500/[0.08] border border-amber-400/10'
                  : 'border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className={`text-[12.5px] font-medium truncate ${selectedNote.id === note.id ? 'text-white/90' : 'text-white/60'}`}>
                    {note.title}
                  </div>
                  <div className="text-[11px] text-white/25 mt-1 line-clamp-1">
                    {note.content.split('\n')[0]}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {note.starred && <Star size={10} className="text-amber-400/50 fill-amber-400/50" />}
                  <span className="text-[10px] text-white/20">{note.date}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.04]">
          <div className="text-[10px] text-white/15 text-center">{DECOY_NOTES.length} notes</div>
          <div className="text-[9px] text-white/[0.15] text-center mt-1 select-none">triple-click to unlock</div>
        </div>
      </aside>

      {/* Note content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[600px] mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[18px] font-semibold text-white/90">{selectedNote.title}</h2>
            <div className="flex items-center gap-2">
              <button className="p-1.5 rounded-lg text-white/20 hover:text-amber-400/60 hover:bg-white/[0.04] transition-all">
                <Star size={14} className={selectedNote.starred ? 'fill-amber-400/50 text-amber-400/50' : ''} />
              </button>
              <button className="p-1.5 rounded-lg text-white/20 hover:text-red-400/60 hover:bg-white/[0.04] transition-all">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-6 text-[11px] text-white/25">
            <Clock size={11} />
            <span>{selectedNote.date}</span>
          </div>
          <div className="text-[13.5px] text-white/65 leading-relaxed whitespace-pre-wrap">
            {selectedNote.content}
          </div>
        </div>
      </main>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('session')
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [showReal, setShowReal] = useState(false)
  const [contentProtection, setContentProtection] = useState(true)
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; releaseUrl: string } | null>(null)
  const clickTimesRef = useRef<number[]>([])

  // Listen for update notifications
  useEffect(() => {
    const cleanup = window.api.onUpdateAvailable((info: any) => {
      if (info?.updateAvailable) setUpdateInfo(info)
    })
    return cleanup
  }, [])

  // Load initial content protection state
  useEffect(() => {
    void window.api.getConfig().then((config: any) => {
      if (config?.contentProtection !== undefined) setContentProtection(config.contentProtection)
    })
  }, [])

  useEffect(() => {
    const cleanup = window.api.onSessionState((state: any) => {
      setIsSessionActive(state.isActive)
    })
    return cleanup
  }, [])

  // Escape key to switch back to decoy
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showReal) {
        setShowReal(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showReal])

  // Triple-click logo to reveal real dashboard
  const handleLogoClick = useCallback(() => {
    const now = Date.now()
    clickTimesRef.current.push(now)
    // Keep only last 3 clicks
    clickTimesRef.current = clickTimesRef.current.slice(-3)

    if (clickTimesRef.current.length === 3) {
      const elapsed = clickTimesRef.current[2] - clickTimesRef.current[0]
      if (elapsed < 600) {
        setShowReal(true)
        clickTimesRef.current = []
      }
    }
  }, [])

  if (!showReal) {
    return (
      <div onClick={handleLogoClick} className="h-screen">
        <DecoyNotesApp />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[#08090c] text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 bg-[#0c0d11] border-r border-white/[0.04] flex flex-col">
        {/* Logo / Brand */}
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400/20 to-cyan-600/10 border border-cyan-400/15 flex items-center justify-center">
              <Zap size={14} className="text-cyan-400" />
            </div>
            <div>
              <h1 className="text-[13px] font-semibold text-white/90 leading-tight">
                Whisphry
              </h1>
              <p className="text-[10px] text-white/30 leading-tight">
                Control Center
              </p>
            </div>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 btn-press ${
                  isActive
                    ? 'nav-active border border-cyan-400/15 text-white/95'
                    : 'border border-transparent text-white/45 hover:text-white/70 hover:bg-white/[0.03]'
                }`}
              >
                <Icon size={15} className={isActive ? 'text-cyan-400' : ''} />
                <div>
                  <div className="text-[12.5px] font-medium leading-tight">{tab.label}</div>
                  <div className={`text-[10px] mt-0.5 leading-tight ${isActive ? 'text-white/40' : 'text-white/25'}`}>
                    {tab.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="px-3 pb-4 space-y-2">
          <button
            onClick={() => window.api.showOverlay()}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-medium bg-cyan-500/8 text-cyan-400/90 border border-cyan-500/12 hover:bg-cyan-500/12 hover:text-cyan-400 transition-all duration-200 btn-press"
            title="Show overlay (Ctrl+Shift+O)"
          >
            <Monitor size={13} />
            Show Overlay
          </button>
          <button
            onClick={() => window.api.togglePreviewWindow()}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-medium bg-cyan-500/8 text-cyan-400/90 border border-cyan-500/12 hover:bg-cyan-500/12 hover:text-cyan-400 transition-all duration-200 btn-press"
            title="Preview files"
          >
            <FileText size={13} />
            Preview Files
          </button>
          <button
            onClick={() => {
              const next = !contentProtection
              setContentProtection(next)
              window.api.setContentProtection(next)
            }}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-medium transition-all duration-200 btn-press ${
              contentProtection
                ? 'text-emerald-400/80 bg-emerald-500/[0.06] border border-emerald-500/[0.1] hover:bg-emerald-500/[0.1]'
                : 'text-red-400/80 bg-red-500/[0.06] border border-red-500/[0.1] hover:bg-red-500/[0.1]'
            }`}
            title={contentProtection ? 'Content protection ON — windows hidden from screen capture' : 'Content protection OFF — windows visible in screen capture'}
          >
            {contentProtection ? <Eye size={11} /> : <EyeOff size={11} />}
            {contentProtection ? 'Private' : 'Not Private'}
          </button>
          <button
            onClick={() => window.api.openAppDataFolder()}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-medium text-white/30 hover:text-white/50 hover:bg-white/[0.03] transition-all duration-200 btn-press"
            title="Open app data folder"
          >
            <FolderOpen size={11} />
            App Data
          </button>
          <button
            onClick={() => setShowReal(false)}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-medium text-white/20 hover:text-white/40 hover:bg-white/[0.03] transition-all duration-200 btn-press"
            title="Switch to cover view (Esc)"
          >
            <StickyNote size={11} />
            Cover
          </button>
          {updateInfo ? (
            <button
              onClick={() => window.api.openExternal(updateInfo.releaseUrl)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 mt-1 text-[10px] font-medium text-cyan-400/80 bg-cyan-500/[0.06] border border-cyan-500/[0.1] hover:bg-cyan-500/[0.12] transition-all"
            >
              <Download size={10} />
              Update {updateInfo.latestVersion}
            </button>
          ) : (
            <div className="text-[10px] text-white/15 text-center pt-1">v{APP_VERSION}</div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-8 py-8 stagger-children">
          {activeTab === 'session' && (
            <SessionControl isSessionActive={isSessionActive} />
          )}
          {activeTab === 'memory' && <MemoryViewer />}
          {activeTab === 'context' && <ContextUpload />}
          {activeTab === 'config' && <ApiConfig />}
        </div>
      </main>
    </div>
  )
}
