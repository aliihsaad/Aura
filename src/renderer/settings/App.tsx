import React, { useState, useEffect } from 'react'
import { Radio, FileText, Settings, Monitor, FolderOpen, Zap, Eye, EyeOff, Download, Database } from 'lucide-react'
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

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('session')
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [contentProtection, setContentProtection] = useState(true)
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; releaseUrl: string } | null>(null)

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
                Aura
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
