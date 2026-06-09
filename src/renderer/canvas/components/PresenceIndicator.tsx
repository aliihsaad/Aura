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
    className: 'bg-emerald-400/60 presence-breathing',
    label: 'Idle',
  },
  listening: {
    className: 'bg-cyan-400/70 presence-breathing',
    label: 'Listening',
  },
  thinking: {
    className: 'bg-amber-400/80 presence-pulsing',
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
          className="bg-emerald-400 rounded-full presence-wave-bar"
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
