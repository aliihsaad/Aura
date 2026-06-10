import { SessionIntent, TranscriptEntry } from '@shared/types'
import {
  isExternalAudioEntry,
  isSelfAuthoredEntry,
  shouldTreatExternalTranscriptAsPrompt,
  shouldUseExternalAudioPrompts,
} from '@shared/session-intent-policy'
import { LLMService } from './llm-service'

const MIN_WORDS_QUESTION_PATTERN = 4
const MIN_WORDS_ANY_TEXT = 10

export function getLatestQuestionCandidate(
  sessionTranscript: TranscriptEntry[],
  lastGeneratedPromptTranscriptCount: number,
  forceRecentFallback: boolean,
  sessionIntent: SessionIntent = 'quick-help'
): string {
  const finalEntries = getRelevantPromptEntries(sessionTranscript, sessionIntent)
  if (finalEntries.length === 0) return ''

  const newEntries = finalEntries.slice(lastGeneratedPromptTranscriptCount)
  const candidateEntries = newEntries.length > 0
    ? newEntries
    : forceRecentFallback
      ? finalEntries.slice(-3)
      : []

  if (candidateEntries.length === 0) return ''

  const texts = candidateEntries.map((entry) => entry.text.trim()).filter(Boolean)

  const trimmed: string[] = []
  let foundSubstance = false
  for (const text of texts) {
    const lower = text.toLowerCase().replace(/[^\w\s?]/g, '').trim()
    const words = lower.split(/\s+/).filter(Boolean)

    if (!foundSubstance) {
      const isAcknowledgment = words.length <= 3 && isFillerPhrase(lower)
      if (isAcknowledgment) continue
      foundSubstance = true
    }
    trimmed.push(text)
  }

  return trimmed.join(' ').trim()
}

export function shouldGenerateForQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question)
  if (!normalized) return false

  const fillerOnly = new Set([
    'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'right', 'hello', 'hi',
    'thanks', 'thank you', 'got it', 'got ya', 'gotcha', 'alright',
    'sounds good', 'perfect', 'great', 'nice', 'awesome', 'cool',
    'good', 'absolutely', 'exactly', 'correct', 'indeed', 'mhm',
  ])
  if (fillerOnly.has(normalized)) return false

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 3) return false

  const transitionPhrases = [
    'let me', 'so let me', 'alright so', 'okay so', 'moving on',
    'so next', 'the next', 'now i want', 'now let me', 'before we',
    'so before', 'going back', 'one more thing', 'just to clarify',
    'i see', 'that makes sense', 'interesting', 'good answer',
    'great answer', 'nice work', 'well done', 'thank you for',
    'thanks for', 'i appreciate', 'so basically', 'so essentially',
  ]
  if (transitionPhrases.some((phrase) => normalized.startsWith(phrase)) && !normalized.includes('?')) {
    return false
  }

  if (/[?]$/.test(question.trim()) && words.length >= MIN_WORDS_QUESTION_PATTERN) return true

  const questionStarters = [
    'tell me', 'walk me', 'can you', 'could you', 'would you',
    'what', 'why', 'how', 'when', 'where', 'which',
    'describe', 'explain', 'give me', 'talk about', 'share',
    'have you', 'do you', 'did you', 'are you', 'were you',
    'is there', 'was there',
  ]

  if (questionStarters.some((starter) => normalized.startsWith(starter))) {
    return words.length >= MIN_WORDS_QUESTION_PATTERN
  }

  return words.length >= MIN_WORDS_ANY_TEXT
}

export function shouldGenerateForAutoPrompt(
  question: string,
  sessionIntent: SessionIntent = 'quick-help'
): boolean {
  if (!shouldTreatExternalTranscriptAsPrompt(sessionIntent, question)) {
    return false
  }
  return shouldGenerateForQuestion(question)
}

export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w\s?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function prepareQuestionForAnswer(
  question: string,
  llmService: LLMService | null,
  sessionTranscript: TranscriptEntry[],
  sessionIntent: SessionIntent = 'quick-help'
): Promise<string> {
  const cleanedQuestion = cleanTranscriptQuestion(question)
  if (!cleanedQuestion) return ''

  if (!llmService) return cleanedQuestion

  try {
    const rewritten = await llmService.normalizeQuestion(cleanedQuestion, sessionTranscript, {
      sessionIntent,
    })
    return finalizeNormalizedQuestion(rewritten, cleanedQuestion)
  } catch (error: any) {
    console.error('[LLM] Question normalization failed:', error.message)
    return cleanedQuestion
  }
}

export function countFinalPromptEntries(
  sessionTranscript: TranscriptEntry[],
  sessionIntent: SessionIntent = 'quick-help'
): number {
  return getRelevantPromptEntries(sessionTranscript, sessionIntent).length
}

export function getRecentNormalizationContext(
  sessionTranscript: TranscriptEntry[],
  sessionIntent: SessionIntent = 'quick-help'
): TranscriptEntry[] {
  return getRelevantPromptEntries(sessionTranscript, sessionIntent).slice(-4)
}

function isFillerPhrase(text: string): boolean {
  const fillerPhrases = [
    'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'right', 'alright',
    'got it', 'gotcha', 'sounds good', 'perfect', 'great', 'awesome',
    'cool', 'good', 'nice', 'absolutely', 'exactly', 'correct',
    'indeed', 'mhm', 'uh huh', 'i see', 'that makes sense',
    'interesting', 'good answer', 'great answer', 'nice work',
    'well done', 'thanks', 'thank you', 'thanks for that',
    'thank you for that', 'moving on', 'so next', 'one moment',
    'let me think', 'hold on', 'just a second', 'give me a moment',
  ]
  const lower = text.toLowerCase().replace(/[^\w\s]/g, '').trim()
  return fillerPhrases.some((phrase) => lower === phrase || lower.startsWith(phrase + ' '))
}

function cleanTranscriptQuestion(question: string): string {
  const fillerWords = new Set([
    'uh', 'um', 'erm', 'hmm', 'mm', 'like', 'you know',
    'i mean', 'sort of', 'kind of', 'basically', 'actually',
    'right', 'so', 'well', 'anyway', 'anyways',
  ])

  const words = question
    .replace(/\r?\n/g, ' ')
    .replace(/[.,]{2,}/g, ' ')
    .replace(/(\b\w+\b)( \1\b)+/gi, '$1')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  const cleaned: string[] = []

  for (const word of words) {
    const normalizedWord = word.toLowerCase().replace(/[^\w'-]/g, '')

    if (fillerWords.has(normalizedWord)) continue

    const previousWord = cleaned[cleaned.length - 1]?.toLowerCase().replace(/[^\w'-]/g, '')
    if (previousWord && previousWord === normalizedWord) continue

    cleaned.push(word)
  }

  return cleaned.join(' ').replace(/\s+/g, ' ').trim()
}

function finalizeNormalizedQuestion(rewritten: string, fallback: string): string {
  const candidate = rewritten
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^(question|interviewer question|prompt|request)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!candidate) return fallback
  if (candidate.length > 240) return fallback
  if (candidate.split(/\s+/).length < 4) return fallback

  return candidate
}

function getRelevantPromptEntries(
  sessionTranscript: TranscriptEntry[],
  sessionIntent: SessionIntent
): TranscriptEntry[] {
  return sessionTranscript.filter((entry) => {
    if (!entry.isFinal) return false
    if (shouldUseExternalAudioPrompts(sessionIntent)) {
      return isExternalAudioEntry(entry)
    }
    return isSelfAuthoredEntry(entry)
  })
}
