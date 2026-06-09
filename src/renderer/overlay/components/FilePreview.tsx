import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  X,
  Minus,
  Plus as PlusIcon,
  GripVertical,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import type { PreviewWindowItem, TranscriptEntry } from '@shared/types'
import RichContent from './RichContent'

const FONT_MIN = 14
const FONT_MAX = 28
const FONT_STEP = 2
const FONT_DEFAULT = 18
const SCRIPT_SPEED_MIN = 2
const SCRIPT_SPEED_MAX = 12
const SCRIPT_SPEED_DEFAULT = 5
const VOICE_LOOKAHEAD_LINES = 6
const VOICE_MATCH_THRESHOLD = 0.62
const VOICE_INTERIM_MATCH_THRESHOLD = 0.78
const VOICE_MIN_OVERLAP = 2
const VOICE_MIN_INTERIM_TOKENS = 3
const VOICE_WORD_LOOKAHEAD = 10
const SCRIPT_TARGET_WORDS = 9
const SCRIPT_MAX_WORDS = 12
const SCRIPT_MAX_CHARS = 72
const SCRIPT_STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'you', 'your', 'for', 'are', 'but',
  'not', 'have', 'has', 'was', 'were', 'from', 'they', 'them', 'our', 'out',
  'can', 'will', 'would', 'should', 'could', 'just', 'like', 'then', 'than',
])

interface PreviewFile {
  id: string
  name: string
  kind: 'text' | 'image' | 'pdf'
  content: string
  imageUrl?: string
  pdfBase64?: string
  sourceLabel?: string
  isConverting?: boolean
  isEmpty?: boolean
}

function toPreviewFile(item: PreviewWindowItem, existing?: PreviewFile): PreviewFile {
  if (item.kind === 'image') {
    return {
      id: item.id,
      name: item.title,
      kind: 'image',
      content: '',
      imageUrl: item.imageUrl,
      sourceLabel: item.sourceLabel,
      isEmpty: false,
    }
  }

  if (item.kind === 'pdf') {
    return {
      id: item.id,
      name: item.title,
      kind: 'pdf',
      content: existing?.content || '',
      pdfBase64: item.pdfBase64,
      sourceLabel: item.sourceLabel,
      isConverting: !existing?.content,
      isEmpty: false,
    }
  }

  return {
    id: item.id,
    name: item.title,
    kind: 'text',
    content: item.content || '',
    sourceLabel: item.sourceLabel,
    isEmpty: false,
  }
}

function mergePreviewFiles(previous: PreviewFile[], items: PreviewWindowItem[]): PreviewFile[] {
  const itemIds = new Set(items.map((item) => item.id))
  const manualFiles = previous.filter((file) => !itemIds.has(file.id))
  const syncedItems = items.map((item) => {
    const existing = previous.find((file) => file.id === item.id)
    return toPreviewFile(item, existing)
  })

  return [...manualFiles, ...syncedItems]
}

function toScriptLines(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      stripEmoji(line)
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim()
    )
    .flatMap(splitScriptLine)
    .filter((line) => line.length > 0)
}

function splitScriptLine(line: string): string[] {
  if (!line.trim()) return []

  return line
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .flatMap((segment) => wrapScriptSegment(segment.trim()))
    .filter(Boolean)
}

function wrapScriptSegment(segment: string): string[] {
  const words = segment.split(/\s+/).filter(Boolean)
  if (words.length <= SCRIPT_MAX_WORDS && segment.length <= SCRIPT_MAX_CHARS) {
    return segment ? [segment] : []
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
    const text = current.join(' ')
    const wordCount = current.filter((part) => normalizeVoiceToken(part)).length
    const naturalBreak = /[,;:.!?]$/.test(word)

    if (
      wordCount >= SCRIPT_MAX_WORDS ||
      text.length >= SCRIPT_MAX_CHARS ||
      (wordCount >= SCRIPT_TARGET_WORDS && naturalBreak)
    ) {
      flush()
    }
  }

  flush()
  return chunks
}

function stripEmoji(value: string): string {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/g, '')
}

function toTeleprompterWords(line: string): string[] {
  return stripEmoji(line)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => normalizeVoiceToken(word).length > 0)
}

