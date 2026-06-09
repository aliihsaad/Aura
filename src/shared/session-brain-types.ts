// ============================================================
// Session-brain types — shared between main process (writer) and
// pipelines (reader). The brain runs cheap LLM loops during a live
// session and persists structured state into sessions/<folder>/brain/.
// ============================================================

export type BrainSummarySection =
  | 'key_points'
  | 'errors'
  | 'action_items'
  | 'decisions'
  | 'code_shown'

export interface SubjectHistoryEntry {
  ts: number
  subject: string
  reason: 'session_setup' | 'subject_drift' | 'manual_override'
}

export interface SubjectState {
  current_subject: string
  confidence: number
  seeded_from: 'session_setup' | 'transcript_inferred'
  since_ts: number
  history: SubjectHistoryEntry[]
}

export interface SummaryBullet {
  ts_label: string // 'HH:MM:SS' wallclock
  text: string
  transcript_lines?: string // 'L18-L31'
  screenshot_uid?: string
}

export interface SummaryDelta {
  subject?: {
    current: string
    confidence: number
    drift_detected: boolean
    drift_reason?: string | null
  }
  add: Partial<Record<BrainSummarySection, SummaryBullet[]>>
  merge?: Array<{
    section: BrainSummarySection
    match_text_substring: string
    replace_with: SummaryBullet
  }>
}

export interface BrainScreenshotEntry {
  uid: string
  ts: number
  subject_at_capture: string
  relevance_score: number
  caption: string
  kept: boolean
  image_path: string | null
  image_deleted_at?: number
  duplicate_of?: string
  image_skipped_reason?: 'low-relevance' | 'duplicate'
}

export interface StudyResourceLink {
  title: string
  url: string
  reason: string
}

export interface StudyNotesSnapshot {
  subject: string
  updatedAt: number
  sections: Record<BrainSummarySection, SummaryBullet[]>
  resources: StudyResourceLink[]
}

export interface BrainConfig {
  brainEnabled: boolean
  brainModel: string
  brainVisionModel: string
  brainSummaryIntervalMs: number
  brainSummaryMinUtterances: number
  brainScreenshotIntervalMs: number
  brainScreenshotMaxKept: number
  brainSummaryMaxTicks: number
  brainScreenshotKeepThreshold: number // 0..1
}
