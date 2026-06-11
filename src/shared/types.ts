// ============================================================
// Shared types used across main and renderer processes
// ============================================================

import type { LocalAiConfig } from './local-ai-types'
import type { StudyNotesSnapshot } from './session-brain-types'

export interface AppConfig {
  openrouterApiKey: string
  deepgramApiKey: string
  freeLlmApiKey?: string
  freeLlmApiBaseUrl?: string
  activeMode?: AgentMode
  defaultModel: string
  codingModel: string
  imageGenerationModel?: string
  autoModelSelection: boolean
  sttProvider: 'deepgram' | 'whisper'
  overlayOpacity: number
  overlayPosition: { x: number; y: number }
  overlaySize: { width: number; height: number }
  fontSize: number
  theme: 'dark' | 'light'
  shortcuts: KeyboardShortcuts
  sttLanguage: string
  contentProtection: boolean
  autoAnswerEnabled: boolean
  micEnabled: boolean
  agentMode?: AgentMode
  companionVoiceModel?: string
  companionEngine?: CompanionEngine
  companionRealtimeModel?: string
  companionRealtimeVoiceName?: string
  companionRealtimeInputTranscription?: boolean
  companionRealtimeOutputTranscription?: boolean
  liveAgentDisabledTools?: string[]
  modes?: ModeScopedConfig
  // Session brain (background context tracker) — see session-brain-types.ts
  brainEnabled?: boolean
  brainModel?: string
  brainVisionModel?: string
  brainSummaryIntervalMs?: number
  brainSummaryMinUtterances?: number
  brainScreenshotIntervalMs?: number
  brainScreenshotMaxKept?: number
  brainSummaryMaxTicks?: number
  brainScreenshotKeepThreshold?: number
  localAi?: LocalAiConfig
}

export interface ModeScopedConfig {
  companion: {
    personality: PersonalityPreset
    interruptionPolicy: InterruptionPolicy
    heartbeatIntervalMs: number
    heartbeatEnabled: boolean
    proactiveNudges: boolean
    voiceEnabled: boolean
    voiceName: string
    voiceModel: string
    model: string
    engine: CompanionEngine
    realtimeModel: string
    realtimeVoiceName: string
    realtimeInputTranscription: boolean
    realtimeOutputTranscription: boolean
    captionsEnabled: boolean
    disabledTools: string[]
    lastSession?: SessionContext | null
  }
}

export interface KeyboardShortcuts {
  toggleOverlay: string
  startStopSession: string
  captureScreen: string
  regenerateAnswer: string
  hideOverlay: string
}

export type LiveAgentMode = 'off' | 'text' | 'voice'
export type CompanionEngine = 'classic' | 'realtime-beta'
export type CompanionRealtimeStatus = 'off' | 'connecting' | 'live' | 'failed' | 'stopped'

export interface SessionState {
  isActive: boolean
  startTime: number | null
  transcript: TranscriptEntry[]
  currentAnswer: string
  isGenerating: boolean
  micEnabled?: boolean
  answerWindowVisible?: boolean
  liveAgentMode?: LiveAgentMode
  companionEngine?: CompanionEngine
  companionRealtimeStatus?: CompanionRealtimeStatus
}

export interface TranscriptEntry {
  id: string
  text: string
  speaker: 'system' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  // Origin of this entry. 'stt' (default/undefined) = live transcription.
  // 'chat' = typed into the overlay chat input and routed through the agent.
  source?: 'stt' | 'chat'
  audioSource?: TranscriptAudioSource
}

export type SessionIntent = 'quick-help'
export type TranscriptAudioSource = 'system' | 'microphone' | 'chat'

export interface SessionPreset {
  id: string
  name: string
  agentMode: 'companion'
  context: {
    sessionIntent?: SessionIntent
    companyName?: string
    roleName?: string
    subject?: string
    sessionNotes?: string
    contextFolder?: string
  }
  createdAt: number
  lastUsedAt?: number
}

export interface ProfileContext {
  // Universal — loaded every session
  name: string
  languages: string
  occupation: string
  currentFocus: string
  commsStyle: string
  extraInstructions: string
  relationships: string
}

export type AgentEngine =
  | 'default'
  | 'openrouter'
  | 'companion'
  | 'workspace-speech'
  | 'workspace-executor'

// Product-level mode. Companion is the only mode in Aura.
// Persisted under config.agentMode.
export type AgentMode = 'companion'