function tokenizeForVoiceMatch(value: string): string[] {
  return tokenizeVoiceWords(value).filter((token) => isMeaningfulVoiceToken(token))
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

function normalizedVoicePhrase(value: string): string {
  return tokenizeForVoiceMatch(value).join(' ')
}

function longestOrderedTokenRun(spokenTokens: string[], lineTokens: string[]): number {
  let longest = 0

  for (let spokenStart = 0; spokenStart < spokenTokens.length; spokenStart++) {
    for (let lineStart = 0; lineStart < lineTokens.length; lineStart++) {
      let run = 0
      while (
        spokenStart + run < spokenTokens.length &&
        lineStart + run < lineTokens.length &&
        spokenTokens[spokenStart + run] === lineTokens[lineStart + run]
      ) {
        run++
      }
      longest = Math.max(longest, run)
    }
  }

  return longest
}

function scoreVoiceMatch(spokenText: string, scriptLine: string): number {
  const spokenTokens = tokenizeForVoiceMatch(spokenText)
  const lineTokens = tokenizeForVoiceMatch(scriptLine)
  if (spokenTokens.length === 0 || lineTokens.length === 0) return 0

  const spokenSet = new Set(spokenTokens)
  const lineSet = new Set(lineTokens)
  let overlap = 0
  spokenSet.forEach((token) => {
    if (lineSet.has(token)) overlap++
  })

  const spokenCoverage = overlap / spokenSet.size
  const lineCoverage = overlap / lineSet.size
  const spokenPhrase = normalizedVoicePhrase(spokenText)
  const linePhrase = normalizedVoicePhrase(scriptLine)
  const orderedRun = longestOrderedTokenRun(spokenTokens, lineTokens)
  const phraseBoost =
    spokenPhrase.length > 8 && linePhrase.length > 8 &&
    (linePhrase.includes(spokenPhrase) || spokenPhrase.includes(linePhrase))
      ? 0.2
      : 0

  const minimumOverlap = Math.min(VOICE_MIN_OVERLAP, spokenSet.size)
  const hasEnoughEvidence = overlap >= minimumOverlap && (overlap >= 3 || orderedRun >= 2 || phraseBoost > 0)
  if (!hasEnoughEvidence) return 0

  return Math.min(1, spokenCoverage * 0.65 + lineCoverage * 0.35 + phraseBoost)
}

function findVoiceMatchedLine(
  spokenText: string,
  scriptLines: string[],
  currentIndex: number,
  threshold = VOICE_MATCH_THRESHOLD
): { index: number; score: number } | null {
  const start = Math.max(0, currentIndex - 1)
  const end = Math.min(scriptLines.length - 1, currentIndex + VOICE_LOOKAHEAD_LINES)
  let best = { index: currentIndex, score: 0 }

  for (let index = start; index <= end; index++) {
    const score = scoreVoiceMatch(spokenText, scriptLines[index])
    const betterScore = score > best.score
    const equallyGoodButCloser = score === best.score && Math.abs(index - currentIndex) < Math.abs(best.index - currentIndex)
    if (betterScore || equallyGoodButCloser) {
      best = { index, score }
    }
  }

  return best.score >= threshold ? best : null
}

function estimateNextWordIndex(spokenText: string, scriptLine: string): number {
  const spokenTokens = new Set(tokenizeForVoiceMatch(spokenText))
  const words = toTeleprompterWords(scriptLine)
  let lastMatchedIndex = -1

  words.forEach((word, index) => {
    const token = tokenizeForVoiceMatch(word)[0]
    if (token && spokenTokens.has(token)) {
      lastMatchedIndex = index
    }
  })

  return Math.min(Math.max(lastMatchedIndex + 1, 0), Math.max(words.length - 1, 0))
}

function findExpectedVoiceProgress(
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

  const trackablePosition =
    trackableIndexes.findIndex(({ index }) => index >= currentWordIndex)
  const currentTrackablePosition = trackablePosition >= 0
    ? trackablePosition
    : trackableIndexes.length - 1

  const start = requireStartMatch ? 0 : Math.max(0, currentTrackablePosition - 2)
  const end = requireStartMatch
    ? Math.min(trackableIndexes.length - 1, VOICE_WORD_LOOKAHEAD)
    : Math.min(trackableIndexes.length - 1, currentTrackablePosition + VOICE_WORD_LOOKAHEAD)
  const matchedIndexes: number[] = []

  for (let position = start; position <= end; position++) {
    const { token: expected, index } = trackableIndexes[position]
    if (!expected) continue
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
  const nextWordIndex = Math.min(maxMatchedIndex + 1, Math.max(words.length - 1, 0))
  const lastTrackableIndex = trackableIndexes[trackableIndexes.length - 1].index
  const complete = maxMatchedIndex >= lastTrackableIndex
  const score = Math.min(1, (meaningfulMatches.length + matchedRun) / Math.max(3, spokenTokens.length))

  return { nextWordIndex, score, complete }
}

export default function FilePreview() {
  const [files, setFiles] = useState<PreviewFile[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(FONT_DEFAULT)
  const [isDragOver, setIsDragOver] = useState(false)
  const [scriptMode, setScriptMode] = useState(false)
  const [scriptPresentationActive, setScriptPresentationActive] = useState(false)
  const [scriptPlaying, setScriptPlaying] = useState(false)
  const [scriptVoiceTracking, setScriptVoiceTracking] = useState(false)
  const [scriptLineIndex, setScriptLineIndex] = useState(0)
  const [scriptWordIndex, setScriptWordIndex] = useState(0)
  const [scriptLineExiting, setScriptLineExiting] = useState(false)
  const [scriptSecondsPerLine, setScriptSecondsPerLine] = useState(SCRIPT_SPEED_DEFAULT)
  const [lastVoiceMatch, setLastVoiceMatch] = useState<{ text: string; score: number } | null>(null)
  const [sessionActive, setSessionActive] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeScriptLineRef = useRef<HTMLButtonElement>(null)
  const dragCounterRef = useRef(0)
  const pendingPdfConversionsRef = useRef<Set<string>>(new Set())
  const scriptModeRef = useRef(scriptMode)
  const scriptVoiceTrackingRef = useRef(scriptVoiceTracking)
  const scriptLineIndexRef = useRef(scriptLineIndex)
  const scriptWordIndexRef = useRef(scriptWordIndex)
  const scriptLinesRef = useRef<string[]>([])
  const voiceFlipTimerRef = useRef<number | null>(null)

  const resizeStateRef = useRef<{
    startX: number
    startY: number
    width: number
    height: number
  } | null>(null)

  const filesRef = useRef(files)
  const activeTabIdRef = useRef(activeTabId)
  useEffect(() => { filesRef.current = files }, [files])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { scriptModeRef.current = scriptMode }, [scriptMode])
  useEffect(() => { scriptVoiceTrackingRef.current = scriptVoiceTracking }, [scriptVoiceTracking])
  useEffect(() => { scriptLineIndexRef.current = scriptLineIndex }, [scriptLineIndex])
  useEffect(() => { scriptWordIndexRef.current = scriptWordIndex }, [scriptWordIndex])

  useEffect(() => {
    void window.api.getConfig().then((config: any) => {
      if (config?.answerFontSize) setFontSize(config.answerFontSize)
    })
  }, [])

  useEffect(() => {
    const cleanup = window.api.onSessionState((state: any) => {
      setSessionActive(Boolean(state?.isActive))
    })
    return cleanup
  }, [])

  const adjustFont = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, prev + delta))
      void window.api.setConfig({ answerFontSize: next })
      return next
    })
  }, [])

  const addFile = useCallback((file: Omit<PreviewFile, 'id'> & { id?: string }) => {
    const id = file.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newFile: PreviewFile = { ...file, id }
    setFiles((prev) => [...prev, newFile])
    setActiveTabId(id)
    return id
  }, [])

  const updateFileContent = useCallback((id: string, content: string) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === id
          ? { ...file, content, isConverting: false, isEmpty: false }
          : file
      )
    )
  }, [])

  const closeTab = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((file) => file.id !== id)
      pendingPdfConversionsRef.current.delete(id)
      setActiveTabId((currentId) => {
        if (currentId !== id) return currentId
        return next.length > 0 ? next[next.length - 1].id : null
      })
      return next
    })
  }, [])

  const handleClose = useCallback(() => {
    window.api.hidePreviewWindow()
  }, [])

  const addEmptyTab = useCallback(() => {
    addFile({
      name: 'New tab',
      kind: 'text',
      content: '',
      isEmpty: true,
    })
  }, [addFile])

  const processFile = useCallback(
    async (file: File, replaceTabId?: string | null): Promise<string | null> => {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''

      if (ext === 'pdf') {
        const tabId =
          replaceTabId ||
          addFile({
            name: file.name,
            kind: 'pdf',
            content: '',
            isConverting: true,
          })
        if (replaceTabId) {
          setFiles((prev) =>
            prev.map((entry) =>
              entry.id === replaceTabId
                ? { ...entry, name: file.name, kind: 'pdf', isEmpty: false, isConverting: true }
                : entry
            )
          )
        }
        try {
          const arrayBuffer = await file.arrayBuffer()
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          )
          const markdown = await window.api.convertPdfToMarkdown(base64, file.name)
          updateFileContent(tabId, markdown)
        } catch (err: any) {
          updateFileContent(tabId, `Error converting PDF: ${err.message}`)
        }
        return tabId
      }

      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
        const url = URL.createObjectURL(file)
        if (replaceTabId) {
          setFiles((prev) =>
            prev.map((entry) =>
              entry.id === replaceTabId
                ? {
                    ...entry,
                    name: file.name,
                    kind: 'image',
                    content: '',
                    imageUrl: url,
                    isEmpty: false,
                    isConverting: false,
                  }
                : entry
            )
          )
          return replaceTabId
        }
        return addFile({
          name: file.name,
          kind: 'image',
          content: '',
          imageUrl: url,
        })
      }

      const text = await file.text()
      if (replaceTabId) {
        setFiles((prev) =>
          prev.map((entry) =>
            entry.id === replaceTabId
              ? { ...entry, name: file.name, kind: 'text', content: text, isEmpty: false }
              : entry
          )
        )
        return replaceTabId
      }
      return addFile({
        name: file.name,
        kind: 'text',
        content: text,
      })
    },
    [addFile, updateFileContent]
  )

  const applyPreviewItems = useCallback((items: PreviewWindowItem[]) => {
    if (!Array.isArray(items) || items.length === 0) return
    setFiles((prev) => mergePreviewFiles(prev, items))
    setActiveTabId(items[items.length - 1].id)
  }, [])

  useEffect(() => {
    void window.api.getPreviewItems().then((items) => {
      applyPreviewItems(items)
    })
    const cleanup = window.api.onPreviewItemsUpdated((items) => {
      applyPreviewItems(items)
    })
    return cleanup
  }, [applyPreviewItems])

  useEffect(() => {
    files.forEach((file) => {
      if (
        file.kind !== 'pdf' ||
        !file.isConverting ||
        !file.pdfBase64 ||
        pendingPdfConversionsRef.current.has(file.id)
      ) {
        return
      }

      pendingPdfConversionsRef.current.add(file.id)
      void window.api
        .convertPdfToMarkdown(file.pdfBase64, file.name)
        .then((markdown) => {
          updateFileContent(file.id, markdown)
        })
        .catch((err: any) => {
          updateFileContent(file.id, `Error converting PDF: ${err.message}`)
        })
        .finally(() => {
          pendingPdfConversionsRef.current.delete(file.id)
        })
    })
  }, [files, updateFileContent])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragOver(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      const supported = droppedFiles.filter((file) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        return ['txt', 'md', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)
      })
      if (supported.length === 0) return

      const currentActiveId = activeTabIdRef.current
      const currentActiveFile = filesRef.current.find((file) => file.id === currentActiveId)
      let replaceId: string | null = currentActiveFile?.isEmpty ? currentActiveId : null

      for (const file of supported) {
        await processFile(file, replaceId)
        replaceId = null
      }
    },
    [processFile]
  )

  const handleResizeStart = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const bounds = await window.api.getPreviewWindowBounds()
      if (!bounds) return

      resizeStateRef.current = {
        startX: event.screenX,
        startY: event.screenY,
        width: bounds.width,
        height: bounds.height,
      }

      const handlePointerMove = (moveEvent: MouseEvent) => {
        const current = resizeStateRef.current
        if (!current) return
        void window.api.setPreviewWindowBounds({
          width: Math.max(500, current.width + (moveEvent.screenX - current.startX)),
          height: Math.max(400, current.height + (moveEvent.screenY - current.startY)),
        })
      }

      const handlePointerUp = () => {
        resizeStateRef.current = null
        window.removeEventListener('mousemove', handlePointerMove)
        window.removeEventListener('mouseup', handlePointerUp)
      }

      window.addEventListener('mousemove', handlePointerMove)
      window.addEventListener('mouseup', handlePointerUp)
    },
    []
  )

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [activeTabId])

  const activeFile = files.find((file) => file.id === activeTabId) || null
  const canUseScriptPlayer =
    activeFile != null &&
    activeFile.kind !== 'image' &&
    !activeFile.isEmpty &&
    !activeFile.isConverting &&
    activeFile.content.trim().length > 0
  const scriptLines = canUseScriptPlayer ? toScriptLines(activeFile.content) : []
  const hasScriptLines = scriptLines.length > 0
  const currentScriptLine = scriptLines[scriptLineIndex] || ''
  const nextScriptLine = scriptLines[scriptLineIndex + 1] || ''
  const currentLineWords = toTeleprompterWords(currentScriptLine)
  const teleprompterActive = scriptMode && hasScriptLines && scriptPresentationActive
  const showDragOverlay = isDragOver && activeFile != null && !activeFile.isEmpty

  useEffect(() => {
    scriptLinesRef.current = scriptLines
  }, [scriptLines])

  useEffect(() => {
    setScriptPlaying(false)
    setScriptLineIndex(0)
    setScriptWordIndex(0)
    setScriptLineExiting(false)
    setLastVoiceMatch(null)
    if (!canUseScriptPlayer) {
      setScriptMode(false)
      setScriptPresentationActive(false)
      setScriptVoiceTracking(false)
    }
  }, [activeTabId, activeFile?.content, canUseScriptPlayer])

  useEffect(() => {
    if (!scriptPlaying || !scriptMode || scriptVoiceTracking || scriptLines.length === 0) return

    const wordCount = Math.max(currentLineWords.length, 1)
    const lineDurationMs = scriptSecondsPerLine * 1000
    const wordDurationMs = Math.max(160, lineDurationMs / wordCount)

    setScriptLineExiting(false)
    setScriptWordIndex(0)

    const wordTimer = window.setInterval(() => {
      setScriptWordIndex((prev) => Math.min(prev + 1, wordCount - 1))
    }, wordDurationMs)

    let flipTimer: number | null = null
    const lineTimer = window.setTimeout(() => {
      window.clearInterval(wordTimer)
      setScriptWordIndex(wordCount - 1)
      setScriptLineExiting(true)

      flipTimer = window.setTimeout(() => {
        setScriptLineExiting(false)
        setScriptWordIndex(0)
        setScriptLineIndex((prev) => {
          if (prev >= scriptLines.length - 1) {
            setScriptPlaying(false)
            return prev
          }
          return prev + 1
        })
      }, 280)
    }, lineDurationMs)

    return () => {
      window.clearInterval(wordTimer)
      window.clearTimeout(lineTimer)
      if (flipTimer != null) window.clearTimeout(flipTimer)
    }
  }, [
    scriptPlaying,
    scriptMode,
    scriptVoiceTracking,
    scriptLines.length,
    scriptLineIndex,
    currentScriptLine,
    currentLineWords.length,
    scriptSecondsPerLine,
  ])

  useEffect(() => {
    if (!scriptMode || !activeScriptLineRef.current) return
    activeScriptLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [scriptMode, scriptLineIndex])

  useEffect(() => {
    if (scriptLineIndex >= scriptLines.length) {
      setScriptLineIndex(Math.max(0, scriptLines.length - 1))
    }
  }, [scriptLineIndex, scriptLines.length])

  const toggleScriptMode = useCallback(() => {
    if (!canUseScriptPlayer || !hasScriptLines) return
    setScriptMode((prev) => {
      const next = !prev
      if (!next) {
        setScriptPlaying(false)
        setScriptPresentationActive(false)
        setScriptVoiceTracking(false)
      }
      return next
    })
  }, [canUseScriptPlayer, hasScriptLines])

  const toggleScriptPlayback = useCallback(() => {
    if (!scriptMode || !hasScriptLines) return
    setScriptPresentationActive(true)
    setScriptVoiceTracking(false)
    setScriptPlaying((prev) => !prev)
  }, [hasScriptLines, scriptMode])

  const toggleScriptVoiceTracking = useCallback(() => {
    if (!canUseScriptPlayer || !hasScriptLines) return
    setScriptMode(true)
    setScriptPresentationActive(true)
    setScriptPlaying(false)
    setLastVoiceMatch(null)
    setScriptVoiceTracking((prev) => {
      const next = !prev
      if (next && !sessionActive) {
        void window.api.startSession().catch((error: any) => {
          setScriptVoiceTracking(false)
          setLastVoiceMatch({
            text: error?.message || 'Could not start mic transcription',
            score: 0,
          })
        })
      }
      return next
    })
  }, [canUseScriptPlayer, hasScriptLines, sessionActive])

  const moveScriptLine = useCallback((delta: number) => {
    if (voiceFlipTimerRef.current != null) {
      window.clearTimeout(voiceFlipTimerRef.current)
      voiceFlipTimerRef.current = null
    }
    setScriptLineIndex((prev) => Math.min(Math.max(prev + delta, 0), Math.max(scriptLines.length - 1, 0)))
    setScriptWordIndex(0)
    setScriptLineExiting(false)
    setLastVoiceMatch(null)
  }, [scriptLines.length])

  const resetScriptPlayer = useCallback(() => {
    if (voiceFlipTimerRef.current != null) {
      window.clearTimeout(voiceFlipTimerRef.current)
      voiceFlipTimerRef.current = null
    }
    setScriptPlaying(false)
    setScriptLineIndex(0)
    setScriptWordIndex(0)
    setScriptLineExiting(false)
    setLastVoiceMatch(null)
  }, [])

  const exitScriptPresentation = useCallback(() => {
    if (voiceFlipTimerRef.current != null) {
      window.clearTimeout(voiceFlipTimerRef.current)
      voiceFlipTimerRef.current = null
    }
    setScriptPresentationActive(false)
    setScriptPlaying(false)
    setScriptVoiceTracking(false)
    setScriptLineExiting(false)
  }, [])

  useEffect(() => {
    const cleanup = window.api.onTranscriptUpdate((entry: TranscriptEntry) => {
      if (!scriptVoiceTrackingRef.current || !scriptModeRef.current) return
      if (entry.speaker !== 'user' && entry.speaker !== 'unknown') return

      const spokenText = entry.text.trim()
      const lines = scriptLinesRef.current
      if (!spokenText || lines.length === 0) return

      const spokenTokens = tokenizeVoiceWords(spokenText)
      if (spokenTokens.length === 0) return

      const currentLineIndex = scriptLineIndexRef.current
      const currentWordIndex = scriptWordIndexRef.current
      const currentProgress = findExpectedVoiceProgress(
        spokenText,
        lines[currentLineIndex] || '',
        currentWordIndex
      )
      const nextProgress = !currentProgress && currentLineIndex < lines.length - 1
        ? findExpectedVoiceProgress(spokenText, lines[currentLineIndex + 1] || '', 0, true)
        : null

      const progress = currentProgress || nextProgress
      if (!progress) return

      const matchedLineIndex = currentProgress ? currentLineIndex : currentLineIndex + 1
      if (!entry.isFinal && spokenTokens.length < VOICE_MIN_INTERIM_TOKENS && !progress.complete) return

      setScriptPlaying(false)
      setScriptPresentationActive(true)
      setScriptWordIndex(progress.nextWordIndex)
      setScriptLineExiting(false)
      setScriptLineIndex(matchedLineIndex)
      setLastVoiceMatch({
        text: spokenText.slice(0, 90),
        score: progress.score,
      })

      if (progress.complete && matchedLineIndex < lines.length - 1) {
        if (voiceFlipTimerRef.current != null) {
          window.clearTimeout(voiceFlipTimerRef.current)
        }
        setScriptWordIndex(Math.max(toTeleprompterWords(lines[matchedLineIndex]).length - 1, 0))
        setScriptLineExiting(true)
        voiceFlipTimerRef.current = window.setTimeout(() => {
          voiceFlipTimerRef.current = null
          setScriptLineExiting(false)
          setScriptLineIndex(matchedLineIndex + 1)
          setScriptWordIndex(0)
        }, 280)
      }
    })

    return cleanup
  }, [])

  if (teleprompterActive) {
    return (
      <div className="drag-handle relative flex h-full w-full items-center justify-center overflow-hidden bg-transparent px-8 py-10 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(8,12,18,0.28),rgba(8,12,18,0)_68%)]" />

        <div className="no-drag absolute right-5 top-5 z-20 flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-black/25 px-2 py-2 opacity-35 shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-opacity hover:opacity-100">
          <button
            onClick={() => moveScriptLine(-1)}
            disabled={scriptLineIndex <= 0}
            className="rounded-xl p-2 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
            title="Previous line"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={toggleScriptPlayback}
            className="rounded-xl bg-cyan-400/15 p-2 text-cyan-200 transition-colors hover:bg-cyan-400/25"
            title={scriptPlaying ? 'Pause' : 'Play'}
          >
            {scriptPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={() => moveScriptLine(1)}
            disabled={scriptLineIndex >= scriptLines.length - 1}
            className="rounded-xl p-2 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
            title="Next line"
          >
            <SkipForward size={16} />
          </button>
          <button
            onClick={toggleScriptVoiceTracking}
            className={`rounded-xl p-2 transition-colors ${
              scriptVoiceTracking
                ? 'bg-cyan-400/15 text-cyan-200'
                : 'text-white/65 hover:bg-white/[0.08] hover:text-white'
            }`}
            title="Track mic"
          >
            <Mic size={16} />
          </button>
          <button
            onClick={exitScriptPresentation}
            className="rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
            title="Return to preview"
          >
            Exit
          </button>
          <button
            onClick={handleClose}
            className="rounded-xl p-2 text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
            title="Close preview"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative z-10 flex w-full max-w-[1120px] flex-col items-center text-center">
          <div className="mb-8 flex items-center gap-3 rounded-full border border-white/[0.06] bg-black/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35 backdrop-blur-xl">
            <span>
              {scriptVoiceTracking
                ? `Tracking mic${lastVoiceMatch ? ` · ${Math.round(lastVoiceMatch.score * 100)}%` : ''}`
                : scriptPlaying
                  ? 'Playing'
                  : 'Paused'}
            </span>
            <span className="h-1 w-1 rounded-full bg-white/20" />
            <span>{scriptLineIndex + 1}/{scriptLines.length}</span>
          </div>

          <div
            key={scriptLineIndex}
            className={`teleprompter-current-line ${scriptLineExiting ? 'teleprompter-flip-up' : 'teleprompter-line-enter'}`}
          >
            {currentLineWords.map((word, index) => (
              <React.Fragment key={`${word}-${index}`}>
                <span
                  className={`transition-colors duration-150 ${
                    index === Math.min(scriptWordIndex, currentLineWords.length - 1)
                      ? 'text-cyan-200 drop-shadow-[0_0_18px_rgba(103,232,249,0.72)]'
                      : index < scriptWordIndex
                        ? 'text-white'
                        : 'text-white/58'
                  }`}
                >
                  {word}
                </span>
                {index < currentLineWords.length - 1 && ' '}
              </React.Fragment>
            ))}
          </div>

          {nextScriptLine && (
            <div className="mt-8 max-w-[920px] [overflow-wrap:anywhere] text-[34px] font-semibold leading-snug text-white/34 drop-shadow-[0_8px_30px_rgba(0,0,0,0.55)]">
              {nextScriptLine}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="h-full w-full bg-transparent p-4 pt-3"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[rgba(10,12,16,0.92)] shadow-[0_16px_64px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        <div className="drag-handle flex items-center justify-between border-b border-white/[0.04] bg-white/[0.02] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileText size={14} className="text-cyan-400/50" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
              Preview
            </span>
          </div>

          <div className="no-drag flex items-center gap-2">
            {canUseScriptPlayer && hasScriptLines && (
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-1.5 py-1">
                <button
                  onClick={toggleScriptMode}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    scriptMode
                      ? 'bg-cyan-500/[0.14] text-cyan-300'
                      : 'text-white/45 hover:bg-white/[0.05] hover:text-white/75'
                  }`}
                  title="Toggle script player"
                >
                  Script
                </button>
                {scriptMode && (
                  <>
                    <button
                      onClick={() => moveScriptLine(-1)}
                      disabled={scriptLineIndex <= 0}
                      className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80 disabled:opacity-25"
                      title="Previous line"
                    >
                      <SkipBack size={13} />
                    </button>
                    <button
                      onClick={toggleScriptPlayback}
                      className="rounded-md bg-cyan-500/[0.12] p-1.5 text-cyan-300 transition-colors hover:bg-cyan-500/[0.18]"
                      title={scriptPlaying ? 'Pause script' : 'Play script'}
                    >
                      {scriptPlaying ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button
                      onClick={() => moveScriptLine(1)}
                      disabled={scriptLineIndex >= scriptLines.length - 1}
                      className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80 disabled:opacity-25"
                      title="Next line"
                    >
                      <SkipForward size={13} />
                    </button>
                    <button
                      onClick={resetScriptPlayer}
                      className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80"
                      title="Reset script"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      onClick={toggleScriptVoiceTracking}
                      className={`rounded-md p-1.5 transition-colors ${
                        scriptVoiceTracking
                          ? 'bg-cyan-500/[0.12] text-cyan-300'
                          : 'text-white/50 hover:text-white/80'
                      }`}
                      title="Track script position from mic transcript"
                    >
                      <Mic size={13} />
                    </button>
                    <select
                      value={scriptSecondsPerLine}
                      onChange={(event) => setScriptSecondsPerLine(Number(event.target.value))}
                      className="rounded-md border border-white/[0.06] bg-black/20 px-1.5 py-1 text-[10px] font-medium text-white/55 outline-none transition-colors hover:text-white/75"
                      title="Seconds per line"
                    >
                      {Array.from({ length: SCRIPT_SPEED_MAX - SCRIPT_SPEED_MIN + 1 }, (_, index) => SCRIPT_SPEED_MIN + index).map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                    <span className="min-w-[52px] text-right text-[10px] font-medium text-white/35">
                      {scriptLineIndex + 1}/{scriptLines.length}
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.04] px-1">
              <button
                onClick={() => adjustFont(-FONT_STEP)}
                disabled={fontSize <= FONT_MIN}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80 disabled:opacity-25"
                title="Decrease font size"
              >
                <Minus size={13} />
              </button>
              <span className="min-w-[28px] text-center text-[10px] font-medium text-white/40">
                {fontSize}
              </span>
              <button
                onClick={() => adjustFont(FONT_STEP)}
                disabled={fontSize >= FONT_MAX}
                className="rounded-md p-1.5 text-white/50 transition-colors hover:text-white/80 disabled:opacity-25"
                title="Increase font size"
              >
                <PlusIcon size={13} />
              </button>
            </div>
            <button
              onClick={handleClose}
              className="rounded-lg p-2 bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {files.length > 0 && (
          <div className="flex items-center gap-0.5 overflow-x-auto border-b border-white/[0.04] bg-white/[0.01] px-3 py-1.5">
            {files.map((file) => (
              <button
                key={file.id}
                onClick={() => setActiveTabId(file.id)}
                className={`no-drag group flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-150 ${
                  activeTabId === file.id
                    ? 'bg-cyan-500/[0.08] text-cyan-400 border border-cyan-500/[0.12]'
                    : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70 border border-transparent'
                }`}
              >
                {file.isConverting ? (
                  <Loader2 size={11} className="animate-spin text-cyan-400/60" />
                ) : file.kind === 'image' ? (
                  <ImageIcon size={11} className="text-cyan-400/60" />
                ) : (
                  <FileText size={11} className="text-cyan-400/60" />
                )}
                <span className="max-w-[140px] truncate">{file.name}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(file.id)
                  }}
                  className="ml-0.5 rounded p-0.5 text-white/20 opacity-0 transition-all hover:bg-white/[0.06] hover:text-white/60 group-hover:opacity-100"
                >
                  <X size={10} />
                </span>
              </button>
            ))}
            <button
              onClick={addEmptyTab}
              className="no-drag flex shrink-0 items-center justify-center rounded-lg p-1.5 text-white/25 transition-all duration-150 hover:bg-white/[0.04] hover:text-white/50"
              title="New tab"
            >
              <PlusIcon size={14} />
            </button>
          </div>
        )}

        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
          {!activeFile || activeFile.isEmpty ? (
            <div className="flex h-full items-center justify-center p-8">
              <div
                className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-all duration-200 ${
                  isDragOver
                    ? 'border-cyan-400/40 bg-cyan-400/[0.04]'
                    : 'border-white/[0.08] bg-white/[0.01]'
                }`}
              >
                <FileText
                  size={40}
                  className={`transition-colors ${isDragOver ? 'text-cyan-400/50' : 'text-white/15'}`}
                />
                <div className="text-center">
                  <p className={`text-[14px] font-medium transition-colors ${isDragOver ? 'text-cyan-400/70' : 'text-white/40'}`}>
                    Drop files here
                  </p>
                  <p className="mt-1.5 text-[12px] text-white/25">
                    .txt, .md, .pdf, or common image files
                  </p>
                </div>
              </div>
            </div>
          ) : activeFile.isConverting ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={28} className="animate-spin text-cyan-400/60" />
                <p className="text-[13px] font-medium text-white/40">Preparing preview...</p>
              </div>
            </div>
          ) : activeFile.kind === 'image' ? (
            <div className="flex h-full flex-col px-6 py-5">
              {activeFile.sourceLabel && (
                <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-white/25">
                  {activeFile.sourceLabel}
                </p>
              )}
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06] bg-black/30 p-4">
                {activeFile.imageUrl ? (
                  <img
                    src={activeFile.imageUrl}
                    alt={activeFile.name}
                    className="max-h-full max-w-full rounded-xl object-contain shadow-[0_16px_48px_rgba(0,0,0,0.35)]"
                  />
                ) : (
                  <p className="text-white/30">Image preview unavailable.</p>
                )}
              </div>
            </div>
          ) : scriptMode && hasScriptLines ? (
            <div className="flex min-h-full flex-col px-6 py-5" style={{ fontSize: `${fontSize}px` }}>
              {activeFile.sourceLabel && (
                <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-white/25">
                  {activeFile.sourceLabel}
                </p>
              )}
              <div className="mb-5 rounded-2xl border border-cyan-400/[0.14] bg-cyan-400/[0.04] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/50">
                  {scriptVoiceTracking
                    ? `Tracking mic${lastVoiceMatch ? ` · ${Math.round(lastVoiceMatch.score * 100)}%` : ''}`
                    : 'Now reading'}
                </p>
                <p className="text-[1.35em] font-semibold leading-relaxed text-white">
                  {currentScriptLine}
                </p>
              </div>
              <div className="space-y-2 pb-8">
                {scriptLines.map((line, index) => (
                  <button
                    key={`${index}-${line.slice(0, 24)}`}
                    ref={index === scriptLineIndex ? activeScriptLineRef : undefined}
                    onClick={() => {
                      setScriptLineIndex(index)
                      setScriptPlaying(false)
                      setLastVoiceMatch(null)
                    }}
                    className={`no-drag block w-full rounded-xl border px-4 py-3 text-left leading-relaxed transition-all ${
                      index === scriptLineIndex
                        ? 'border-cyan-400/[0.24] bg-cyan-400/[0.08] text-white shadow-[0_10px_32px_rgba(34,211,238,0.08)]'
                        : index < scriptLineIndex
                          ? 'border-transparent bg-white/[0.015] text-white/28'
                          : 'border-transparent bg-white/[0.025] text-white/58 hover:bg-white/[0.045] hover:text-white/78'
                    }`}
                  >
                    <span className="mr-3 text-[0.65em] font-semibold uppercase tracking-[0.18em] text-cyan-300/35">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {line}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-6 py-5" style={{ fontSize: `${fontSize}px` }}>
              {activeFile.sourceLabel && (
                <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-white/25">
                  {activeFile.sourceLabel}
                </p>
              )}
              {activeFile.content.trim() ? (
                <RichContent content={activeFile.content} fontSize={fontSize} />
              ) : (
                <p className="text-white/25 leading-relaxed">Empty file</p>
              )}
            </div>
          )}

          {showDragOverlay && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(10,12,16,0.85)] backdrop-blur-sm pointer-events-none">
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-cyan-400/40 bg-cyan-400/[0.04] p-10">
                <FileText size={36} className="text-cyan-400/50" />
                <p className="text-[14px] font-medium text-cyan-400/70">Drop to add files</p>
              </div>
            </div>
          )}
        </div>

        <button
          onMouseDown={handleResizeStart}
          className="no-drag absolute bottom-3 right-3 rounded-lg p-2 bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/60"
          title="Resize"
        >
          <GripVertical size={14} />
        </button>
      </div>
    </div>
  )
}
