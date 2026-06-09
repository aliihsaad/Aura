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
  usesInterviewType: boolean
  usesExternalAudioPrompts: boolean
  externalPromptMode: 'question-or-request' | 'question-only' | 'passive' | 'none'
  autoOpenAnswerWindowForExternalPrompt: boolean
  savesClassDigest: boolean
  behavior: SessionBehavior
}

export const SESSION_INTENT_SPECS = {
  interview: {
    intent: 'interview',
    label: 'Interview',
    setupDescription: 'Structured interview coaching with ready-to-say answers.',
    externalTranscriptLabel: 'Interviewer',
    subjectLabel: 'Subject',
    organizationLabel: 'Company',
    roleLabel: 'Role',
    notesLabel: 'Session Notes',
    answerStyleLabel: 'Ready-to-say interview coaching',
    usesInterviewType: true,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-or-request',
    autoOpenAnswerWindowForExternalPrompt: false,
    savesClassDigest: false,
    behavior: {
      agentRole: 'live interview coach',
      primaryInput: 'system audio questions from the interviewer',
      responseShape: 'first-person teleprompter or structured technical answer',
      autoTriggerStrategy: 'answer likely interviewer prompts; ignore filler and candidate mic context',
      detailWindowPolicy: 'use detail window for code, diagrams, long technical breakdowns, or sourced research',
      detailCapabilities: ['detail', 'queue', 'teleprompter', 'read-aloud', 'copy-code', 'sources'],
      screenCodePolicy: 'if the screenshot shows a coding test or exercise, provide the solution code snippet first, then concise explanation and complexity',
      artifactPolicy: 'save transcript and answers; do not create a class digest',
      brainPolicy: 'remember role/company, asked questions, candidate stories, weak areas, coding prompts, and answer outcomes',
    },
  },
  meeting: {
    intent: 'meeting',
    label: 'Meeting',
    setupDescription: 'Live support for meetings, reviews, and stakeholder calls.',
    externalTranscriptLabel: 'Speaker',
    subjectLabel: 'Subject',
    organizationLabel: 'Organization',
    roleLabel: 'Your Role',
    notesLabel: 'Guidance Notes',
    answerStyleLabel: 'Meeting-safe live response support',
    usesInterviewType: false,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-or-request',
    autoOpenAnswerWindowForExternalPrompt: true,
    savesClassDigest: false,
    behavior: {
      agentRole: 'live meeting copilot',
      primaryInput: 'system audio prompts plus explicit user chat or microphone requests',
      responseShape: 'short diplomatic talk track, decision framing, or action wording',
      autoTriggerStrategy: 'answer likely external requests and questions',
      detailWindowPolicy: 'use detail window for structured summaries, action plans, and multi-step responses',
      detailCapabilities: ['detail', 'queue', 'notes', 'read-aloud', 'sources', 'save-memory'],
      screenCodePolicy: 'if code is visible, summarize the blocker or risk unless the user explicitly asks for implementation',
      artifactPolicy: 'save transcript, notes, and answers',
      brainPolicy: 'remember decisions, action items, stakeholders, risks, deadlines, and open questions',
    },
  },
  presentation: {
    intent: 'presentation',
    label: 'Presentation',
    setupDescription: 'Delivery help for demos, talks, walkthroughs, and Q&A.',
    externalTranscriptLabel: 'Presenter',
    subjectLabel: 'Topic',
    organizationLabel: 'Audience / Company',
    roleLabel: 'Presentation Role',
    notesLabel: 'Guidance Notes',
    answerStyleLabel: 'Concise delivery and Q&A support',
    usesInterviewType: false,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-or-request',
    autoOpenAnswerWindowForExternalPrompt: true,
    savesClassDigest: false,
    behavior: {
      agentRole: 'presentation delivery coach',
      primaryInput: 'audience or presenter system audio plus explicit user chat or microphone requests',
      responseShape: 'speaker notes, transitions, and concise Q&A responses',
      autoTriggerStrategy: 'answer likely Q&A prompts or delivery blockers',
      detailWindowPolicy: 'use detail window for slide-by-slide notes or longer narration',
      detailCapabilities: ['detail', 'queue', 'teleprompter', 'read-aloud', 'sources', 'download-images'],
      screenCodePolicy: 'if code or a demo is visible, explain it as presenter narration rather than an interview solution',
      artifactPolicy: 'save transcript, notes, and answers',
      brainPolicy: 'remember deck/topic, audience objections, Q&A, demo issues, and follow-up commitments',
    },
  },
  class: {
    intent: 'class',
    label: 'Class',
    setupDescription: 'Capture lectures, lessons, courses, and workshops with study-oriented help.',
    externalTranscriptLabel: 'Instructor',
    subjectLabel: 'Course / Topic',
    organizationLabel: 'School / Provider',
    roleLabel: 'Student Role',
    notesLabel: 'Learning Notes',
    answerStyleLabel: 'Study notes, explanations, and follow-up questions',
    usesInterviewType: false,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-only',
    autoOpenAnswerWindowForExternalPrompt: false,
    savesClassDigest: true,
    behavior: {
      agentRole: 'learning assistant',
      primaryInput: 'instructor/system audio as context plus explicit user questions',
      responseShape: 'clear explanation, study notes, examples, and follow-up questions',
      autoTriggerStrategy: 'passive lecture context unless a clear question or user request appears',
      detailWindowPolicy: 'use detail window for lecture summaries, study notes, code walkthroughs, and digests',
      detailCapabilities: ['detail', 'queue', 'notes', 'read-aloud', 'copy-code', 'sources', 'save-memory'],
      screenCodePolicy: 'if the screenshot shows an exercise, failing test, or code task, provide a runnable answer/code snippet in detail, then explain the concept',
      artifactPolicy: 'save transcript, notes, answers, and class digest',
      brainPolicy: 'remember topics, definitions, examples, exercises, mistakes, follow-up questions, and study tasks',
    },
  },
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
    usesInterviewType: false,
    usesExternalAudioPrompts: false,
    externalPromptMode: 'none',
    autoOpenAnswerWindowForExternalPrompt: false,
    savesClassDigest: false,
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

export function normalizeSessionIntent(value: unknown): SessionIntent {
  if (value === 'lecture' || value === 'course' || value === 'lesson') return 'class'
  if (
    value === 'interview' ||
    value === 'meeting' ||
    value === 'presentation' ||
    value === 'class' ||
    value === 'quick-help'
  ) {
    return value
  }
  return 'interview'
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

export function shouldSaveClassDigest(intent: unknown): boolean {
  return getSessionIntentSpec(intent).savesClassDigest
}
