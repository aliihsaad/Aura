import { ProfileContext, SessionContext, SessionRecord, TranscriptEntry, AnswerSnapshot, UserContext, MeetingNote, ClassDigest, SessionReport } from '@shared/types'
import type { StudyNotesSnapshot } from '@shared/session-brain-types'
import { ContextManager } from './context-manager'
import { MemoryPipelineService } from './memory/memory-pipeline-service'

interface SaveSessionOptions {
  startedAt: number
  transcript: TranscriptEntry[]
  answers: AnswerSnapshot[]
  meetingNotes: MeetingNote[]
  sessionReport?: SessionReport | null
  studyNotes?: StudyNotesSnapshot | null
  classDigest?: ClassDigest
  screenshots: string[]
  profile: ProfileContext
  context: UserContext
  sessionContext: SessionContext
}

export class SessionPersistenceService {
  constructor(
    private readonly contextManager: ContextManager,
    private readonly memoryPipeline: MemoryPipelineService
  ) {}

  saveSession(options: SaveSessionOptions): SessionRecord {
    const endedAt = Date.now()
    const record: SessionRecord = {
      id: `${options.startedAt}`,
      title: buildSessionTitle(options.sessionContext, options.context, options.startedAt),
      startedAt: options.startedAt,
      endedAt,
      durationSeconds: Math.max(1, Math.round((endedAt - options.startedAt) / 1000)),
      transcript: [...options.transcript],
      answers: [...options.answers],
      meetingNotes: [...options.meetingNotes],
      sessionReport: options.sessionReport ?? undefined,
      studyNotes: options.studyNotes ?? undefined,
      classDigest: options.classDigest,
      sessionIntent: options.sessionContext.sessionIntent,
      companyName: options.context.companyName,
      roleName: options.context.roleName,
      interviewType: options.sessionContext.interviewType,
      subject: options.sessionContext.subject,
      sessionNotes: options.sessionContext.sessionNotes,
      contextFolder: options.sessionContext.contextFolder,
      screenshots: [...options.screenshots],
      profileSnapshot: {
        name: options.profile.name,
        skillsSummary: options.profile.interviewPrep.skillsSummary,
      },
    }

    const folderName = this.contextManager.saveSession(record)

    this.memoryPipeline.registerArtifact({
      type: 'session.record',
      createdAt: endedAt,
      sessionId: record.id,
      sessionFolderName: folderName,
      absolutePath: this.memoryPipeline.getSessionArtifactAbsolutePath(folderName, ['session.json']),
      relativePath: this.memoryPipeline.getSessionArtifactRelativePath(folderName, ['session.json']),
      mimeType: 'application/json',
      metadata: {
        durationSeconds: record.durationSeconds,
      },
    })
    this.memoryPipeline.registerArtifact({
      type: 'session.transcript',
      createdAt: endedAt,
      sessionId: record.id,
      sessionFolderName: folderName,
      absolutePath: this.memoryPipeline.getSessionArtifactAbsolutePath(folderName, ['transcript.md']),
      relativePath: this.memoryPipeline.getSessionArtifactRelativePath(folderName, ['transcript.md']),
      mimeType: 'text/markdown',
      metadata: {
        transcriptCount: record.transcript.length,
      },
    })
    this.memoryPipeline.registerArtifact({
      type: 'session.answers',
      createdAt: endedAt,
      sessionId: record.id,
      sessionFolderName: folderName,
      absolutePath: this.memoryPipeline.getSessionArtifactAbsolutePath(folderName, ['answers.md']),
      relativePath: this.memoryPipeline.getSessionArtifactRelativePath(folderName, ['answers.md']),
      mimeType: 'text/markdown',
      metadata: {
        answerCount: record.answers.length,
      },
    })
    if ((record.meetingNotes || []).length > 0 || hasStudyNotes(record.studyNotes) || record.sessionReport) {
      this.memoryPipeline.registerArtifact({
        type: 'session.notes',
        createdAt: endedAt,
        sessionId: record.id,
        sessionFolderName: folderName,
        absolutePath: this.memoryPipeline.getSessionArtifactAbsolutePath(folderName, ['notes.md']),
        relativePath: this.memoryPipeline.getSessionArtifactRelativePath(folderName, ['notes.md']),
        mimeType: 'text/markdown',
        metadata: {
          noteCount: record.meetingNotes?.length ?? 0,
          studyNoteCount: countStudyNotes(record.studyNotes),
          hasSessionReport: Boolean(record.sessionReport),
        },
      })
    }
    if (record.classDigest) {
      this.memoryPipeline.registerArtifact({
        type: 'session.digest',
        createdAt: endedAt,
        sessionId: record.id,
        sessionFolderName: folderName,
        absolutePath: this.memoryPipeline.getSessionArtifactAbsolutePath(folderName, ['digest.md']),
        relativePath: this.memoryPipeline.getSessionArtifactRelativePath(folderName, ['digest.md']),
        mimeType: 'text/markdown',
        metadata: {
          keyPointCount: record.classDigest.keyPoints.length,
          screenEvidenceCount: record.classDigest.screenEvidence.length,
          actionItemCount: record.classDigest.actionItems.length,
        },
      })
    }

    console.log(`[Session] Saved to filesystem: ${record.title}`)
    return record
  }
}

function hasStudyNotes(snapshot?: StudyNotesSnapshot): boolean {
  if (!snapshot) return false
  return countStudyNotes(snapshot) > 0 || snapshot.resources.length > 0
}

function countStudyNotes(snapshot?: StudyNotesSnapshot): number {
  if (!snapshot) return 0
  return Object.values(snapshot.sections).reduce((sum, bullets) => sum + bullets.length, 0)
}

function buildSessionTitle(sessionContext: SessionContext, context: UserContext, startedAt: number): string {
  const subject = sessionContext.subject?.trim()
  const company = context.companyName?.trim()
  const role = context.roleName?.trim()

  switch (sessionContext.sessionIntent) {
    case 'meeting':
      if (subject && company) return `${subject} - ${company}`
      if (subject) return subject
      if (company) return `Meeting - ${company}`
      return `Meeting ${new Date(startedAt).toLocaleString()}`
    case 'presentation':
      if (subject && company) return `${subject} - ${company}`
      if (subject) return subject
      return `Presentation ${new Date(startedAt).toLocaleString()}`
    case 'class':
      if (subject && company) return `${subject} - ${company}`
      if (subject) return subject
      if (company) return `Class - ${company}`
      return `Class ${new Date(startedAt).toLocaleString()}`
    case 'quick-help':
      if (subject) return subject
      return `Quick Help ${new Date(startedAt).toLocaleString()}`
    default:
      if (company || role) {
        return `${company || 'Interview'}${role ? ` - ${role}` : ''}`
      }
      return `Interview ${new Date(startedAt).toLocaleString()}`
  }
}
