import { ProfileContext, SessionContext, SessionIntent, UserContext } from './types'
import { getSessionBehavior } from './session-intent-policy'

/** Human-readable local "now" for prompt grounding, e.g.
 * "Wednesday, June 11, 2026, 09:58". Rebuilt on every prompt assembly so
 * long sessions don't drift. */
export function formatCurrentDateTime(): string {
  return new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function buildSystemPrompt(
  profileOrContext: ProfileContext | UserContext,
  session: SessionContext,
  fileContext?: string,
  recallContext?: string,
  answerLanguage?: string
): string {
  // Normalize inputs into a flat shape regardless of caller variant.
  // - Merged: UserContext — flat fields
  // - Current: ProfileContext — profile fields
  interface FlatProfile {
    name: string
    commsStyle: string
    extraInstructions: string
    languages: string
    occupation: string
    currentFocus: string
    relationships: string
  }

  const isUserContext = (value: ProfileContext | UserContext): value is UserContext =>
    'preferredAnswerStyle' in value

  let profile: FlatProfile
  if (isUserContext(profileOrContext)) {
    profile = {
      name: profileOrContext.name || '',
      commsStyle: profileOrContext.preferredAnswerStyle || '',
      extraInstructions: profileOrContext.extraInstructions || '',
      languages: '',
      occupation: '',
      currentFocus: '',
      relationships: '',
    }
  } else {
    profile = {
      name: profileOrContext.name || '',
      commsStyle: profileOrContext.commsStyle || '',
      extraInstructions: profileOrContext.extraInstructions || '',
      languages: profileOrContext.languages || '',
      occupation: profileOrContext.occupation || '',
      currentFocus: profileOrContext.currentFocus || '',
      relationships: profileOrContext.relationships || '',
    }
  }

  const userName = profile.name || 'the user'
  const behavior = getSessionBehavior(session.sessionIntent)

  const backgroundParts: string[] = []

  const aboutMeParts: string[] = []
  if (profile.occupation) aboutMeParts.push(`Occupation: ${profile.occupation}`)
  if (profile.currentFocus) aboutMeParts.push(`Currently focused on: ${profile.currentFocus}`)
  if (profile.languages) aboutMeParts.push(`Languages: ${profile.languages}`)
  if (profile.relationships) aboutMeParts.push(`Relationships: ${profile.relationships}`)
  if (aboutMeParts.length > 0) {
    backgroundParts.push(`## About ${userName}\n${aboutMeParts.join('\n')}`)
  }

  if (profile.extraInstructions) {
    backgroundParts.push(`## Extra Context\n${profile.extraInstructions}`)
  }
  if (fileContext) {
    backgroundParts.push(`## Preparation Notes\n${fileContext}`)
  }
  if (recallContext) {
    backgroundParts.push(`## Recalled Context\n${recallContext}`)
  }
  if (session.subject) {
    backgroundParts.push(`## Current Topic: ${session.subject}`)
  }
  if (session.sessionNotes) {
    backgroundParts.push(`## Session Notes\n${session.sessionNotes}`)
  }

  const backgroundBlock = backgroundParts.length > 0
    ? `\n# ${userName}'s Background\n${backgroundParts.join('\n\n')}`
    : ''

  const styleNote = profile.commsStyle
    ? `\nPreferred answer style: "${profile.commsStyle}". Adapt your tone and structure to match.`
    : ''

  const languageNote = answerLanguage && answerLanguage !== 'en'
    ? `\n\n# Language\nIMPORTANT: Write ALL answers in ${answerLanguage}. The session is being conducted in ${answerLanguage}, so every response must be in that language. Only code snippets and technical terms may remain in English.`
    : ''

  return `You are Aura acting as a ${behavior.agentRole} for ${userName} during a live session.

Current date and time: ${formatCurrentDateTime()}.

Your single job: produce the most directly useful response for the user's current request. Write like a sharp local copilot, not an essay.
${backgroundBlock}

# Session Behavior Contract

- Primary input: ${behavior.primaryInput}
- Default response shape: ${behavior.responseShape}
- Trigger posture: ${behavior.autoTriggerStrategy}
- Detail window policy: ${behavior.detailWindowPolicy}
- Screen/code policy: ${behavior.screenCodePolicy}
- Artifact policy: ${behavior.artifactPolicy}

# How to Write Answers

Core rules:
- Answer directly instead of narrating your process
- Use concise structure only when it genuinely helps
- Prefer concrete next steps, examples, or decisions over generic advice
- If the notes or recalled context contain specifics, use them explicitly
- Keep the response grounded in the provided background and recalled context when available
- If the request is ambiguous, make the best reasonable assumption and state it briefly
- Keep the output scannable under time pressure

# Quick Help Guidance

- Prioritize speed and usefulness over polish
- Give the shortest answer that still solves the request
- If there is an obvious next action, include it plainly

# Formatting

- Use short paragraphs by default
- Use bullet points only when there are distinct points to scan quickly
- Use numbered lists only for true sequences or rankings
- Use short headings only when the answer has clearly separate sections
- For code or commands, use fenced code blocks with a language tag when possible

# Edge Cases

- If the transcript or request is clearly incomplete, garbled, or just filler words, return exactly: WAITING_FOR_MORE_CONTEXT
- If the answer depends on missing facts, state the missing assumption briefly and continue with the best useful answer
${styleNote}${languageNote}`
}

export function buildAgentSystemPrompt(
  soulPrompt: string,
  personalityFragment: string,
  basePrompt: string
): string {
  const sections: string[] = []
  if (soulPrompt.trim()) sections.push(soulPrompt.trim())
  if (personalityFragment.trim()) {
    sections.push(`## Personality\n${personalityFragment.trim()}`)
  }
  sections.push(`## Task Context\n${basePrompt}`)
  return sections.join('\n\n')
}

export function buildQuestionPrompt(question: string, _sessionIntent: SessionIntent = 'quick-help'): string {
  return `Help with this request:

"${question}"

Write the most useful response for the user right now. Be direct, concrete, and practical.`
}

export function buildQuestionNormalizationPrompt(rawQuestion: string, recentTranscript: string): string {
  return `You clean up noisy speech-to-text transcript from a live conversation.

Your task:
- rewrite the transcript into one clean prompt or request
- preserve the original meaning
- remove filler words, repetition, and ASR noise
- combine broken fragments into one coherent question
- keep product names, hardware names, and technical terms if they are present
- do not answer the question
- do not add explanation
- output only the rewritten question text

Relevant transcript context:
${recentTranscript || '(none)'}

Noisy question transcript:
"${rawQuestion}"`
}

export function buildScreenCapturePrompt(
  question?: string,
  sessionIntent: SessionIntent = 'quick-help'
): string {
  const behavior = getSessionBehavior(sessionIntent)
  if (question?.trim()) {
    return `You are looking at a live screenshot of the user's current screen.

The user asked:
"${question.trim()}"

Rules:
- Describe only what is actually visible in the screenshot
- If text is too small, blurry, or partially obscured, say that clearly
- Do not invent windows, tabs, code, or UI elements that you cannot see
- If the user asked a specific question about the screen, answer it using only visible evidence
- Keep the answer practical and direct
- Screen/code policy: ${behavior.screenCodePolicy}

If helpful, structure your response as:
1. What is clearly visible
2. What is uncertain or unreadable
3. The direct answer to the user's question`
  }

  return `Analyze this screenshot from the user's current session.

Look at what is actually visible and respond appropriately:

If it's code, logs, or a technical error:
1. Identify the visible issue or task
2. Explain the likely meaning
3. Suggest the next concrete step

If it's a document, notes, or planning material:
1. Summarize what is visible
2. Pull out the important points
3. Suggest a practical next action if relevant

If it's a UI or app workflow:
1. Describe what is visible
2. Identify what the user appears to be doing
3. Point out obvious blockers, options, or next steps

Screen/code policy: ${behavior.screenCodePolicy}

Only describe what is actually visible. Do not invent hidden tabs, files, or text.`
}
