import React from 'react'
import type { AgentPresenceState } from '@shared/types'

/**
 * Aura's ambient presence — a living orb (Phase 3 locked direction).
 *
 * Layered structure, outermost first:
 *   halo   — soft radial glow breathing behind everything
 *   ring   — expanding pulse ring (listening/thinking/speaking only)
 *   aurora — rotating conic blue→violet→teal sheen, blurred
 *   core   — the orb body: radial gradients + specular highlight
 *
 * State drives tempo and hue via .orb-state-* classes in styles.css.
 * Everything animates on transform/opacity/filter only, so the orb can
 * idle for hours without measurable GPU cost.
 */

interface OrbPresenceProps {
  state: AgentPresenceState
  size?: number
}

const STATE_LABELS: Record<AgentPresenceState, string> = {
  sleeping: 'Aura is resting',
  idle: 'Aura is here',
  listening: 'Aura is listening',
  thinking: 'Aura is thinking…',
  speaking: 'Aura is speaking',
}

const RING_STATES: ReadonlySet<AgentPresenceState> = new Set(['listening', 'thinking', 'speaking'])

export default function OrbPresence({ state, size = 92 }: OrbPresenceProps) {
  const haloSize = Math.round(size * 1.9)
  const auroraSize = Math.round(size * 1.18)

  return (
    <div
      className={`orb-state-${state} relative flex items-center justify-center select-none`}
      style={{ width: haloSize, height: haloSize }}
      title={STATE_LABELS[state]}
    >
      <div className="orb-halo absolute inset-0" />
      {RING_STATES.has(state) && (
        <div
          className="orb-ring absolute"
          style={{ width: auroraSize, height: auroraSize }}
        />
      )}
      <div
        className="orb-aurora absolute"
        style={{ width: auroraSize, height: auroraSize }}
      />
      <div
        className="orb-core relative transition-[filter,opacity] duration-700"
        style={{ width: size, height: size }}
      />
    </div>
  )
}
