import { InterruptionPolicy } from '@shared/types'

const CANVAS_TOOLS = new Set(['show_bubble', 'show_panel', 'show_toast', 'dismiss_widget'])

interface PolicyCheckResult {
  allowed: boolean
  reason?: string
}

export function checkInterruptionPolicy(
  policy: InterruptionPolicy,
  toolName: string,
  resolvedPolicy?: InterruptionPolicy
): PolicyCheckResult {
  // Non-canvas tools are always allowed
  if (!CANVAS_TOOLS.has(toolName)) {
    return { allowed: true }
  }

  const effectivePolicy = resolvedPolicy ?? policy

  switch (effectivePolicy) {
    case 'silent':
      return { allowed: false, reason: 'Silent mode: canvas tools suppressed' }

    case 'ask-first':
      if (toolName === 'show_panel') {
        return { allowed: false, reason: 'Ask First mode: show_panel requires user click on bubble' }
      }
      return { allowed: true }

    case 'proactive':
      return { allowed: true }

    default:
      return { allowed: true }
  }
}

export function resolveAutoPolicy(
  policy: InterruptionPolicy,
  msSinceLastEvent: number
): InterruptionPolicy {
  if (policy !== 'auto') {
    return policy
  }

  // No events for 30s+ -> proactive (user is idle)
  if (msSinceLastEvent > 30000) {
    return 'proactive'
  }

  // Very recent events (< 3s) -> silent (active conversation)
  if (msSinceLastEvent < 3000) {
    return 'silent'
  }

  // Default auto behavior
  return 'ask-first'
}
