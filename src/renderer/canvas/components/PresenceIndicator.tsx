import React from 'react'
import type { AgentPresenceState } from '@shared/types'

interface PresenceIndicatorProps {
  state: AgentPresenceState
  size?: number
}

export default function PresenceIndicator({ state, size = 16 }: PresenceIndicatorProps) {
  if (state === 'speaking') {
    return <SpeakingWaveform size={size} />
  }

  const config = PRESENCE_STYLES[state]

  return (
    <div
      className={`rounded-full ${config.className}`}
      style={{ width: size, height: size }}
      title={config.label}
    />
  )
}

const PRESENCE_STYLES: Record<AgentPresenceState, { className: string; label: string }> = {
  sleeping: {
    className: 'bg-white/20',
    label: 'Sleeping',
  },
  idle: {
    className: 'bg-[#6ea8ff]/60 shadow-[0_0_8px_rgba(110,168,255,0.5)] presence-breathing',
    label: 'Idle',
  },
  listening: {
    className: 'bg-[#4d7cfe]/80 shadow-[0_0_10px_rgba(77,124,254,0.7)] presence-breathing',
    label: 'Listening',
  },
  thinking: {
    className: 'bg-[#a78bfa]/90 shadow-[0_0_10px_rgba(167,139,250,0.7)] presence-pulsing',
    label: 'Thinking',
  },
  speaking: {
    className: '',
    label: 'Speaking',
  },
}

function SpeakingWaveform({ size }: { size: number }) {
  const barCount = 4
  const barWidth = Math.max(2, Math.floor(size / (barCount * 2)))
  const gap = Math.max(1, Math.floor(barWidth / 2))

  return (
    <div
      className="flex items-center justify-center"
      style={{ width: size, height: size, gap }}
      title="Speaking"
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className="bg-[#2dd4bf] rounded-full presence-wave-bar"
          style={{
            width: barWidth,
            height: size * 0.6,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}
