import type { SessionIntent, TranscriptEntry } from './types'

export type DetailCapability =
  | 'detail'
  | 'queue'
  | 'notes'
  | 'teleprompter'
  | 'read-aloud'
  | 'copy-code'
  | 'sources'
  | 'download-images'
  | 'save-memory'

export interface SessionBehavior {
  agentRole: string
  primaryInput: string
  responseShape: string
  autoTriggerStrategy: string
  detailWindowPolicy: string
  detailCapabilities: DetailCapability[]
  screenCodePolicy: string
  artifactPolicy: string
  brainPolicy: string
}

export interface SessionIntentSpec {
  intent: SessionIntent
  label: string
  setupDescription: string
  externalTranscriptLabel: string
  subjectLabel: string
  organizationLabel: string
  roleLabel: string
  notesLabel: string
  answerStyleLabel: string
  usesExternalAudioPrompts: boolean
  externalPromptMode: 'question-or-request' | 'question-only' | 'passive' | 'none'
  autoOpenAnswerWindowForExternalPrompt: boolean
  behavior: SessionBehavior
}

export const SESSION_INTENT_SPECS = {
  'quick-help': {
    intent: 'quick-help',
    label: 'Quick Help',
    setupDescription: 'Direct local companion help from chat or microphone input.',
    externalTranscriptLabel: 'System audio',
    subjectLabel: 'Subject',
    organizationLabel: 'Context',
    roleLabel: 'Role',
    notesLabel: 'Notes',
    answerStyleLabel: 'Direct practical help',
    usesExternalAudioPrompts: false,
    externalPromptMode: 'none',
    autoOpenAnswerWindowForExternalPrompt: false,
    behavior: {
      agentRole: 'direct local copilot',
      primaryInput: 'user-authored chat or microphone request',
      responseShape: 'direct concise answer or tool action',
      autoTriggerStrategy: 'respond only to user-authored prompts',
      detailWindowPolicy: 'bubble first; use detail window for long or tool-heavy results',
      detailCapabilities: ['detail', 'read-aloud', 'copy-code', 'sources', 'download-images', 'save-memory'],
      screenCodePolicy: 'if the user asks about visible code, provide the concrete edit or answer before explanation',
      artifactPolicy: 'save transcript and answers only when a session is active',
      brainPolicy: 'remember durable user preferences, project facts, and completed tasks; ignore throwaway chatter',
    },
  },
} as const satisfies Record<SessionIntent, SessionIntentSpec>

export function normalizeSessionIntent(_value: unknown): SessionIntent {
  return 'quick-help'
}

export function getSessionIntentSpec(intent: unknown): SessionIntentSpec {
  return SESSION_INTENT_SPECS[normalizeSessionIntent(intent)]
}

export function getSessionBehavior(intent: unknown): SessionBehavior {
  return getSessionIntentSpec(intent).behavior
}

export function getTranscriptSpeakerLabel(
  entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>,
  intent: unknown
): string {
  if (entry.source === 'chat' || entry.audioSource === 'chat') return 'Chat'
  if (entry.speaker === 'user' || entry.audioSource === 'microphone') return 'You'
  if (entry.speaker === 'unknown') return 'Unknown'
  return getSessionIntentSpec(intent).externalTranscriptLabel
}

export function isExternalAudioEntry(
  entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>
): boolean {
  if (entry.source === 'chat' || entry.audioSource === 'chat') return false
  if (entry.speaker === 'user' || entry.audioSource === 'microphone') return false
  return true
}

export function isSelfAuthoredEntry(
  entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>
): boolean {
  return (
    entry.source === 'chat' ||
    entry.audioSource === 'chat' ||
    entry.speaker === 'user' ||
    entry.audioSource === 'microphone'
  )
}

export function shouldUseExternalAudioPrompts(intent: unknown): boolean {
  return getSessionIntentSpec(intent).usesExternalAudioPrompts
}

export function shouldAutoOpenAnswerWindowForExternalPrompt(intent: unknown): boolean {
  return getSessionIntentSpec(intent).autoOpenAnswerWindowForExternalPrompt
}

export function shouldTreatExternalTranscriptAsPrompt(intent: unknown, text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  const spec = getSessionIntentSpec(intent)
  if (spec.externalPromptMode === 'none' || spec.externalPromptMode === 'passive') return false
  const words = normalized.split(/\s+/).filter(Boolean)
  const looksQuestionLike =
    normalized.endsWith('?') ||
    /^(what|why|how|when|where|which|can you|could you|would you|do you|does|did|is|are|explain|describe|tell me|walk me)\b/.test(normalized)

  if (spec.externalPromptMode === 'question-only') {
    return looksQuestionLike && words.length >= 4
  }

  const looksRequestLike =
    looksQuestionLike ||
    /^(please|let's|lets|can someone|could someone|we need to|i need you to|summarize|compare|decide|recommend|help me)\b/.test(normalized)
  return looksRequestLike && words.length >= 4
}
