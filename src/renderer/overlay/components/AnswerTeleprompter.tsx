import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Mic, Pause, X } from 'lucide-react'
import type { TranscriptEntry } from '@shared/types'

const VOICE_WORD_LOOKAHEAD = 12
const TELEPROMPTER_TARGET_WORDS = 9
const TELEPROMPTER_MAX_WORDS = 12
const TELEPROMPTER_MAX_CHARS = 72
const SCRIPT_STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'you', 'your', 'for', 'are', 'but',
  'not', 'have', 'has', 'was', 'were', 'from', 'they', 'them', 'our', 'out',
  'can', 'will', 'would', 'should', 'could', 'just', 'like', 'then', 'than',
])

interface AnswerTeleprompterProps {
  answer: string
  question: string
  isStreaming: boolean
  onExit: () => void
  onClose: () => void
}

function stripEmoji(value: string): string {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/g, '')
}

function normalizeVoiceToken(value: string): string {
  return stripEmoji(value)
    .toLowerCase()
    .replace(/[`*_~>#]/g, '')
    .replace(/[^a-z0-9']/g, '')
    .trim()
}

function tokenizeVoiceWords(value: string): string[] {
  return value
    .split(/\s+/)
    .map(normalizeVoiceToken)
    .filter(Boolean)
}

function isMeaningfulVoiceToken(token: string): boolean {
  return token.length > 2 && !SCRIPT_STOP_WORDS.has(token)
}

function voiceTokensMatch(spoken: string, expected: string): boolean {
  if (!spoken || !expected) return false
  if (spoken === expected) return true
  return spoken.length >= 5 && expected.length >= 5 && (spoken.startsWith(expected) || expected.startsWith(spoken))
}

function toTeleprompterLines(answer: string): string[] {
  return stripEmoji(answer)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/\*\*/g, '')
        .trim()
    )
    .flatMap(splitTeleprompterLine)
    .filter((line) => {
      if (!line) return false
      if (line.includes('|') && line.split('|').length > 2) return false
      return toTeleprompterWords(line).length > 0
    })
}

function splitTeleprompterLine(line: string): string[] {
  if (!line.trim()) return []

  const leadingCueMatch = line.match(/^((?:\[(?:anchor|pause|demo):?\s*[^\]]*\]\s*)+)/i)
  const leadingCue = leadingCueMatch?.[1].trim() || ''
  const speakableText = leadingCue ? line.slice(leadingCueMatch?.[1].length || 0).trim() : line.trim()
  const segments = speakableText
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((segment) => segment.trim())
    .filter(Boolean)

  const wrapped: string[] = []
  let cuePending = leadingCue

  for (const segment of segments.length > 0 ? segments : [line.trim()]) {
    const chunks = wrapTeleprompterSegment(segment)
    for (const chunk of chunks) {
      wrapped.push(cuePending ? `${cuePending} ${chunk}`.trim() : chunk)
      cuePending = ''
    }
  }

  return wrapped.length > 0 ? wrapped : [line.trim()]
}

function wrapTeleprompterSegment(segment: string): string[] {
  const words = segment.split(/\s+/).filter(Boolean)
  if (words.length <= TELEPROMPTER_MAX_WORDS && segment.length <= TELEPROMPTER_MAX_CHARS) {
    return [segment]
  }

  const chunks: string[] = []
  let current: string[] = []

  const flush = () => {
    if (current.length === 0) return
    chunks.push(current.join(' '))
    current = []
  }

  for (const word of words) {
    current.push(word)

    const currentText = current.join(' ')
    const speechWordCount = current.filter((part) => normalizeVoiceToken(part)).length
    const naturalBreak = /[,;:.!?]$/.test(word)
    const shouldBreak =
      speechWordCount >= TELEPROMPTER_MAX_WORDS ||
      currentText.length >= TELEPROMPTER_MAX_CHARS ||
      (speechWordCount >= TELEPROMPTER_TARGET_WORDS && naturalBreak)

    if (shouldBreak) flush()
  }

  flush()
  return chunks
}

function toTeleprompterWords(line: string): string[] {
  return stripCueMarkersForSpeech(stripEmoji(line))
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => normalizeVoiceToken(word).length > 0)
}

function extractCueMarkers(line: string): string[] {
  return Array.from(line.matchAll(/\[(anchor|pause|demo):?\s*([^\]]*)\]/gi))
    .map((match) => {
      const label = match[1].toLowerCase()
      const value = match[2].trim()
      return value ? `${label}: ${value}` : label
    })
}

function stripCueMarkersForSpeech(line: string): string {
  return line.replace(/\[(anchor|pause|demo):?\s*[^\]]*\]/gi, ' ')
}

function findVoiceProgress(
  spokenText: string,
  scriptLine: string,
  currentWordIndex: number,
  requireStartMatch = false
): { nextWordIndex: number; score: number; complete: boolean } | null {
  const spokenTokens = tokenizeVoiceWords(spokenText)
  const words = toTeleprompterWords(scriptLine)
  const wordTokens = words.map(normalizeVoiceToken)
  const trackableIndexes = wordTokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => Boolean(token))

  if (spokenTokens.length === 0 || trackableIndexes.length === 0) return null

  const currentTrackablePosition = Math.max(
    0,
    trackableIndexes.findIndex(({ index }) => index >= currentWordIndex)
  )
  const start = requireStartMatch ? 0 : Math.max(0, currentTrackablePosition - 2)
  const end = requireStartMatch
    ? Math.min(trackableIndexes.length - 1, VOICE_WORD_LOOKAHEAD)
    : Math.min(trackableIndexes.length - 1, currentTrackablePosition + VOICE_WORD_LOOKAHEAD)
  const matchedIndexes: number[] = []

  for (let position = start; position <= end; position++) {
    const { token: expected, index } = trackableIndexes[position]
    if (spokenTokens.some((spoken) => voiceTokensMatch(spoken, expected))) {
      matchedIndexes.push(index)
    }
  }

  if (matchedIndexes.length === 0) return null

  const meaningfulMatches = matchedIndexes.filter((index) => isMeaningfulVoiceToken(wordTokens[index]))
  const matchedExpectedWord = matchedIndexes.some((index) => index <= currentWordIndex + 1)
  const firstMatchedIndex = matchedIndexes[0]
  const matchedRun = matchedIndexes.reduce((longest, index, position) => {
    if (position === 0) return Math.max(longest, 1)
    return matchedIndexes[position - 1] === index - 1 ? Math.max(longest, 2) : longest
  }, 0)

  if (requireStartMatch && firstMatchedIndex > 1) return null
  if (!matchedExpectedWord && meaningfulMatches.length < 2) return null
  if (meaningfulMatches.length === 0 && matchedRun < 2) return null
  if (spokenTokens.length > 5 && meaningfulMatches.length < 2 && matchedRun < 2) return null

  const maxMatchedIndex = Math.max(...matchedIndexes)
  const lastTrackableIndex = trackableIndexes[trackableIndexes.length - 1].index
  const nextWordIndex = Math.min(maxMatchedIndex + 1, Math.max(words.length - 1, 0))
  const complete = maxMatchedIndex >= lastTrackableIndex
  const score = Math.min(1, (meaningfulMatches.length + matchedRun) / Math.max(3, spokenTokens.length))

  return { nextWordIndex, score, complete }
}

export default function AnswerTeleprompter({
  answer,
  question,
  isStreaming,
  onExit,
  onClose,
}: AnswerTeleprompterProps) {
  const [lineIndex, setLineIndex] = useState(0)
  const [wordIndex, setWordIndex] = useState(0)
  const [voiceTracking, setVoiceTracking] = useState(true)
  const [lineExiting, setLineExiting] = useState(false)
  const [lastVoiceMatch, setLastVoiceMatch] = useState<{ score: number; text: string } | null>(null)
  const lineIndexRef = useRef(lineIndex)
  const wordIndexRef = useRef(wordIndex)
  const voiceTrackingRef = useRef(voiceTracking)
  const linesRef = useRef<string[]>([])
  const flipTimerRef = useRef<number | null>(null)

  const lines = toTeleprompterLines(answer)
  const currentLine = lines[lineIndex] || ''
  const nextLine = lines[lineIndex + 1] || ''
  const currentWords = toTeleprompterWords(currentLine)
  const currentCues = extractCueMarkers(currentLine)

  useEffect(() => { lineIndexRef.current = lineIndex }, [lineIndex])
  useEffect(() => { wordIndexRef.current = wordIndex }, [wordIndex])
  useEffect(() => { voiceTrackingRef.current = voiceTracking }, [voiceTracking])
  useEffect(() => { linesRef.current = lines }, [lines])

  useEffect(() => {
    if (lineIndex >= lines.length) {
      setLineIndex(Math.max(0, lines.length - 1))
      setWordIndex(0)
    }
  }, [lineIndex, lines.length])

  const moveLine = useCallback((delta: number) => {
    if (flipTimerRef.current != null) {
      window.clearTimeout(flipTimerRef.current)
      flipTimerRef.current = null
    }
    setLineExiting(false)
    setLastVoiceMatch(null)
    setWordIndex(0)
    setLineIndex((prev) => Math.min(Math.max(prev + delta, 0), Math.max(linesRef.current.length - 1, 0)))
  }, [])

  useEffect(() => {
    const cleanup = window.api.onTranscriptUpdate((entry: TranscriptEntry) => {
      if (!voiceTrackingRef.current) return
      if (entry.speaker !== 'user' && entry.speaker !== 'unknown') return

      const spokenText = entry.text.trim()
      const currentLines = linesRef.current
      if (!spokenText || currentLines.length === 0) return

      const currentLineIndex = lineIndexRef.current
      const currentProgress = findVoiceProgress(
        spokenText,
        currentLines[currentLineIndex] || '',
        wordIndexRef.current
      )
      const nextProgress = !currentProgress && currentLineIndex < currentLines.length - 1
        ? findVoiceProgress(spokenText, currentLines[currentLineIndex + 1] || '', 0, true)
        : null
      const progress = currentProgress || nextProgress
      if (!progress) return

      const matchedLineIndex = currentProgress ? currentLineIndex : currentLineIndex + 1
      setLineIndex(matchedLineIndex)
      setWordIndex(progress.nextWordIndex)
      setLineExiting(false)
      setLastVoiceMatch({ score: progress.score, text: spokenText.slice(0, 90) })

      if (progress.complete && matchedLineIndex < currentLines.length - 1) {
        if (flipTimerRef.current != null) window.clearTimeout(flipTimerRef.current)
        setWordIndex(Math.max(toTeleprompterWords(currentLines[matchedLineIndex]).length - 1, 0))
        setLineExiting(true)
        flipTimerRef.current = window.setTimeout(() => {
          flipTimerRef.current = null
          setLineExiting(false)
          setLineIndex(matchedLineIndex + 1)
          setWordIndex(0)
        }, 280)
      }
    })

    return cleanup
  }, [])

  if (lines.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent p-6 text-white">
        <div className="rounded-2xl border border-white/[0.06] bg-black/30 px-6 py-5 text-center backdrop-blur-xl">
          <p className="text-sm text-white/60">
            {isStreaming ? 'Preparing teleprompter text...' : 'No speakable answer available.'}
          </p>
          <button
            onClick={onExit}
            className="mt-4 rounded-xl bg-white/[0.06] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/60 hover:bg-white/[0.1] hover:text-white"
          >
            Back to answer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="drag-handle relative flex h-full w-full items-center justify-center overflow-hidden bg-transparent px-8 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(8,12,18,0.28),rgba(8,12,18,0)_68%)]" />

      <div className="no-drag absolute right-5 top-5 z-20 flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-black/25 px-2 py-2 opacity-35 shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-opacity hover:opacity-100">
        <button
          onClick={() => moveLine(-1)}
          disabled={lineIndex <= 0}
          className="rounded-xl p-2 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
          title="Previous line"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => setVoiceTracking((prev) => !prev)}
          className={`rounded-xl p-2 transition-colors ${
            voiceTracking
              ? 'bg-cyan-400/15 text-cyan-200'
              : 'text-white/65 hover:bg-white/[0.08] hover:text-white'
          }`}
          title="Track mic"
        >
          {voiceTracking ? <Mic size={16} /> : <Pause size={16} />}
        </button>
        <button
          onClick={() => moveLine(1)}
          disabled={lineIndex >= lines.length - 1}
          className="rounded-xl p-2 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
          title="Next line"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={onExit}
          className="rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          title="Return to answer"
        >
          Answer
        </button>
        <button
          onClick={onClose}
          className="rounded-xl p-2 text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="relative z-10 flex w-full max-w-[1120px] flex-col items-center text-center">
        <div className="mb-6 max-w-[900px] rounded-2xl border border-amber-400/[0.06] bg-amber-500/[0.035] px-4 py-2 text-[13px] font-medium leading-snug text-amber-100/45 backdrop-blur-xl">
          {question}
        </div>

        <div className="mb-8 flex items-center gap-3 rounded-full border border-white/[0.06] bg-black/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35 backdrop-blur-xl">
          <span>
            {voiceTracking
              ? `Tracking mic${lastVoiceMatch ? ` · ${Math.round(lastVoiceMatch.score * 100)}%` : ''}`
              : 'Paused'}
          </span>
          <span className="h-1 w-1 rounded-full bg-white/20" />
          <span>{lineIndex + 1}/{lines.length}</span>
        </div>

        <div
          key={lineIndex}
          className={`teleprompter-current-line ${lineExiting ? 'teleprompter-flip-up' : 'teleprompter-line-enter'}`}
        >
          {currentWords.map((word, index) => (
            <React.Fragment key={`${word}-${index}`}>
              <span
                className={`transition-colors duration-150 ${
                  index === Math.min(wordIndex, currentWords.length - 1)
                    ? 'text-cyan-200 drop-shadow-[0_0_18px_rgba(103,232,249,0.72)]'
                    : index < wordIndex
                      ? 'text-white'
                      : 'text-white/58'
                }`}
              >
                {word}
              </span>
              {index < currentWords.length - 1 && ' '}
            </React.Fragment>
          ))}
        </div>

        {currentCues.length > 0 && (
          <div className="mt-5 flex max-w-[920px] flex-wrap justify-center gap-2">
            {currentCues.map((cue) => (
              <span
                key={cue}
                className="rounded-full border border-cyan-300/[0.10] bg-cyan-300/[0.06] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-cyan-100/45"
              >
                {cue}
              </span>
            ))}
          </div>
        )}

        {nextLine && (
          <div className="mt-8 max-w-[920px] [overflow-wrap:anywhere] text-[34px] font-semibold leading-snug text-white/34 drop-shadow-[0_8px_30px_rgba(0,0,0,0.55)]">
            {nextLine}
          </div>
        )}
      </div>
    </div>
  )
}
