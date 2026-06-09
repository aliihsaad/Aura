import { PersonalityPreset, SessionContext } from './types'

export interface PersonalityConfig {
  id: PersonalityPreset
  label: string
  systemPromptFragment: string
  confidenceThreshold: number
}

const FOCUSED: PersonalityConfig = {
  id: 'focused',
  label: 'Focused',
  systemPromptFragment: [
    'Be minimal and direct. Only speak when you are highly confident the information is valuable right now.',
    'Prefer silence over marginal suggestions. The user is in deep work.',
    'When you do speak, be precise and code-friendly. No filler, no check-in questions, and no offers of help unless the user explicitly asks.',
  ].join(' '),
  confidenceThreshold: 0.85,
}

const BALANCED: PersonalityConfig = {
  id: 'balanced',
  label: 'Balanced',
  systemPromptFragment: [
    'Be calm, natural, and concise. Surface relevant context when you have it.',
    'Occasionally suggest connections or remind the user of related past work.',
    'Keep your messages short -- usually one sentence, at most two short sentences unless the user asks for more. Avoid tacking on "need help?" or similar check-ins.',
  ].join(' '),
  confidenceThreshold: 0.7,
}

const CURIOUS: PersonalityConfig = {
  id: 'curious',
  label: 'Curious',
  systemPromptFragment: [
    'Be conversational, observant, and natural. Prefer brief observations over questions.',
    'Make connections between topics and suggest ideas the user might not have considered.',
    'Only ask a short question when it is genuinely necessary to understand something important. Do not use questions or offers of help as a default sign-off.',
  ].join(' '),
  confidenceThreshold: 0.55,
}

export const PERSONALITY_PRESETS: Record<Exclude<PersonalityPreset, 'auto'>, PersonalityConfig> = {
  focused: FOCUSED,
  balanced: BALANCED,
  curious: CURIOUS,
}

export function resolvePersonality(
  setting: PersonalityPreset,
  sessionContext?: SessionContext,
  recentEventCount?: number,
  memoryCountForContext?: number
): PersonalityConfig {
  if (setting !== 'auto') {
    return PERSONALITY_PRESETS[setting]
  }

  // Auto selection based on runtime signals
  const interviewType = sessionContext?.interviewType

  // Coding/technical -> Focused
  if (interviewType === 'coding' || interviewType === 'technical') {
    return FOCUSED
  }

  // High activity -> Focused (user is in flow)
  if (recentEventCount !== undefined && recentEventCount > 15) {
    return FOCUSED
  }

  // New context (few memories) -> Curious (learn more)
  if (memoryCountForContext !== undefined && memoryCountForContext < 5) {
    return CURIOUS
  }

  // Low activity -> Curious
  if (recentEventCount !== undefined && recentEventCount < 3) {
    return CURIOUS
  }

  // Default fallback
  return BALANCED
}