export interface SessionContext {
  sessionIntent: SessionIntent
  companyName: string
  roleName: string
  subject: string
  sessionNotes: string
  agentEngine?: AgentEngine
  contextFolder?: string
}

// Merged view for backward compat
export interface UserContext {
  extraInstructions: string
  sessionIntent: SessionIntent
  companyName: string
  roleName: string
  name: string
  preferredAnswerStyle: string
  subject: string
  sessionNotes: string
}

export interface LLMRequest {
  question: string
  conversationHistory: TranscriptEntry[]
  answerHistory?: AnswerSnapshot[]
  userContext: UserContext
  fileContext?: string
  recallContext?: string
  answerLanguage?: string
  tools?: ToolDefinition[]
  executeToolCall?: ToolExecutorFn
  toolChoiceMode?: 'auto' | 'required-until-workspace-mutation'
  soulPrompt?: string
  personalityFragment?: string
}

export interface LLMResponse {
  answer: string
  isStreaming: boolean
  done: boolean
}

export interface ModelSelectionInfo {
  modelId: string
  reason: string
}

export interface ScreenCaptureResult {
  imageBase64: string
  timestamp: number
}

export type AuraEventType =
  | 'session.started'
  | 'session.stopped'
  | 'transcript.finalized'
  | 'input.manual-requested'
  | 'capture.screenshot'

export type AuraEventSource =
  | 'system'
  | 'transcription'
  | 'user'
  | 'capture'

export interface SessionLifecycleEventPayload {
  startedAt?: number
  endedAt?: number
  durationSeconds?: number
  sessionIntent?: SessionIntent
  companyName?: string
  roleName?: string
  subject?: string
}

export interface TranscriptFinalizedEventPayload {
  entry: TranscriptEntry
}

export interface ManualRequestEventPayload {
  question: string
  preparedQuestion?: string
}

export interface ScreenshotCapturedEventPayload {
  savedToSession: boolean
  screenshotFilename?: string
  analysisRequested: boolean
}

export type AuraEventPayload =
  | SessionLifecycleEventPayload
  | TranscriptFinalizedEventPayload
  | ManualRequestEventPayload
  | ScreenshotCapturedEventPayload

export interface EventRecord<TPayload = AuraEventPayload> {
  id: string
  type: AuraEventType
  source: AuraEventSource
  createdAt: number
  sessionId?: string
  sessionFolderName?: string
  payload: TPayload
}

export type AuraArtifactType =
  | 'screenshot.image'
  | 'generated.image'
  | 'session.record'
  | 'session.transcript'
  | 'session.answers'
  | 'session.notes'

export interface ArtifactRecord {
  id: string
  type: AuraArtifactType
  createdAt: number
  sessionId?: string
  sessionFolderName?: string
  absolutePath: string
  relativePath?: string
  mimeType?: string
  sourceEventId?: string
  sourceEventType?: AuraEventType
  metadata?: Record<string, string | number | boolean | null>
}

export interface ArtifactListFilters {
  limit?: number
  types?: AuraArtifactType[]
  sessionFolderName?: string
  query?: string
}

export type AuraMemoryType =
  | 'note'
  | 'task'
  | 'summary'
  | 'fact'
  | 'insight'

export type AuraMemoryStatus = 'draft' | 'active' | 'resolved' | 'archived'

export interface MemoryRecord {
  id: string
  type: AuraMemoryType
  status: AuraMemoryStatus
  createdAt: number
  updatedAt?: number
  sessionId?: string
  sessionFolderName?: string
  title: string
  summary: string
  content?: string
  confidence?: number
  sourceEventIds?: string[]
  sourceArtifactIds?: string[]
  tags?: string[]
  metadata?: Record<string, string | number | boolean | null>
}

export interface MemoryListFilters {
  limit?: number
  statuses?: AuraMemoryStatus[]
  types?: AuraMemoryType[]
  query?: string
}

export interface MemoryUpdateInput {
  type?: AuraMemoryType
  title?: string
  summary?: string
  content?: string
  tags?: string[]
}

export type AuraEntityType =
  | 'person'
  | 'project'
  | 'company'
  | 'tool'
  | 'routine'
  | 'topic'

export interface EntityRecord {
  id: string
  type: AuraEntityType
  name: string
  normalizedName: string
  createdAt: number
  updatedAt?: number
  summary?: string
  sourceMemoryIds?: string[]
  sourceArtifactIds?: string[]
  sourceEventIds?: string[]
  sessionFolderNames?: string[]
  aliases?: string[]
  tags?: string[]
  metadata?: Record<string, string | number | boolean | null>
}

