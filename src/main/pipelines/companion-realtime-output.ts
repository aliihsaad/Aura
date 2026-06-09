const PLANNING_HEADING_PATTERN = /^\*\*([^*\n]{3,90})\*\*\s*/

const INTERNAL_NARRATION_PATTERNS = [
  /\bthe user\b/i,
  /\buser['’]s\b/i,
  /\bsession details\b/i,
  /\bcore of the request\b/i,
  /\bhomed in\b/i,
  /\bzeroing in\b/i,
  /\bokay,\s+i see\b/i,
  /\bcurrent conversational flow\b/i,
  /\bcurrent focus\b/i,
  /\bintent of this session\b/i,
  /\bquick-help\b/i,
  /\bcrafting a response\b/i,
  /\baiming to provide\b/i,
  /\bdata manipulation request\b/i,
  /\bavailable context\b/i,
  /\binformation at hand\b/i,
  /\bextracting the\b/i,
  /\bpersona\b/i,
  /\bready to begin\b/i,
  /\bprompting them\b/i,
  /\bawaiting further information\b/i,
  /\bi(?:'ve| have)\s+registered\b/i,
  /\bi(?:'m| am)\s+(?:confirming|picking up|holding back|prepared|ready|assuming|awaiting|focusing|trying|striving)\b/i,
  /\bi(?:'ll| will| need to| should)\s+(?:assume|need|word|acknowledge|reiterate|strive|provide|focus)\b/i,
]

export function sanitizeRealtimeAssistantOutput(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const headingMatch = trimmed.match(PLANNING_HEADING_PATTERN)
  const body = headingMatch
    ? trimmed.slice(headingMatch[0].length).trimStart()
    : trimmed

  if (!body) return null

  if (looksLikeInternalNarration(body)) {
    const tail = extractUserFacingTail(body)
    return tail ? normalizeUserFacingOutput(tail) : null
  }

  return normalizeUserFacingOutput(body)
}

function looksLikeInternalNarration(text: string): boolean {
  return INTERNAL_NARRATION_PATTERNS.some((pattern) => pattern.test(text))
}

function extractUserFacingTail(text: string): string | null {
  const sentences = splitSentences(text)
  const kept: string[] = []

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]
    if (looksLikeInternalNarration(sentence)) {
      if (kept.length > 0) break
      continue
    }
    if (looksUserFacingSentence(sentence)) {
      kept.unshift(sentence)
      continue
    }
    if (kept.length > 0) break
  }

  return kept.join(' ').trim() || null
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function looksUserFacingSentence(text: string): boolean {
  if (looksLikeInternalNarration(text)) return false
  return /^(?:your|you(?:'re| are| can| should| need| have)?|yes|no|hi|hello|sure|okay|ok|i can|i can't|it looks|looks like|the answer|that is|this is)\b/i.test(text.trim())
}

function normalizeUserFacingOutput(text: string): string {
  return text
    .trim()
    .replace(/^Your name ([A-Z][A-Za-z'-]+)\.$/, 'Your name is $1.')
}
