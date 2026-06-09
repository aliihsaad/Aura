import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  GripVertical,
  ChevronDown,
  ChevronUp,
  Send,
  Settings,
  Play,
  Square,
  Monitor,
} from 'lucide-react'
import PresenceIndicator from './PresenceIndicator'
import type {
  AgentPresenceState,
  CompanionRealtimeStatus,
  SessionIntent,
  TranscriptAudioSource,
} from '@shared/types'
import { getTranscriptSpeakerLabel, isSelfAuthoredEntry } from '@shared/session-intent-policy'

interface TranscriptEntry {
  id: string
  text: string
  speaker: 'interviewer' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  source?: 'stt' | 'chat'
  audioSource?: TranscriptAudioSource
}

interface ControlBarProps {
  presenceState: AgentPresenceState
}

export default function ControlBar({ presenceState }: ControlBarProps) {
  const [isSessionActive, setIsSessionActive] = useState(false)
  const [companionRealtimeStatus, setCompanionRealtimeStatus] =
    useState<CompanionRealtimeStatus>('off')
  const [sessionIntent, setSessionIntent] = useState<SessionIntent>('interview')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [showTranscript, setShowTranscript] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [sessionTime, setSessionTime] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSessionActive) {
      timerRef.current = setInterval(() => setSessionTime((t) => t + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setSessionTime(0)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isSessionActive])

  useEffect(() => {
    const cleanup = window.api.onSessionState((state: any) => {
      setIsSessionActive(Boolean(state?.isActive))
      if (state?.sessionIntent) {
        setSessionIntent(state.sessionIntent)
      }
      if (typeof state?.companionRealtimeStatus === 'string') {
        setCompanionRealtimeStatus(state.companionRealtimeStatus as CompanionRealtimeStatus)
      } else if (!state?.isActive) {
        setCompanionRealtimeStatus('off')
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.api.onTranscriptUpdate((entry: TranscriptEntry) => {
      setTranscript((prev) => {
        const existing = prev.findIndex((e) => e.id === entry.id)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = entry
          return updated
        }
        return [...prev, entry]
      })
    })
    return cleanup
  }, [])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  const handleSendChat = useCallback(() => {
    const q = chatInput.trim()
    if (!q) return
    void window.api.sendChatMessage(q)
    setChatInput('')
  }, [chatInput])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const finalTranscript = transcript.filter((e) => e.isFinal)

  return (
    <div className="flex flex-col bg-black/80 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[300px] max-w-[700px]">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2" data-drag-handle>
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical size={14} className="text-white/30 cursor-grab shrink-0" />
          {isSessionActive && (
            <span className="text-emerald-400/80 text-xs font-mono">{formatTime(sessionTime)}</span>
          )}
          {companionRealtimeStatus !== 'off' && (
            <span
              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/45"
              title={`Companion realtime status: ${companionRealtimeStatus}`}
            >
              Realtime {companionRealtimeStatus}
            </span>
          )}
        </div>

        <div className="flex items-center justify-center">
          <PresenceIndicator state={presenceState} size={18} />
        </div>

        <div className="flex items-center justify-end gap-1">
          {!isSessionActive ? (
            <button
              onClick={() => window.api.startSession()}
              className="p-1.5 rounded hover:bg-white/10 text-emerald-400/70 hover:text-emerald-400 transition-colors"
              title="Start Session"
            >
              <Play size={14} />
            </button>
          ) : (
            <button
              onClick={() => window.api.stopSession()}
              className="p-1.5 rounded hover:bg-white/10 text-red-400/70 hover:text-red-400 transition-colors"
              title="Stop Session"
            >
              <Square size={14} />
            </button>
          )}

          <button
            onClick={() => window.api.captureScreen()}
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title="Capture Screen"
          >
            <Monitor size={14} />
          </button>

          <button
            onClick={() => window.api.openSettings()}
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title="Dashboard"
          >
            <Settings size={14} />
          </button>

          <button
            onClick={() => setShowTranscript((s) => !s)}
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            title={showTranscript ? 'Hide Transcript' : 'Show Transcript'}
          >
            {showTranscript ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/5">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
          placeholder="Ask something..."
          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white/90 placeholder-white/30 outline-none focus:border-white/20"
        />
        <button
          onClick={handleSendChat}
          className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
        >
          <Send size={14} />
        </button>
      </div>

      {showTranscript && (
        <div className="border-t border-white/5 max-h-48 overflow-y-auto px-3 py-2">
          {finalTranscript.length === 0 ? (
            <p className="text-white/30 text-xs">No transcript yet...</p>
          ) : (
            finalTranscript.slice(-20).map((entry) => (
              <div key={entry.id} className="text-xs mb-1">
                <span className={isSelfAuthoredEntry(entry) ? 'text-cyan-400/70' : 'text-white/50'}>
                  [{getTranscriptSpeakerLabel(entry, sessionIntent)}]
                </span>{' '}
                <span className="text-white/70">{entry.text}</span>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      )}
    </div>
  )
}
