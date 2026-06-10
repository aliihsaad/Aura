import {
  ArtifactRecord,
  EventRecord,
  MemoryRecord,
  SessionContext,
  TranscriptEntry,
  TranscriptFinalizedEventPayload,
} from '@shared/types'
import { getSessionBehavior, isSelfAuthoredEntry } from '@shared/session-intent-policy'

export class ExtractionService {
  extractFromTranscriptEvent(
    event: EventRecord<TranscriptFinalizedEventPayload>,
    sessionContext?: SessionContext
  ): Omit<MemoryRecord, 'id'>[] {
    const entry = event.payload.entry
    if (!entry.isFinal) return []

    const normalized = normalizeText(entry.text)
    const words = normalized.split(/\s+/).filter(Boolean)
    if (words.length < 8) return []

    const memories: Omit<MemoryRecord, 'id'>[] = []

    const isSelfAuthored = isSelfAuthoredEntry(entry)
    const transcriptTags = getTranscriptNoteTags(sessionContext, isSelfAuthored)

    if (isSelfAuthored) {
      if (looksLikeTask(normalized)) {
        memories.push({
          type: 'task',
          status: 'draft',
          createdAt: event.createdAt,
          sessionId: event.sessionId,
          sessionFolderName: event.sessionFolderName,
          title: 'Potential task mentioned during capture',
          summary: truncateSentence(entry.text, 180),
          content: entry.text,
          confidence: 0.62,
          sourceEventIds: [event.id],
          tags: getTranscriptTaskTags(sessionContext),
          metadata: buildSessionMetadata(sessionContext, entry),
        })
        return memories
      }

      memories.push({
        type: 'note',
        status: 'draft',
        createdAt: event.createdAt,
        sessionId: event.sessionId,
        sessionFolderName: event.sessionFolderName,
        title: getTranscriptNoteTitle(sessionContext, true),
        summary: truncateSentence(entry.text, 180),
        content: entry.text,
        confidence: 0.48,
        sourceEventIds: [event.id],
        tags: transcriptTags,
        metadata: buildSessionMetadata(sessionContext, entry),
      })
      return memories
    }

    if (entry.speaker === 'unknown' && !looksLikeQuestion(normalized)) {
      memories.push({
        type: 'note',
        status: 'draft',
        createdAt: event.createdAt,
        sessionId: event.sessionId,
        sessionFolderName: event.sessionFolderName,
        title: getTranscriptNoteTitle(sessionContext, false),
        summary: truncateSentence(entry.text, 180),
        content: entry.text,
        confidence: 0.35,
        sourceEventIds: [event.id],
        tags: transcriptTags,
        metadata: buildSessionMetadata(sessionContext, entry),
      })
    }

    return memories
  }

  extractFromArtifact(artifact: ArtifactRecord): Omit<MemoryRecord, 'id'>[] {
    if (artifact.type === 'screenshot.image') {
      return [
        {
          type: 'note',
          status: 'draft',
          createdAt: artifact.createdAt,
          sessionId: artifact.sessionId,
          sessionFolderName: artifact.sessionFolderName,
          title: 'Screenshot captured for later review',
          summary: artifact.relativePath || artifact.absolutePath,
          content: artifact.absolutePath,
          confidence: 0.28,
          sourceArtifactIds: [artifact.id],
          sourceEventIds: artifact.sourceEventId ? [artifact.sourceEventId] : undefined,
          tags: ['artifact', 'screenshot', 'draft-note'],
          metadata: {
            relativePath: artifact.relativePath || null,
          },
        },
      ]
    }

    if (artifact.type === 'session.record') {
      return [
        {
          type: 'summary',
          status: 'draft',
          createdAt: artifact.createdAt,
          sessionId: artifact.sessionId,
          sessionFolderName: artifact.sessionFolderName,
          title: 'Session record saved',
          summary: artifact.sessionFolderName
            ? `Saved session record for ${artifact.sessionFolderName}`
            : 'Saved session record',
          content: artifact.absolutePath,
          confidence: 0.52,
          sourceArtifactIds: [artifact.id],
          sourceEventIds: artifact.sourceEventId ? [artifact.sourceEventId] : undefined,
          tags: ['artifact', 'session', 'draft-summary'],
          metadata: artifact.metadata,
        },
      ]
    }

    if (artifact.type === 'session.notes') {
      return [
        {
          type: 'summary',
          status: 'draft',
          createdAt: artifact.createdAt,
          sessionId: artifact.sessionId,
          sessionFolderName: artifact.sessionFolderName,
          title: 'Session notes saved',
          summary: artifact.sessionFolderName
            ? `Saved collected notes for ${artifact.sessionFolderName}`
            : 'Saved collected session notes',
          content: artifact.absolutePath,
          confidence: 0.58,
          sourceArtifactIds: [artifact.id],
          sourceEventIds: artifact.sourceEventId ? [artifact.sourceEventId] : undefined,
          tags: ['artifact', 'session', 'notes', 'draft-summary'],
          metadata: artifact.metadata,
        },
      ]
    }


    return []
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function looksLikeQuestion(text: string): boolean {
  if (text.includes('?')) return true
  return ['what', 'why', 'how', 'when', 'where', 'who', 'can', 'could', 'would', 'should', 'tell me'].some((token) =>
    text.startsWith(token)
  )
}

function looksLikeTask(text: string): boolean {
  return [
    'need to',
    'todo',
    'to do',
    'follow up',
    'remember to',
    'should',
    'must',
    'later i',
    'i need',
    'let me',
  ].some((phrase) => text.includes(phrase))
}

function truncateSentence(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function buildSessionMetadata(sessionContext: SessionContext | undefined, entry: TranscriptEntry): Record<string, string | number | boolean | null> {
  const behavior = getSessionBehavior(sessionContext?.sessionIntent || 'quick-help')
  return {
    speaker: entry.speaker,
    audioSource: entry.audioSource || null,
    sessionIntent: sessionContext?.sessionIntent || null,
    companyName: sessionContext?.companyName || null,
    roleName: sessionContext?.roleName || null,
    subject: sessionContext?.subject || null,
    brainPolicy: behavior.brainPolicy,
  }
}

function getTranscriptNoteTags(_sessionContext: SessionContext | undefined, selfAuthored: boolean): string[] {
  if (selfAuthored) return ['transcript', 'user', 'draft-note']
  return ['transcript', 'external-audio', 'draft-note']
}

function getTranscriptTaskTags(_sessionContext: SessionContext | undefined): string[] {
  return ['transcript', 'user', 'draft-task']
}

function getTranscriptNoteTitle(_sessionContext: SessionContext | undefined, selfAuthored: boolean): string {
  if (selfAuthored) return 'Potential note captured from user transcript'
  return 'Potential note captured from transcript'
}