export interface EntityListFilters {
  limit?: number
  types?: AuraEntityType[]
  query?: string
}

// ── Relations ──────────────────────────────────────────

export type AuraRelationType =
  | 'mentions'
  | 'derived-from'
  | 'about'
  | 'related-to'

export type RelationEndpointKind = 'memory' | 'entity' | 'artifact'

export interface RelationRecord {
  id: string
  type: AuraRelationType
  sourceKind: RelationEndpointKind
  sourceId: string
  targetKind: RelationEndpointKind
  targetId: string
  createdAt: number
  sessionFolderName?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface RelationListFilters {
  limit?: number
  types?: AuraRelationType[]
  sourceKind?: RelationEndpointKind
  sourceId?: string
  targetKind?: RelationEndpointKind
  targetId?: string
}

// ── Embeddings ───────────────────────────────────────────

export interface EmbeddingRecord {
  id: string
  memoryId: string
  vector: number[]
  modelId: string
  createdAt: number
}

// ── Tool System ──────────────────────────────────────────

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

export interface ToolCallRequest {
  id: string
  function: {
    name: string
    arguments: string
  }
}

export type ToolExecutorFn = (
  toolName: string,
  args: Record<string, any>,
  signal?: AbortSignal
) => Promise<string>

export interface AgentToolInfo {
  name: string
  description: string
  scope: 'core' | 'live-only'
  enabled?: boolean
  locked?: boolean
}

export interface RecallQuery {
  query: string
  limit?: number
  sessionFolderName?: string
}

export type RecallResultKind = 'memory' | 'artifact'

export interface RecallResult {
  id: string
  kind: RecallResultKind
  score: number
  createdAt: number
  title: string
  summary: string
  matchedTerms: string[]
  memory?: MemoryRecord
  artifact?: ArtifactRecord
  linkedArtifacts?: ArtifactRecord[]
}

export interface RuntimeRecallDebugState {
  sessionFolderName?: string
  sessionRecallContext?: string
  lastAnswerQuestion?: string
  lastAnswerRecallContext?: string
  lastScreenshotTrigger?: string
  lastScreenshotRecallContext?: string
  updatedAt?: number
}

export interface AnswerSnapshot {
  question: string
  answer: string
  timestamp: number
  modelId?: string
  routingReason?: string
}

/** Structured extras shipped alongside an answer-window output — web-search
 *  sources rendered as cards, generated images rendered inline. Captured from
 *  the tool calls a single answer made (search_web / generate_image). */
export type AnswerAttachment =
  | { type: 'web-source'; url: string; title: string; domain: string }
  | { type: 'image'; src: string; caption?: string }

export interface AnswerDonePayload {
  text: string
  attachments?: AnswerAttachment[]
  /** Endpoint that actually served the final completion (e.g. LLM-Hub vs
   *  OpenRouter after a fallback) — shown as a badge in the Detail window. */
  servedBy?: { provider: string; model: string }
}

export interface SessionReport {
  title: string
  createdAt: number
  sourceRequest: string
  markdown: string
}

export interface SessionRecord {
  id: string
  title: string
  startedAt: number
  endedAt: number
  durationSeconds: number
  transcript: TranscriptEntry[]
  answers: AnswerSnapshot[]
  sessionReport?: SessionReport
  studyNotes?: StudyNotesSnapshot
  sessionIntent?: SessionIntent
  companyName?: string
  roleName?: string
  subject?: string
  sessionNotes?: string
  contextFolder?: string
  workspacePath?: string
  screenshots?: string[] // filenames relative to screenshots/
  profileSnapshot?: {
    name: string
  }
  folderName?: string // filesystem folder name for this session
}

/** Lightweight session metadata for listing (no transcript/answers loaded) */
export interface SessionSummary {
  id: string
  title: string
  startedAt: number
  endedAt: number
  durationSeconds: number
  sessionIntent?: SessionIntent
  companyName?: string
  roleName?: string
  subject?: string
  contextFolder?: string
  workspacePath?: string
  transcriptCount: number
  answerCount: number
  noteCount?: number
  folderName: string
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export type PreviewWindowItemKind = 'text' | 'image' | 'pdf'

export interface PreviewWindowItem {
  id: string
  title: string
  kind: PreviewWindowItemKind
  content?: string
  imageUrl?: string
  pdfBase64?: string
  mimeType?: string
  sourceLabel?: string
}

// ── Canvas & Widgets ─────────────────────────────────────

export type WidgetType = 'control-bar' | 'panel' | 'bubble' | 'toast'

export type WidgetAnchor =
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'center'
  | 'near-control-bar'
  | 'cursor'

export interface Widget {
  id: string
  type: WidgetType
  anchor: WidgetAnchor
  position: { x: number; y: number }
  size: { width: number; height: number }
  priority: number
  dismissable: boolean
  ttl: number | null
  props: Record<string, unknown>
  createdAt: number
}

export type PanelSubtype = 'answer' | 'preview' | 'context'

export type BubbleUrgency = 'low' | 'medium' | 'high'

// ── Agent Behavior ───────────────────────────────────────

export type PersonalityPreset = 'focused' | 'balanced' | 'curious' | 'auto'

export type InterruptionPolicy = 'silent' | 'ask-first' | 'proactive' | 'auto'

export type AgentPresenceState = 'sleeping' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface HeartbeatState {
  enabled: boolean
  intervalMs: number
  lastTickAt: number | null
  lastLLMCallAt: number | null
  presenceState: AgentPresenceState
  personality: PersonalityPreset
  interruptionPolicy: InterruptionPolicy
}

// IPC Channel names
export const IPC = {
  // Session
  START_SESSION: 'session:start',
  STOP_SESSION: 'session:stop',
  PAUSE_SESSION: 'session:pause',
  RESUME_SESSION: 'session:resume',
  SESSION_STATE: 'session:state',
  GET_SESSION_STATE: 'session:get-state',
  GET_SESSIONS: 'session:get-sessions',
  GET_SESSION_DETAIL: 'session:get-detail',
  DELETE_SESSION: 'session:delete',
  EXPORT_SESSION: 'session:export',
  OPEN_SESSION_FOLDER: 'session:open-folder',
  GET_STUDY_NOTES: 'session:get-study-notes',
  STUDY_NOTES_UPDATE: 'session:study-notes-update',

  // Memory
  GET_RECENT_MEMORIES: 'memory:get-recent',
  UPDATE_MEMORY_STATUS: 'memory:update-status',
  UPDATE_MEMORY: 'memory:update',
  RECALL_SEARCH: 'memory:recall-search',
  GET_RUNTIME_RECALL_DEBUG: 'memory:get-runtime-recall-debug',

  // Entities
  GET_RECENT_ENTITIES: 'entity:get-recent',

  // Relations
  GET_RELATIONS: 'relation:get-recent',
  GET_RELATIONS_FOR_SOURCE: 'relation:get-for-source',
  GET_RELATIONS_FOR_TARGET: 'relation:get-for-target',

  // Artifacts
  GET_RECENT_ARTIFACTS: 'artifact:get-recent',
  GET_ARTIFACTS_BY_IDS: 'artifact:get-by-ids',
  OPEN_ARTIFACT: 'artifact:open',

  // Transcript
  TRANSCRIPT_UPDATE: 'transcript:update',
  TRANSCRIPT_CLEAR: 'transcript:clear',

  // Chat
  CHAT_SEND: 'chat:send',

  // LLM
  LLM_REQUEST: 'llm:request',
  LLM_QUESTION: 'llm:question',
  LLM_MODEL_SELECTION: 'llm:model-selection',
  LLM_RESPONSE_CHUNK: 'llm:response-chunk',
  LLM_RESPONSE_DONE: 'llm:response-done',
  LLM_REGENERATE: 'llm:regenerate',

  // Screen capture
  CAPTURE_SCREEN: 'screen:capture',
  SCREEN_RESULT: 'screen:result',

  // Context
  SET_CONTEXT: 'context:set',
  GET_CONTEXT: 'context:get',
  CONTEXT_DATA: 'context:data',
  GET_PROFILE: 'context:get-profile',
  SET_PROFILE: 'context:set-profile',
  GET_LAST_SESSION_CONTEXT: 'context:get-last-session-context',
  LIST_CONTEXT_FOLDERS: 'context:list-folders',
  LOAD_FILE_CONTEXT: 'context:load-files',
  LIST_WORKSPACE_FOLDERS: 'workspace:list-folders',
  LOAD_WORKSPACE_CONTEXT: 'workspace:load-context',
  OPEN_WORKSPACE_FOLDER: 'workspace:open-folder',
  WORKSPACE_STATE_UPDATE: 'workspace:state-update',
  WORKSPACE_LOG_APPEND: 'workspace:log-append',
  WORKSPACE_APPROVAL_REQUESTED: 'workspace:approval-requested',
  WORKSPACE_APPROVAL_RESOLVED: 'workspace:approval-resolved',
  WORKSPACE_SUBMIT_REQUEST: 'workspace:submit-request',
  WORKSPACE_CANCEL_TASK: 'workspace:cancel-task',
  WORKSPACE_PAUSE_QUEUE: 'workspace:pause-queue',
  WORKSPACE_RESUME_QUEUE: 'workspace:resume-queue',
  WORKSPACE_DECIDE_APPROVAL: 'workspace:decide-approval',
  WORKSPACE_GET_STATE: 'workspace:get-state',
  OPEN_CONTEXT_FOLDER: 'context:open-folder',
  OPEN_APP_DATA_FOLDER: 'app:open-data-folder',

  // Config
  GET_CONFIG: 'config:get',
  SET_CONFIG: 'config:set',
  CONFIG_DATA: 'config:data',
  LOCAL_AI_GET_STATUS: 'local-ai:get-status',
  LOCAL_AI_SET_CONFIG: 'local-ai:set-config',
  LOCAL_AI_TEST_TTS: 'local-ai:test-tts',
  LOCAL_AI_TEST_VISION: 'local-ai:test-vision',
  LOCAL_AI_INSTALL_MODEL: 'local-ai:install-model',
  LOCAL_AI_REMOVE_MODEL: 'local-ai:remove-model',
  LOCAL_AI_INSTALL_PROGRESS: 'local-ai:install-progress',

  // Window
  TOGGLE_OVERLAY: 'window:toggle-overlay',
  SHOW_OVERLAY: 'window:show-overlay',
  HIDE_OVERLAY: 'window:hide-overlay',
  TOGGLE_ANSWER_WINDOW: 'window:toggle-answer-window',
  HIDE_ANSWER_WINDOW: 'window:hide-answer-window',
  GET_ANSWER_WINDOW_BOUNDS: 'window:get-answer-window-bounds',
  SET_ANSWER_WINDOW_BOUNDS: 'window:set-answer-window-bounds',
  RESIZE_OVERLAY: 'window:resize-overlay',
  SET_CONTENT_PROTECTION: 'window:set-content-protection',
  OPEN_SETTINGS: 'window:open-settings',

  // Preview
  TOGGLE_PREVIEW_WINDOW: 'window:toggle-preview-window',
  HIDE_PREVIEW_WINDOW: 'window:hide-preview-window',
  GET_PREVIEW_WINDOW_BOUNDS: 'window:get-preview-window-bounds',
  SET_PREVIEW_WINDOW_BOUNDS: 'window:set-preview-window-bounds',
  GET_PREVIEW_ITEMS: 'preview:get-items',
  PREVIEW_ITEMS_UPDATED: 'preview:items-updated',
  CONVERT_PDF_TO_MARKDOWN: 'preview:convert-pdf',

  // Canvas & Widgets
  CANVAS_WIDGET_STATE: 'canvas:widget-state',
  CANVAS_WIDGET_DISMISS: 'canvas:widget-dismiss',
  CANVAS_SET_INTERACTIVE: 'canvas:set-interactive',
  CANVAS_TOGGLE: 'canvas:toggle',

  // Agent
  GET_AGENT_TOOLS: 'agent:get-tools',
  GET_HEARTBEAT_STATE: 'agent:get-heartbeat-state',
  SET_PERSONALITY: 'agent:set-personality',
  SET_INTERRUPTION_POLICY: 'agent:set-interruption-policy',
  SET_HEARTBEAT_ENABLED: 'agent:set-heartbeat-enabled',
  SET_HEARTBEAT_INTERVAL: 'agent:set-heartbeat-interval',
  AGENT_PRESENCE_STATE: 'agent:presence-state',

  // Audio
  AUDIO_LEVEL: 'audio:level',

  // Shell
  OPEN_EXTERNAL: 'shell:open-external',
  SAVE_IMAGE_ATTACHMENT: 'shell:save-image-attachment',
  SPEAK_ANSWER: 'answer:speak',
  STOP_SPEAKING_ANSWER: 'answer:stop-speaking',

  // Updates
  CHECK_FOR_UPDATES: 'update:check',
  UPDATE_AVAILABLE: 'update:available',
} as const

