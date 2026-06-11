import { app, ipcMain, dialog, safeStorage, clipboard, shell } from 'electron'
import {
  AgentToolInfo,
  ArtifactListFilters,
  IPC,
  PreviewWindowItem,
  UserContext,
  TranscriptEntry,
  LLMRequest,
  SessionRecord,
  AnswerSnapshot,
  SessionContext,
  SessionReport,
  ModelSelectionInfo,
  AnswerAttachment,
  AnswerDonePayload,
  MemoryListFilters,
  MemoryRecord,
  MemoryUpdateInput,
  AuraMemoryStatus,
  RecallQuery,
  RuntimeRecallDebugState,
  ToolDefinition,
} from '@shared/types'
import { STTService } from './services/stt-service'
import { extractKeyterms } from './services/keyword-extractor'
import { LLMService } from './services/llm-service'
import {
  getLatestQuestionCandidate,
} from './services/answer-prep-service'
import type { StudyNotesSnapshot } from '@shared/session-brain-types'
import { AnswerRequestService } from './services/answer-request-service'
import { ScreenCaptureService } from './services/screen-capture'
import { ScreenshotAnalysisService } from './services/screenshot-analysis-service'
import { SessionLifecycleService } from './services/session-lifecycle-service'
import { SessionRuntimeService } from './services/session-runtime-service'
import { SessionRuntimeStore } from './services/session-runtime-store'
import { SessionStateService } from './services/session-state-service'
import { ContextManager } from './services/context-manager'
import { ArtifactStore } from './services/memory/artifact-store'
import { ExtractionService } from './services/memory/extraction-service'
import { EventStore } from './services/memory/event-store'
import { EntityExtractionService } from './services/memory/entity-extraction-service'
import { EntityGraphService } from './services/memory/entity-graph-service'
import { EntityStore } from './services/memory/entity-store'
import { RelationStore } from './services/memory/relation-store'
import { TOOL_DEFINITIONS, LIVE_AGENT_EXTRA_TOOL_DEFINITIONS, createToolExecutor } from './services/agent/tool-definitions'
import { updateProfileForSession } from './services/agent/profile-update-service'
import { updateVoiceForSession } from './services/agent/voice-update-service'
import { readProfileMdRaw, readVoiceMdRaw } from './services/profile-store'
import {
  deleteSessionPreset,
  listSessionPresets,
  saveSessionPreset,
  touchSessionPreset,
} from './services/session-preset-store'
import { telemetry } from './services/telemetry-service'
import { costTracker } from './services/cost-tracker'
import { CompanionTtsEvent, CompanionTtsService } from './services/agent/companion-tts-service'
import { ConversationLogService } from './services/conversation-log-service'
import { EmbeddingStore } from './services/memory/embedding-store'
import { EmbeddingService } from './services/memory/embedding-service'
import { MemoryStore } from './services/memory/memory-store'
import { MemoryPipelineService } from './services/memory/memory-pipeline-service'
import {
  buildScreenshotRecallContext,
} from './services/memory/recall-context'
import { RecallService } from './services/memory/recall-service'
import { AudioCaptureService } from './audio/capture'
import { AGENT_TOOL_CATALOG } from '@shared/agent-tool-catalog'
import { formatCurrentDateTime } from '@shared/prompts'
import { selectModel, AnswerSource } from '@shared/model-selection'
import {
  isExternalAudioEntry,
  shouldAutoOpenAnswerWindowForExternalPrompt,
  shouldTreatExternalTranscriptAsPrompt,
} from '@shared/session-intent-policy'
import { checkForUpdates } from './services/update-checker'
import { SUPPORTED_LANGUAGES } from '@shared/constants'
import { SessionPersistenceService } from './services/session-persistence-service'
import { TerminalService } from './services/terminal-service'
import { WebSearchService } from './services/web-search-service'
import { WebPageReaderService } from './services/web-page-reader-service'
import { ImageGenerationService } from './services/image-generation-service'
import { markdownToPlaintext } from './services/markdown-plaintext'
import { ModeConfigService } from './services/mode-config-service'
import { LocalAiManager } from './services/local-ai/local-ai-manager'
import { resolveDeepgramSpeechInputKey } from './services/local-ai/local-ai-stt-policy'
import { ModelPackStore } from './services/local-ai/model-pack-store'
import { modelPackForProvider } from './services/local-ai/model-pack-downloads'
import { DeepgramTtsProvider } from './services/local-ai/providers/deepgram-tts-provider'
import { SystemTtsProvider } from './services/local-ai/providers/system-tts-provider'
import { TtsChunk, TtsProvider, UnavailableTtsProvider } from './services/local-ai/providers/tts-provider'
import type { VisionCortexResult } from './services/local-ai/providers/vision-provider'
import {
  DEFAULT_LOCAL_AI_CONFIG,
  LocalAiBudget,
  LocalAiConfig,
  LocalAiInstallProgress,
  LocalAiMode,
  SttProviderId,
  TtsProviderId,
  VisionProviderId,
} from '@shared/local-ai-types'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  getOverlayWindow,
  getAnswerWindow,
  getSettingsWindow,
  toggleOverlay,
  showOverlay,
  hideOverlay,
  toggleAnswerWindow,
  hideAnswerWindow,
  showAnswerWindow,
  resizeOverlayWindow,
  getAnswerWindowBounds,
  setAnswerWindowBounds,
  setContentProtection,
  openSettings,
  togglePreviewWindow,
  hidePreviewWindow,
  showPreviewWindow,
  getPreviewWindow,
  getPreviewWindowBounds,
  setPreviewWindowBounds,
  getCanvasWindow,
  setCanvasInteractive,
  setModeWindowVisibilityContract,
} from './windows'
import { WidgetManager } from './services/canvas/widget-manager'
import { HeartbeatService } from './services/agent/heartbeat-service'
import { resolveAutoPolicy } from './services/agent/interruption-policy'
import { configurePipelineFactory, getModeRouter } from './pipelines'
import {
  DEFAULT_BRAIN_CONFIG,
  DEFAULT_CODING_MODEL,
  DEFAULT_FREELLMAPI_BASE_URL,
  DEFAULT_MODEL,
  WIDGET_DEFAULTS,
} from '@shared/constants'
import { SessionBrainService } from './services/agent/session-brain-service'
import { McpClientManager, resolveVaultServerConfigs } from './services/mcp/mcp-client-manager'
import { AuraCollabSession } from './services/mcp/aura-collab-session'
import { buildVaultRecallContext, saveVaultSessionMemory } from './services/mcp/vault-session-memory'
import { AgentEngine, AgentMode, PersonalityPreset, InterruptionPolicy } from '@shared/types'
import { KernelChannels, ModeChannels } from '@shared/ipc-channels'
import ElectronStore from 'electron-store'
const Store = (ElectronStore as any).default || ElectronStore

const configStore = new Store({ name: 'aura-config' })
const modeConfig = new ModeConfigService(configStore)
const sessionStore = new Store({
  name: 'aura-session-history',
  defaults: {
    sessions: [] as SessionRecord[],
  },
})

// ── Vault MCP integration (Phase 2) ──────────────────────────────
// Aura as an MCP client of the two Vault stdio servers. Both connections are
// strictly optional: every consumer checks isConnected() and degrades.

const vaultMcpManager = new McpClientManager(
  resolveVaultServerConfigs({
    memoryCommand: (configStore.get('vaultMemoryMcpCommand', '') as string) || undefined,
    memoryArgs: (configStore.get('vaultMemoryMcpArgs', null) as string[] | null) || undefined,
    collabCommand: (configStore.get('vaultCollabMcpCommand', '') as string) || undefined,
    collabArgs: (configStore.get('vaultCollabMcpArgs', null) as string[] | null) || undefined,
  }),
  {
    vault_memory: configStore.get('vaultMemoryEnabled', true) as boolean,
    vault_collab: configStore.get('vaultCollabEnabled', true) as boolean,
  }
)

const auraCollabSession = new AuraCollabSession({
  manager: vaultMcpManager,
  isEnabled: () => configStore.get('vaultCollabEnabled', true) as boolean,
  getWorkspacePath: () => app.getAppPath(),
})

/** Called from main.ts after window/IPC setup. Never blocks app readiness. */
export async function startVaultMcp(): Promise<void> {
  await vaultMcpManager.connectAll()
  await auraCollabSession.start()
}

/** Called from main.ts on quit — clean collab disconnect, then transports. */
export async function shutdownVaultMcp(): Promise<void> {
  await auraCollabSession.stop()
  await vaultMcpManager.disconnectAll()
}

function getVaultDisabledTools(): string[] {
  const raw = configStore.get('vaultDisabledTools', [] as string[])
  return Array.isArray(raw) ? raw.map(String) : []
}

/** User-configured Vault project for Aura's memories (Settings → Memory &
 * Sync). Empty string means "not configured" — every vault-memory save and
 * recall is skipped, and Aura never creates or derives a project itself. */
function getVaultMemoryProject(): string {
  return String(configStore.get('vaultMemoryProject', '') || '').trim()
}

// Synthetic agent tool: drains Aura's OWN collab attention feed through the
// presence session (which holds the private token) — not a server tool.
const CHECK_ATTENTION_TOOL = 'vault_collab_check_attention'

function getCheckAttentionToolDefinition(): ToolDefinition | null {
  if (!auraCollabSession.getStatus().connected) return null
  return {
    type: 'function',
    function: {
      name: CHECK_ATTENTION_TOOL,
      description:
        "Check Aura's own attention feed on the agent coordination layer: pings, handoff notices, and events addressed to this Aura session. Use when the user asks whether anything needs attention or what the other agents have sent.",
      parameters: { type: 'object', properties: {} },
    },
  }
}

/** Bridged Vault tool definitions minus the ones toggled off in Settings. */
function getEnabledVaultToolDefinitions(): ToolDefinition[] {
  const disabled = new Set(getVaultDisabledTools())
  const checkAttention = getCheckAttentionToolDefinition()
  return [
    ...vaultMcpManager.getBridgedToolDefinitions(),
    ...(checkAttention ? [checkAttention] : []),
  ].filter((def) => !disabled.has(def.function.name))
}

async function callVaultToolGuarded(name: string, args: Record<string, any>): Promise<string> {
  if (getVaultDisabledTools().includes(name)) {
    return `Tool "${name}" is disabled in Settings → Memory & Sync.`
  }
  if (name === CHECK_ATTENTION_TOOL) {
    try {
      const result = await auraCollabSession.drain()
      if (!result.drained) return 'Not registered on the coordination layer right now.'
      if (result.itemCount === 0) return 'Attention feed is clear — nothing new for this session.'
      return [`${result.itemCount} attention item(s):`, ...result.items].join('\n')
    } catch (err) {
      return `Attention check failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  // save/recall write into (and can implicitly create) a Vault project. The
  // agent may target any EXISTING project (e.g. engineering notes vs. its
  // brain); anything unknown falls back to the configured project, so a new
  // project is never created from a model-invented name.
  if (name === 'vault_memory_save_memory' || name === 'vault_memory_recall_context') {
    const configured = getVaultMemoryProject()
    const requested = String((args as Record<string, any>).project ?? '').trim()
    let target = configured
    if (requested && requested.toLowerCase() !== configured.toLowerCase()) {
      const existing = await resolveExistingVaultProject(requested)
      if (existing) {
        target = existing
      } else {
        console.warn(`[VaultMemory] project "${requested}" does not exist — falling back to the configured project.`)
      }
    }
    if (!target) {
      console.warn('[VaultMemory] no project configured, skipping save/recall.')
      return 'No Vault memory project is configured — set one in Settings → Memory & Sync first.'
    }
    args = { ...args, project: target }
  }
  return vaultMcpManager.callBridgedTool(name, args)
}

// Existing-project lookup for bridged save/recall, cached briefly so a save
// burst doesn't hammer vault_list_projects. Names and slugs both resolve to
// the canonical project name (avoids casing/slug drift creating duplicates).
let knownVaultProjects: { byKey: Map<string, string>; fetchedAt: number } | null = null
const VAULT_PROJECTS_CACHE_TTL_MS = 60_000

async function resolveExistingVaultProject(requested: string): Promise<string | null> {
  const now = Date.now()
  if (!knownVaultProjects || now - knownVaultProjects.fetchedAt > VAULT_PROJECTS_CACHE_TTL_MS) {
    try {
      const raw = await vaultMcpManager.callTool('vault_memory', 'vault_list_projects', {})
      const parsed = JSON.parse(raw)
      const pack = parsed?.result ?? parsed
      const byKey = new Map<string, string>()
      for (const project of Array.isArray(pack?.projects) ? pack.projects : []) {
        const name = String(project?.name ?? '').trim()
        const slug = String(project?.slug ?? '').trim()
        if (name) byKey.set(name.toLowerCase(), name)
        if (slug) byKey.set(slug.toLowerCase(), name || slug)
      }
      knownVaultProjects = { byKey, fetchedAt: now }
    } catch (err) {
      console.warn('[VaultMemory] could not list projects to validate target:', err instanceof Error ? err.message : err)
      return null
    }
  }
  return knownVaultProjects.byKey.get(requested.toLowerCase()) ?? null
}

// ── Secure key storage helpers ───────────────────────────────────
// Uses Electron safeStorage (DPAPI on Windows) to encrypt API keys at rest.
// Falls back to plain text if safeStorage is unavailable.

function setSecureKey(key: string, value: string): void {
  if (!value) {
    configStore.delete(key)
    configStore.delete(`${key}_encrypted`)
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    configStore.set(`${key}_encrypted`, encrypted.toString('base64'))
    configStore.delete(key) // remove any old plain-text key
  } else {
    configStore.set(key, value)
  }
}

function getSecureKey(key: string): string {
  // Try encrypted first
  const encrypted = configStore.get(`${key}_encrypted`, '') as string
  if (encrypted) {
    try {
      const buffer = Buffer.from(encrypted, 'base64')
      return safeStorage.decryptString(buffer)
    } catch {
      // Decryption failed — fall through to plain text
    }
  }
  // Fall back to plain text (legacy or no safeStorage)
  return (configStore.get(key, '') as string)
}

const LOCAL_AI_MODES: LocalAiMode[] = ['off', 'auto', 'local-first', 'cloud-first', 'local-only']
const LOCAL_AI_BUDGETS: LocalAiBudget[] = ['low', 'balanced', 'max']
const LOCAL_AI_VISION_PROVIDERS: VisionProviderId[] = ['disabled', 'auto', 'openrouter']
const LOCAL_AI_TTS_PROVIDERS: TtsProviderId[] = ['deepgram', 'system', 'disabled']
const LOCAL_AI_STT_PROVIDERS: SttProviderId[] = ['deepgram', 'whisper-local']

function localAiString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function normalizeLocalAiConfig(input: unknown): LocalAiConfig {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<LocalAiConfig>
    : {}

  return {
    ...DEFAULT_LOCAL_AI_CONFIG,
    mode: localAiString(raw.mode, LOCAL_AI_MODES, DEFAULT_LOCAL_AI_CONFIG.mode),
    budget: localAiString(raw.budget, LOCAL_AI_BUDGETS, DEFAULT_LOCAL_AI_CONFIG.budget),
    visionProvider: localAiString(
      raw.visionProvider,
      LOCAL_AI_VISION_PROVIDERS,
      DEFAULT_LOCAL_AI_CONFIG.visionProvider
    ),
    ttsProvider: localAiString(raw.ttsProvider, LOCAL_AI_TTS_PROVIDERS, DEFAULT_LOCAL_AI_CONFIG.ttsProvider),
    sttProvider: localAiString(raw.sttProvider, LOCAL_AI_STT_PROVIDERS, DEFAULT_LOCAL_AI_CONFIG.sttProvider),
    allowModelDownloads: typeof raw.allowModelDownloads === 'boolean'
      ? raw.allowModelDownloads
      : DEFAULT_LOCAL_AI_CONFIG.allowModelDownloads,
    allowBackgroundWarmup: typeof raw.allowBackgroundWarmup === 'boolean'
      ? raw.allowBackgroundWarmup
      : DEFAULT_LOCAL_AI_CONFIG.allowBackgroundWarmup,
    cloudEscalationEnabled: typeof raw.cloudEscalationEnabled === 'boolean'
      ? raw.cloudEscalationEnabled
      : DEFAULT_LOCAL_AI_CONFIG.cloudEscalationEnabled,
    localOnlyBlocksCloudVision: typeof raw.localOnlyBlocksCloudVision === 'boolean'
      ? raw.localOnlyBlocksCloudVision
      : DEFAULT_LOCAL_AI_CONFIG.localOnlyBlocksCloudVision,
  }
}

function readLocalAiConfig(): LocalAiConfig {
  return normalizeLocalAiConfig(configStore.get('localAi', {}))
}

const contextManager = new ContextManager()
modeConfig.migrateFlatConfigToModes()
modeConfig.migrateLastSessionContextToModes(contextManager)
const artifactStore = new ArtifactStore()
const eventStore = new EventStore()
const extractionService = new ExtractionService()
const entityStore = new EntityStore()
const entityExtractionService = new EntityExtractionService()
const memoryStore = new MemoryStore()
const relationStore = new RelationStore()
const embeddingStore = new EmbeddingStore()
const embeddingService = new EmbeddingService(embeddingStore)
const entityGraphService = new EntityGraphService(entityStore, entityExtractionService, relationStore)
const recallService = new RecallService(memoryStore, artifactStore, embeddingService)
const answerRequestService = new AnswerRequestService(recallService)
const sessionStateService = new SessionStateService()
const memoryPipeline = new MemoryPipelineService(
  eventStore,
  artifactStore,
  memoryStore,
  extractionService,
  () => contextManager.getAppDataPath(),
  (memory) => {
    entityGraphService.syncMemory(memory)
    embeddingService.embed(memory).catch((error) =>
      console.error('[EmbeddingService] Failed to embed new memory:', error)
    )
  }
)
const screenCapture = new ScreenCaptureService()
const screenshotAnalysisService = new ScreenshotAnalysisService(screenCapture, memoryPipeline)
const sessionPersistenceService = new SessionPersistenceService(contextManager, memoryPipeline)
const audioCapture = new AudioCaptureService()
const sessionRuntimeService = new SessionRuntimeService()
const sessionRuntimeStore = new SessionRuntimeStore()
const widgetManager = new WidgetManager()
const sessionLifecycleService = new SessionLifecycleService(contextManager, recallService)
const webSearchService = new WebSearchService()
const webPageReaderService = new WebPageReaderService()
const conversationLog = new ConversationLogService()
let localAiManager: LocalAiManager | null = null

function getLocalAiManager(): LocalAiManager {
  if (!localAiManager) {
    const modelPackStore = new ModelPackStore(path.join(app.getPath('userData'), 'models'))
    localAiManager = new LocalAiManager({
      readConfig: readLocalAiConfig,
      hasDeepgramKey: () => Boolean(deepgramKeyFromConfig()),
      hasOpenRouterKey: () => Boolean(getOpenRouterApiKey()),
      modelPackStore,
    })
  }
  return localAiManager
}

function deepgramSpeechInputKeyForCurrentConfig(): string {
  return resolveDeepgramSpeechInputKey(readLocalAiConfig(), deepgramKeyFromConfig)
}

function createSelectedSttService(
  speaker: 'system' | 'user',
  language: string,
  keyterms: string[] = []
): STTService {
  const config = readLocalAiConfig()
  if (config.sttProvider === 'whisper-local') {
    return getLocalAiManager().createWhisperSttService(speaker, language, keyterms)
  }
  return new STTService(resolveDeepgramSpeechInputKey(config, deepgramKeyFromConfig), speaker, language, keyterms)
}

async function stopCloudSpeechInput(reason: string): Promise<void> {
  audioCapture.stopCapture()
  await sessionRuntimeStore.sttService?.disconnect()
  await sessionRuntimeStore.micSttService?.disconnect()
  sessionRuntimeStore.sttService = null
  sessionRuntimeStore.micSttService = null
  sendToOverlay('stt:reconnecting', false)
  sendToOverlay('stt:reconnect-error', reason)
}

function cloudVisionUnavailableMessage(): string {
  return [
    'Cloud vision upload is disabled, and local vision is not configured.',
    'Allow cloud screenshots or switch the vision provider back to OpenRouter/Auto to inspect the current screen.',
  ].join('\n')
}

let pendingAnswerAttachments: AnswerAttachment[] = []

function resetPendingAnswerAttachments(): void {
  pendingAnswerAttachments = []
}

function addWebSourceAttachments(result: {
  results?: Array<{ title?: string; url?: string }>
} | Array<{ title?: string; url?: string }>): void {
  const results = Array.isArray(result) ? result : result.results ?? []
  for (const item of results) {
    const url = String(item?.url ?? '').trim()
    if (!url) continue
    if (pendingAnswerAttachments.some((attachment) => attachment.type === 'web-source' && attachment.url === url)) continue

    let domain = ''
    try {
      domain = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      domain = ''
    }

    pendingAnswerAttachments.push({
      type: 'web-source',
      url,
      title: String(item?.title || domain || url).slice(0, 200),
      domain,
    })

    if (pendingAnswerAttachments.filter((attachment) => attachment.type === 'web-source').length >= 6) break
  }
}

function addGeneratedImageAttachment(filePath: string, caption?: string, mimeType?: string): void {
  try {
    const buf = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const resolvedMime =
      mimeType ||
      (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg')
    pendingAnswerAttachments.push({
      type: 'image',
      src: `data:${resolvedMime};base64,${buf.toString('base64')}`,
      caption,
    })
  } catch (err) {
    console.error('[AnswerWindow] failed to attach generated image:', err)
  }
}

const heartbeatService: HeartbeatService = new HeartbeatService({
  getLLMService: () => sessionRuntimeStore.llmService,
  eventStore,
  memoryStore,
  widgetManager,
  getSessionContext: () => contextManager.getSessionContext(),
  getVaultRecallContext: () => sessionRuntimeStore.vaultRecallContext,
  getVaultToolGuidance: () => buildVaultToolGuidance(),
  getProfile: () => contextManager.getProfile(),
  getProfileMd: () => readProfileMdRaw(),
  getVoiceMd: () => readVoiceMdRaw(),
  getFileContext: () => sessionRuntimeStore.currentFileContext,
  getConversationLog: () => conversationLog,
  getSessionTranscript: () => sessionRuntimeStore.sessionTranscript,
  getLatestScreenSummary: () => sessionRuntimeStore.latestScreenSummary || undefined,
  getLocalVisionContext: () => getFreshLocalVisionContext(),
  getSessionFolderName: () => sessionRuntimeStore.currentSessionFolderName || undefined,
  getModel: () =>
    modeConfig.getCompanionModeConfig().model ||
    modeConfig.getAnswerModelConfig().defaultModel ||
    process.env.DEFAULT_MODEL ||
    DEFAULT_MODEL,
  getToolDefinitions: () => [
    ...TOOL_DEFINITIONS,
    ...getEnabledLiveAgentExtraToolDefinitions(),
    ...getEnabledVaultToolDefinitions(),
  ],
  getToolExecutor: () => buildSharedToolExecutor(),
  getOverlayWindow,
  getCanvasWindow,
  isAnswerWindowVisible: () => {
    const answerWindow = getAnswerWindow()
    return Boolean(answerWindow && !answerWindow.isDestroyed() && answerWindow.isVisible())
  },
  openDetailWindow: showAgentAnswerWindow,
  shouldPause: isAgentTaskBusy,
  onCompanionTextStart: handleCompanionTextStart,
  onCompanionTextToken: handleCompanionTextToken,
  onCompanionTextEnd: handleCompanionTextEnd,
  recordTelemetry: (type, payload) => telemetry.record(type, payload),
  recordUsage: (model, promptTokens, completionTokens) =>
    costTracker.add(model, promptTokens, completionTokens),
  getCapabilitiesSummary: () => buildCapabilitiesSummary(),
})

/**
 * Snapshot of Aura's currently-active behaviors so the heartbeat
 * agent can answer truthfully when asked "do you take screenshots?",
 * "do you record audio?", etc. Reads live config + runtime store so
 * the answers reflect what's actually happening right now, not a
 * stale baked-in description.
 */
function buildCapabilitiesSummary(): string {
  const lines: string[] = []
  const brainEnabled = Boolean(
    configStore.get('brainEnabled', DEFAULT_BRAIN_CONFIG.brainEnabled)
  )
  if (brainEnabled) {
    const screenshotInterval = Number(
      configStore.get('brainScreenshotIntervalMs', DEFAULT_BRAIN_CONFIG.brainScreenshotIntervalMs)
    )
    const summaryInterval = Number(
      configStore.get('brainSummaryIntervalMs', DEFAULT_BRAIN_CONFIG.brainSummaryIntervalMs)
    )
    lines.push(
      `- **Session brain is ON.** While a session is active, a background screen frame is captured every ~${Math.round(
        screenshotInterval / 1000
      )}s and rated for relevance to the current topic. A rolling text summary is rebuilt every ~${Math.round(
        summaryInterval / 1000
      )}s. Both land in <userData>/sessions/<folder>/brain/. If the user asks "do you take screenshots", the honest answer is YES, on a timer, while brain is on.`
    )
  } else {
    lines.push('- **Session brain is OFF.** No background screen capture this session.')
  }
  lines.push(
    '- **Mic + system audio go to Deepgram for transcription** while the session is active. Audio is streamed, not stored locally.'
  )
  lines.push(
    '- **Memories** persist as JSONL per day at <userData>/memories/YYYY-MM-DD.jsonl. Recent ones are loaded into your heartbeat snapshot ("Recent Memories" block above).'
  )
  lines.push(
    '- **profile.md and voice.md** at <userData>/profile/ are rebuilt at session end by a cheap LLM call — that\'s why each session "knows more" about the user than the previous one.'
  )
  lines.push(
    '- **Per-session telemetry** is written to <userData>/sessions/<folder>/telemetry.jsonl with every heartbeat tick, suppression, and tool call.'
  )
  if (isLiveAgentVoiceEnabled()) {
    lines.push(
      '- **Aura TTS is ON.** Bubble text is also spoken aloud via Deepgram Aura.'
    )
  }
  return lines.join('\n')
}

// Push cost-meter updates to the overlay whenever the token counter changes.
// Subscribed once at module load; the overlay listens on 'cost:update'.
costTracker.subscribe((snapshot) => {
  sendToOverlay('cost:update', snapshot)
})

// Hydrate heartbeat runtime state from stored config
heartbeatService.setEnabled(
  modeConfig.getCompanionModeConfig().heartbeatEnabled
)
heartbeatService.setIntervalMs(
  modeConfig.getCompanionModeConfig().heartbeatIntervalMs
)
heartbeatService.setPersonality(
  modeConfig.getCompanionModeConfig().personality
)
heartbeatService.setInterruptionPolicy(
  modeConfig.getCompanionModeConfig().interruptionPolicy
)
heartbeatService.setProactiveEnabled(
  modeConfig.getCompanionModeConfig().proactiveNudges
)

// Shared OpenRouter API key helper.
function getOpenRouterApiKey(): string {
  return (getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '') as string
}

function getFreeLlmApiKey(): string {
  return (getSecureKey('freeLlmApiKey') || process.env.FREELLMAPI_API_KEY || '') as string
}

function getFreeLlmApiBaseUrl(): string {
  const configured = String(configStore.get('freeLlmApiBaseUrl', '') || '').trim()
  return configured || process.env.FREELLMAPI_BASE_URL || DEFAULT_FREELLMAPI_BASE_URL
}

function buildRealtimeCompanionInstructions(): string {
  const profile = contextManager.getProfile()
  const session = contextManager.getSessionContext()
  const enabledLiveToolNames = new Set(
    getEnabledLiveAgentExtraToolDefinitions().map((tool) => tool.function.name)
  )
  const line = (label: string, value?: string): string => {
    const cleaned = value?.trim()
    return cleaned ? `${label}: ${cleaned}` : ''
  }

  return [
    'You are Aura in Companion Realtime Beta.',
    'Keep replies concise, conversational, and useful in the live moment.',
    'Never narrate planning, hidden reasoning, or status analysis.',
    'Do not output markdown headings like "Acknowledge and Inquire"; emit only the final words meant for the user.',
    'You have the same Aura tools as Classic Companion. Use tools instead of pretending when the user asks you to remember, recall, inspect the screen, open artifacts, search, generate, or delegate harder work.',
    enabledLiveToolNames.has('solve_with_openrouter')
      ? 'For hard coding, debugging, deep reasoning, web/search-heavy work, or long answers, call solve_with_openrouter and keep your spoken reply short.'
      : '',
    'Realtime audio is the spoken output. Keep the output transcription clean because Aura uses it for the bubble and session record; do not narrate tool internals.',
    'Use the available profile and session context without reciting it.',
    line('Current date and time', formatCurrentDateTime()),
    line('User name', profile.name),
    line('Occupation', profile.occupation),
    line('Communication style', profile.commsStyle),
    line('Current focus', profile.currentFocus),
    line('Extra user instructions', profile.extraInstructions),
    line('Session intent', session.sessionIntent),
    line('Session subject', session.subject),
    line('Company', session.companyName),
    line('Role', session.roleName),
    line('Session notes', session.sessionNotes),
    buildVaultToolGuidance(),
    sessionRuntimeStore.vaultRecallContext.trim(),
  ].filter(Boolean).join('\n')
}

// Function declaration so it can be referenced from heartbeatService's
// getToolExecutor callback (which runs at tick-time, after all services
// in this file are initialized).
function buildSharedToolExecutor() {
  return createToolExecutor({
    recallService,
    memoryStore,
    artifactStore,
    widgetManager,
    getSessionContextSummary: buildSessionContextSummary,
    analyzeCurrentScreen: analyzeCurrentScreenOnce,
    copyToClipboard: (text: string) => clipboard.writeText(text),
    openArtifactById: openArtifactById,
    previewArtifactById: previewArtifactById,
    getCurrentTaskSummary: buildCurrentTaskSummary,
    getLatestAnswerSnapshot: getLatestAnswerSnapshot,
    openAnswerWindow: showAgentAnswerWindow,
    solveWithOpenRouter: delegateComplexOpenRouterAnswer,
    searchWeb: (query, limit) => webSearchService.search(query, limit),
    readWebPage: (url) => webPageReaderService.read(url),
    generateImage: (params) => generateImageArtifact(params),
    requestApproval: requestApproval,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
    getInterruptionPolicy: () => heartbeatService.getInterruptionPolicy(),
    getLastEventTimestamp: () => lastSessionActivityAt,
    callVaultTool: callVaultToolGuarded,
  })
}

function voiceOutputEnabled(): boolean {
  return isLiveAgentVoiceEnabled()
}

let companionTtsService: CompanionTtsService | null = null
let activeAnswerTtsProvider: TtsProvider | null = null
let activeCompanionTtsProvider: TtsProvider | null = null
let companionVoiceSpeaking = false
let companionVoicePlaybackActive = false
let companionVoicePlaybackSuppressUntil = 0
let explicitAnswerTtsActive = false
// Set by the overlay's render-reference barge-in detector. When true, the
// raw-RMS mic-bleed gate is overridden so the user's mic reaches STT even
// if the coarse RMS check would have suppressed companion voice playback.
let voiceBargeInOpen = false
let lastSessionActivityAt = 0
let proactiveScreenObserverTimer: NodeJS.Timeout | null = null
let proactiveScreenCaptureInFlight = false
let previewWindowItems: PreviewWindowItem[] = []
let workspaceSpeechBubbleId: string | null = null
let alwaysAllowWorkspaceWritesThisSession = false
const pendingWorkspaceWriteApprovals = new Map<string, (approved: boolean) => void>()
let answerTaskActive = false
let activeAnswerTaskLabel = ''
let lastBusyNoticeAt = 0
let realtimeCompanionBubbleId: string | null = null

const ANSWER_PIPELINE_BLOCKED_TOOLS = new Set([
  'show_bubble',
  'show_panel',
  'show_toast',
  'dismiss_widget',
  'insert_solution_into_editor',
  'run_code_analysis_on_screen',
  'summarize_current_task',
  'preview_recent_artifact',
  'open_answer_window',
  'solve_with_openrouter',
  'save_answer_as_memory',
])

function getAnswerPipelineToolDefinitions(): typeof TOOL_DEFINITIONS {
  return TOOL_DEFINITIONS.filter((tool) => !ANSWER_PIPELINE_BLOCKED_TOOLS.has(tool.function.name))
}

const REALTIME_COMPANION_BLOCKED_TOOLS = new Set([
  'show_bubble',
  'show_panel',
  'show_toast',
  'dismiss_widget',
  'list_workspace_files',
  'search_workspace_code',
  'read_workspace_file',
  'write_workspace_file',
  'create_workspace_directory',
  'run_terminal_command',
  'search_web',
  'read_webpage',
  'generate_image',
  'analyze_workspace_code',
])

function getRealtimeCompanionToolDefinitions(): ToolDefinition[] {
  return [
    ...TOOL_DEFINITIONS,
    ...getEnabledLiveAgentExtraToolDefinitions(),
    ...getEnabledVaultToolDefinitions(),
  ].filter((tool) => !REALTIME_COMPANION_BLOCKED_TOOLS.has(tool.function.name))
}

/** Prompt guidance for the bridged Vault tools — only when actually bridged. */
function buildVaultToolGuidance(): string {
  const names = new Set(getEnabledVaultToolDefinitions().map((tool) => tool.function.name))
  if (names.size === 0) return ''
  const lines = ['## Vault Tools (cross-session ecosystem)']
  if ([...names].some((name) => name.startsWith('vault_memory_'))) {
    lines.push(
      'vault_memory_* tools talk to The Vault — the user\'s durable cross-session memory shared with their other AI agents.',
      'Use vault_memory_recall_context or vault_memory_find_memory when the user asks about past sessions, projects, decisions, or anything from "the vault". Use vault_memory_save_memory when they explicitly want something kept long-term (distinct from save_memory, which is Aura-local). vault_memory_get_project_briefing gives a project status overview.',
      'IMPORTANT: search, recall, and graph tools return item summaries and UIDs (vm_...) — NOT full documents. To read the actual content of a memory, ALWAYS follow up with vault_memory_get_memory_detail using the item UID. Chain it without asking: find → detail → answer.',
      'PROJECTS: never invent or create Vault projects. Saves and recalls go to the user\'s configured project by default; you may pass a different project ONLY if it already exists in The Vault (check vault_memory_list_projects when unsure). Unknown project names are redirected to the configured project.'
    )
  }
  if ([...names].some((name) => name.startsWith('vault_memory_graphify'))) {
    lines.push(
      'vault_memory_graphify_* tools query the knowledge graph built over Vault memory: graphify_query for graph searches, get_node/get_neighbors to walk relations, shortest_path to connect two items, explain_impact for change-impact questions. vault_memory_recall_with_graph_context is recall enriched with graph relations. Graph results carry node/item UIDs — fetch their content with vault_memory_get_memory_detail.'
    )
  }
  if ([...names].some((name) => name.startsWith('vault_collab_'))) {
    lines.push(
      'vault_collab_* tools are a read-only window into the user\'s agent coordination layer. Use vault_collab_list_sessions ("which agents are active?"), vault_collab_list_inbox ("any open handoffs?"), and the discussion/event readers when asked. vault_collab_check_attention reads YOUR own attention feed (pings and notices addressed to Aura). You can only observe — never claim or modify coordination state.'
    )
  }
  return lines.join('\n')
}

function defaultAgentEngine(): AgentEngine {
  return currentAgentMode() === 'companion' ? 'companion' : 'openrouter'
}

function resolveAgentEngine(override?: AgentEngine | string): AgentEngine {
  if (!override || override === 'default') return defaultAgentEngine()
  if (override === 'openrouter' || override === 'companion') {
    return override
  }
  return defaultAgentEngine()
}

function currentAgentEngine(): AgentEngine {
  return resolveAgentEngine(sessionRuntimeStore.currentAgentEngine)
}

function isLiveAgentEnabled(): boolean {
  return currentAgentEngine() === 'companion'
}

function isLiveAgentVoiceEnabled(): boolean {
  return isLiveAgentEnabled() && modeConfig.getCompanionModeConfig().voiceEnabled
}

function liveAgentMode(): 'off' | 'text' | 'voice' {
  if (!isLiveAgentEnabled()) return 'off'
  return isLiveAgentVoiceEnabled() ? 'voice' : 'text'
}

function currentAgentMode(): AgentMode {
  const activeMode = modeConfig.normalizeAgentMode(configStore.get('activeMode'))
  if (activeMode) return activeMode
  return modeConfig.legacyAgentModeFromFlatConfig()
}

// Temporary shim during workspace-mode removal — every `if (isWorkspaceRuntimeMode()) ...`
// branch is now dead code and will be deleted in the next pass.
function isWorkspaceRuntimeMode(): boolean {
  return false
}

function shouldAutoAnswerFromMic(): boolean {
  const sessionIntent = contextManager.getSessionContext().sessionIntent || 'quick-help'
  return sessionIntent === 'quick-help'
}

function applyAgentMode(mode: AgentMode): void {
  const modes = modeConfig.readModeScopedConfig()
  configStore.set('agentMode', mode)
  configStore.set('activeMode', mode)
  // Keep legacy flags in sync so any code paths still reading them work.
  if (mode === 'companion') {
    configStore.set('liveAgentEnabled', true)
    configStore.set('liveAgentVoiceEnabled', modes.companion.voiceEnabled)
  } else {
    configStore.set('liveAgentEnabled', false)
    configStore.set('liveAgentVoiceEnabled', false)
  }
  modeConfig.writeModeScopedConfig(modes)

  const router = getModeRouter()
  if (!sessionRuntimeStore.isSessionActive && !router.hasActivePipeline()) {
    router.setMode(mode)
    broadcastActiveMode(mode)
  } else {
    broadcastActiveMode(router.getMode())
  }
}

function isLiveAgentCaptionsEnabled(): boolean {
  return modeConfig.getCompanionModeConfig().captionsEnabled
}

function liveAgentVoiceName(): string {
  return modeConfig.getCompanionModeConfig().voiceName
}

function liveAgentModel(): string | undefined {
  const m = modeConfig.getCompanionModeConfig().model
  return m && m.trim().length > 0 ? m : undefined
}

function companionVoiceModel(): string {
  const configured = modeConfig.getCompanionModeConfig().voiceModel
  return configured.startsWith('aura-') ? configured : 'aura-2-thalia-en'
}

function getDisabledLiveAgentToolNames(): Set<string> {
  return new Set(modeConfig.getCompanionModeConfig().disabledTools)
}

function getEnabledLiveAgentExtraToolDefinitions(): typeof LIVE_AGENT_EXTRA_TOOL_DEFINITIONS {
  const disabled = getDisabledLiveAgentToolNames()
  return LIVE_AGENT_EXTRA_TOOL_DEFINITIONS.filter((tool) => {
    return !disabled.has(tool.function.name)
  })
}

function shouldRouteChatToToolCapableAnswer(text: string): boolean {
  const normalized = text.toLowerCase()
  return [
    /\b(web|internet|online|browse|browser|search|look up|latest|current|today)\b/,
    /\b(workspace|project folder|project directory|file|files|folder|folders|directory|directories|notes?|plans?)\b/,
    /\b(read|write|edit|create|save|update|apply|implement|modify|fix|refactor|rename)\b.*\b(file|folder|directory|note|plan|workspace|project|repo|codebase|code|app|ui|component|feature|button|game)\b/,
    /\b(terminal|command|shell|powershell|execute|run|npm|pnpm|yarn|git|test|build|install)\b/,
    /\b(image|picture|illustration|visual|visualize|mockup|asset|logo|generate image|draw)\b/,
    /\b(codebase|repo|repository|analy[sz]e|inspect|scan|review|debug|implementation)\b/,
  ].some((pattern) => pattern.test(normalized))
}

function runManualAnswerInBackground(question: string): void {
  void runManualAnswer(question).catch((error) => {
    reportAnswerError(error instanceof Error ? error : new Error(String(error)))
  })
}

function setCompanionVoiceSpeaking(speaking: boolean): void {
  if (companionVoiceSpeaking === speaking) return
  companionVoiceSpeaking = speaking
  if (speaking) {
    heartbeatService.setPresenceState('speaking')
  } else {
    heartbeatService.setPresenceState('idle')
  }
}

function setCompanionVoicePlaybackActive(active: boolean): void {
  companionVoicePlaybackActive = active
  companionVoicePlaybackSuppressUntil = active
    ? Number.POSITIVE_INFINITY
    : Date.now() + VOICE_PLAYBACK_SUPPRESSION_TAIL_MS
}

function shouldSuppressCapturedSystemAudio(): boolean {
  return companionVoicePlaybackActive || Date.now() < companionVoicePlaybackSuppressUntil
}

function pcm16Level(chunk: Buffer): { rms: number; peak: number } {
  const sampleCount = Math.floor(chunk.length / 2)
  if (sampleCount <= 0) return { rms: 0, peak: 0 }

  let sumSquares = 0
  let peak = 0
  for (let i = 0; i < sampleCount; i++) {
    const sample = chunk.readInt16LE(i * 2) / 0x8000
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
    sumSquares += sample * sample
  }

  return {
    rms: Math.sqrt(sumSquares / sampleCount),
    peak,
  }
}

function shouldSuppressMicBleedDuringPlayback(chunk: Buffer): boolean {
  if (!companionVoicePlaybackActive && Date.now() >= companionVoicePlaybackSuppressUntil) {
    return false
  }

  const { rms, peak } = pcm16Level(chunk)
  return rms < MIC_PLAYBACK_BARGE_IN_RMS_THRESHOLD && peak < MIC_PLAYBACK_BARGE_IN_PEAK_THRESHOLD
}

function interruptCompanionVoicePlayback(): void {
  sendToCanvas('voice:interrupt')
  sendToOverlay('voice:interrupt')
  setCompanionVoicePlaybackActive(false)
  setCompanionVoiceSpeaking(false)
}

function emitCompanionVoiceEvent(ev: CompanionTtsEvent): void {
  switch (ev.type) {
    case 'audio-chunk': {
      if (!voiceOutputEnabled() && !explicitAnswerTtsActive) return
      const payload = {
        pcmBase64: ev.pcmBase64,
        mimeType: ev.mimeType,
      }
      sendToCanvas('voice:audio-chunk', payload)
      sendToOverlay('voice:audio-chunk', payload)
      break
    }
    case 'audio-end':
      explicitAnswerTtsActive = false
      sendToCanvas('voice:audio-end')
      sendToOverlay('voice:audio-end')
      sendToAnswer('voice:audio-end')
      break
    case 'error':
      console.error('[CompanionTTS] error:', ev.error)
      break
  }
}

function ensureCompanionTtsService(): CompanionTtsService | null {
  if (!voiceOutputEnabled()) return null
  const apiKey = deepgramKeyFromConfig()
  if (!apiKey) {
    console.warn('[VoiceTTS] Voice output enabled but no Deepgram API key configured.')
    return null
  }
  const options = {
    apiKey,
    model: companionVoiceModel(),
    sampleRate: 24000,
  }
  if (!companionTtsService) {
    companionTtsService = new CompanionTtsService(options)
    companionTtsService.on('event', emitCompanionVoiceEvent)
  } else {
    companionTtsService.setConfig(options)
  }
  return companionTtsService
}

function ensureExplicitTtsService(): CompanionTtsService | null {
  const apiKey = deepgramKeyFromConfig()
  if (!apiKey) return null
  const options = {
    apiKey,
    model: companionVoiceModel(),
    sampleRate: 24000,
  }
  if (!companionTtsService) {
    companionTtsService = new CompanionTtsService(options)
    companionTtsService.on('event', emitCompanionVoiceEvent)
  } else {
    companionTtsService.setConfig(options)
  }
  return companionTtsService
}

function emitAnswerTtsChunk(chunk: TtsChunk): void {
  const payload = {
    pcmBase64: chunk.pcmBase64,
    mimeType: `audio/pcm;encoding=signed-integer;bits=16;rate=${chunk.sampleRate};channels=${chunk.channels}`,
  }
  sendToCanvas('voice:audio-chunk', payload)
  sendToOverlay('voice:audio-chunk', payload)
}

function emitAnswerTtsEnd(): void {
  explicitAnswerTtsActive = false
  sendToCanvas('voice:audio-end')
  sendToOverlay('voice:audio-end')
  sendToAnswer('voice:audio-end')
}

function stopActiveAnswerTtsProviderForReplacement(): void {
  const provider = activeAnswerTtsProvider
  if (!provider) return

  const shouldEmitEnd = explicitAnswerTtsActive && provider.id !== 'deepgram'
  provider.stop()
  activeAnswerTtsProvider = null
  if (shouldEmitEnd) emitAnswerTtsEnd()
}

function finishNonDeepgramAnswerTtsProvider(provider: TtsProvider): void {
  if (provider.id === 'deepgram') return
  if (activeAnswerTtsProvider === provider) activeAnswerTtsProvider = null
  emitAnswerTtsEnd()
}

function getSelectedAnswerTtsProvider(): TtsProvider {
  const config = readLocalAiConfig()
  if (config.ttsProvider === 'disabled') {
    return new UnavailableTtsProvider('disabled', 'Read-aloud is disabled in Local AI settings')
  }
  if (config.mode === 'local-only' && config.ttsProvider === 'deepgram') {
    return new UnavailableTtsProvider('deepgram', 'Local-only mode blocks Deepgram voice output')
  }
  if (config.mode === 'off' && config.ttsProvider !== 'deepgram') {
    return new UnavailableTtsProvider('disabled', 'Local TTS providers are disabled while Local AI mode is off')
  }
  switch (config.ttsProvider) {
    case 'deepgram':
      return new DeepgramTtsProvider({
        getApiKey: deepgramKeyFromConfig,
        getModel: companionVoiceModel,
        getService: ensureExplicitTtsService,
      })
    case 'system':
      return new SystemTtsProvider()
    default:
      return new UnavailableTtsProvider('disabled', 'Selected TTS provider is unavailable')
  }
}

function handleCompanionTextStart(): void {
  if (!isLiveAgentVoiceEnabled()) return
  activeCompanionTtsProvider?.stop()
  activeCompanionTtsProvider = null
}

function handleCompanionTextToken(_fullText: string, delta: string): void {
  if (!isLiveAgentVoiceEnabled()) return
}

function handleCompanionTextEnd(fullText: string): void {
  // Persist the bubble reply as a session answer first — runs regardless of
  // whether TTS is on, so answers.md / session.json stay in sync with the
  // user's actual conversation in either Companion mode.
  persistCompanionBubbleAnswer(fullText)

  if (!isLiveAgentVoiceEnabled()) return
  const clean = markdownToPlaintext(fullText)
  if (!clean) {
    stopCompanionVoiceOutput()
    return
  }
  const provider = getSelectedAnswerTtsProvider()
  activeCompanionTtsProvider = provider
  void provider.isAvailable().then(async (availability) => {
    if (!availability.ok) {
      console.warn('[CompanionTTS] provider unavailable:', availability.reason)
      return
    }
    await provider.speak(clean, emitAnswerTtsChunk)
    if (activeCompanionTtsProvider !== provider) return
    if (provider.id !== 'deepgram') emitAnswerTtsEnd()
  }).catch((error) => {
    if (activeCompanionTtsProvider !== provider) return
    console.warn('[CompanionTTS] provider failed:', error)
    emitAnswerTtsEnd()
  }).finally(() => {
    if (activeCompanionTtsProvider === provider) activeCompanionTtsProvider = null
  })
}

function ensureRealtimeCompanionBubble(initialMessage = ''): string {
  if (realtimeCompanionBubbleId && widgetManager.get(realtimeCompanionBubbleId)) {
    widgetManager.update(realtimeCompanionBubbleId, {
      message: initialMessage,
      streaming: true,
    })
    return realtimeCompanionBubbleId
  }

  const widget = widgetManager.register({
    type: 'bubble',
    props: {
      message: initialMessage,
      urgency: 'low',
      expandable: true,
      streaming: true,
    },
    ttl: null,
  })
  realtimeCompanionBubbleId = widget.id
  return widget.id
}

function handleRealtimeCompanionTextStart(): void {
  ensureRealtimeCompanionBubble('')
}

function handleRealtimeCompanionTextToken(fullText: string, _delta: string): void {
  const text = fullText.trim()
  const id = ensureRealtimeCompanionBubble(text)
  widgetManager.update(id, {
    message: text,
    streaming: true,
  })
}

function handleRealtimeCompanionTextEnd(fullText: string): void {
  const trimmed = fullText.trim()
  const id = realtimeCompanionBubbleId && widgetManager.get(realtimeCompanionBubbleId)
    ? realtimeCompanionBubbleId
    : null

  if (!trimmed) {
    if (id) widgetManager.dismiss(id)
    realtimeCompanionBubbleId = null
    return
  }

  const bubbleId = id ?? ensureRealtimeCompanionBubble(trimmed)
  widgetManager.update(bubbleId, {
    message: trimmed,
    streaming: false,
  })
  persistCompanionBubbleAnswer(trimmed)
}

function persistCompanionBubbleAnswer(fullText: string): void {
  const trimmed = fullText.trim()
  if (!trimmed) return
  if (!sessionRuntimeStore.isSessionActive) return

  // Pair the bubble with whatever the user last said — gives review/digest
  // tooling a usable Q→A pair. Falls back to the bubble text when there's
  // no recent user turn (e.g. proactive nudges that aren't a reply).
  const lastUserEntry = [...sessionRuntimeStore.sessionTranscript]
    .reverse()
    .find((e) => e.speaker === 'user' && e.isFinal)
  const question = lastUserEntry?.text.trim() ?? ''

  const answer: AnswerSnapshot = {
    question,
    answer: trimmed,
    timestamp: Date.now(),
    routingReason: 'companion-bubble',
  }
  sessionRuntimeStore.currentSessionAnswers.push(answer)

  // Feed the shared dialog log so the next tick sees this bubble as a
  // real assistant turn instead of re-deriving from raw transcript.
  conversationLog.append({
    role: 'agent',
    source: 'bubble',
    text: trimmed,
  })
}

function stopCompanionVoiceOutput(): void {
  activeCompanionTtsProvider?.stop()
  activeCompanionTtsProvider = null
  companionTtsService?.stop()
  interruptCompanionVoicePlayback()
}

function buildLiveSystemPrompt(): string {
  const personality = heartbeatService.getResolvedPersonality()
  const enabledLiveToolNames = new Set(
    getEnabledLiveAgentExtraToolDefinitions().map((tool) => tool.function.name)
  )
  const routingLines = [
    'Use a short spoken/bubble reply only for quick observations, reminders, confirmations, or one-line suggestions.',
    'If the user asks for something substantial, keep the spoken reply short and concise rather than trying to fully narrate a long answer.',
    enabledLiveToolNames.has('solve_with_openrouter')
      ? 'If the task feels genuinely hard or benefits from stronger reasoning, use solve_with_openrouter. This is the default for coding problems, debugging, non-trivial math, system design, and deep analysis.'
      : 'For hard tasks, avoid overconfident spoken answers and keep your response brief.',
    enabledLiveToolNames.has('solve_with_openrouter')
      ? 'For requests that need web search, workspace file or folder access, terminal commands, image generation, or workspace/codebase analysis, use solve_with_openrouter. Those tools run in the main answer pipeline with their safety gates.'
      : null,
    enabledLiveToolNames.has('solve_with_openrouter')
      ? 'When you use solve_with_openrouter, do not also produce a long spoken reply. At most, give a tiny lead-in. Shorter is better.'
      : null,
    enabledLiveToolNames.has('insert_solution_into_editor')
      ? 'If the user explicitly wants the solution applied or ready to paste, use insert_solution_into_editor to copy the content to the clipboard.'
      : null,
    enabledLiveToolNames.has('run_code_analysis_on_screen')
      ? 'If the screen shows code or a technical error, prefer run_code_analysis_on_screen before commenting on what is visible.'
      : null,
    enabledLiveToolNames.has('summarize_current_task')
      ? 'Use summarize_current_task when you need a quick grounded reminder of what the user is doing right now.'
      : null,
    enabledLiveToolNames.has('preview_recent_artifact')
      ? 'Use preview_recent_artifact when the user wants a saved screenshot, document, transcript, or image shown inside the app preview window.'
      : null,
    enabledLiveToolNames.has('open_recent_artifact')
      ? 'Use open_recent_artifact when the user wants a past screenshot, transcript, or saved artifact opened.'
      : null,
    enabledLiveToolNames.has('save_answer_as_memory')
      ? 'Use save_answer_as_memory when a finished answer is clearly worth keeping for later recall.'
      : null,
  ].filter(Boolean)
  return [
    heartbeatService.getSoulPrompt(),
    '',
    '## Current Personality',
    personality.systemPromptFragment,
    '',
    '## Your Task',
    'You are a live companion listening to the user\'s conversation in real time.',
    'Only speak when you have something genuinely useful to add — a connection to past context, a reminder, or a short proactive nudge.',
    'Your text is rendered as a floating bubble on screen, so write *to* the user in a calm, natural, human way.',
    'Keep most messages to one short sentence. Two short sentences is the upper bound unless the user explicitly asks for more.',
    'Do not sound like a support bot. No filler, no motivational tone, and no repetitive offers of help.',
    'Do not end with questions like "need help?", "want me to?", or "should I..." unless the user directly asked you for help or a back-and-forth.',
    'Silence is always acceptable. Most turns, say nothing.',
    '',
    '## Routing Rules',
    ...routingLines,
    '',
    'Use get_session_context when you need continuity about what already happened in the session.',
    'If the user asks what you can see, what is on screen, or asks you to inspect current on-screen content, use analyze_current_screen before answering. Never guess about screen contents.',
    'If the user asks for a worked answer, structured explanation, or anything too detailed for a bubble, keep the bubble concise or use solve_with_openrouter when stronger reasoning is needed.',
    'If a task needs deeper reasoning, harder coding help, or a stronger model, use solve_with_openrouter to delegate it to the main OpenRouter answer path.',
    'Use save_memory to capture important facts and recall_memory or search_artifacts to look things up. Do not call widget tools.',
  ].join('\n')
}

function buildSessionContextSummary(): string {
  const sessionCtx = contextManager.getSessionContext()
  const transcriptLines = sessionRuntimeStore.sessionTranscript
    .filter((entry) => entry.isFinal)
    .slice(-10)
    .map((entry) => `[${entry.speaker}] ${entry.text.trim()}`)
    .filter(Boolean)

  const answerLines = sessionRuntimeStore.currentSessionAnswers
    .slice(-3)
    .map((snapshot) => `- Q: ${snapshot.question}\n  A: ${snapshot.answer.slice(0, 220).trim()}`)

  const recentMemories = memoryStore
    .listRecent({ limit: 5, statuses: ['active'] })
    .map((memory) => `- [${memory.type}] ${memory.title}: ${memory.summary}`)

  const sections: string[] = []

  if (sessionCtx) {
    const meta = [
      sessionCtx.sessionIntent && `Intent: ${sessionCtx.sessionIntent}`,
      sessionCtx.companyName && `Company: ${sessionCtx.companyName}`,
      sessionCtx.roleName && `Role: ${sessionCtx.roleName}`,
      sessionCtx.subject && `Subject: ${sessionCtx.subject}`,
      sessionCtx.sessionNotes && `Session Notes: ${sessionCtx.sessionNotes}`,
      sessionCtx.contextFolder && `Context Folder: ${sessionCtx.contextFolder}`,
    ].filter(Boolean)
    if (meta.length > 0) sections.push('## Session\n' + meta.join('\n'))
  }

  if (sessionRuntimeStore.currentSessionRecallContext) {
    sections.push('## Recalled Context\n' + sessionRuntimeStore.currentSessionRecallContext)
  }

  if (transcriptLines.length > 0) {
    sections.push('## Recent Conversation\n' + transcriptLines.join('\n'))
  }

  if (answerLines.length > 0) {
    sections.push('## Recent Answers\n' + answerLines.join('\n'))
  }

  if (recentMemories.length > 0) {
    sections.push('## Recent Memories\n' + recentMemories.join('\n'))
  }

  if (sessionRuntimeStore.latestScreenSummary) {
    const capturedAt = sessionRuntimeStore.latestScreenSummaryCapturedAt
      ? new Date(sessionRuntimeStore.latestScreenSummaryCapturedAt).toISOString()
      : 'unknown'
    sections.push(
      `## Latest Screen Summary\nCaptured: ${capturedAt}\n${sessionRuntimeStore.latestScreenSummary}`
    )
  }

  return sections.join('\n\n').trim()
}

function buildCurrentTaskSummary(): string {
  const sessionCtx = contextManager.getSessionContext()
  const latestExternal = [...sessionRuntimeStore.sessionTranscript]
    .filter((entry) => entry.isFinal && entry.source !== 'chat' && entry.speaker !== 'user')
    .slice(-1)[0]?.text?.trim()
  const latestSelf = [...sessionRuntimeStore.sessionTranscript]
    .filter((entry) => entry.isFinal && (entry.source === 'chat' || entry.speaker === 'user'))
    .slice(-1)[0]?.text?.trim()

  const lines = [
    sessionCtx.sessionIntent && `Intent: ${sessionCtx.sessionIntent}`,
    sessionCtx.companyName && `Company: ${sessionCtx.companyName}`,
    sessionCtx.roleName && `Role: ${sessionCtx.roleName}`,
    sessionCtx.subject && `Subject: ${sessionCtx.subject}`,
    sessionCtx.contextFolder && `Context folder: ${sessionCtx.contextFolder}`,
    latestExternal && `Latest external prompt: ${latestExternal}`,
    latestSelf && `Latest self input: ${latestSelf}`,
    sessionRuntimeStore.latestScreenSummary && `Latest screen summary: ${sessionRuntimeStore.latestScreenSummary}`,
  ].filter(Boolean)

  return lines.join('\n')
}

function getLatestAnswerSnapshot(): { question: string; answer: string } | null {
  const latest = sessionRuntimeStore.currentSessionAnswers.slice(-1)[0]
  if (!latest || !latest.answer.trim()) return null
  return {
    question: latest.question,
    answer: latest.answer,
  }
}

function getAvailableAgentTools(): AgentToolInfo[] {
  const disabled = getDisabledLiveAgentToolNames()
  return AGENT_TOOL_CATALOG.map((tool) => ({
    ...tool,
    enabled: tool.scope === 'live-only' ? !disabled.has(tool.name) : true,
  }))
}

async function requestTerminalCommandApproval(request: {
  command: string
  cwd: string
  timeoutMs: number
}): Promise<boolean> {
  const detail = [
    'The agent wants to run a terminal command in your workspace.',
    '',
    `Working directory: ${request.cwd}`,
    `Timeout: ${request.timeoutMs} ms`,
    '',
    'Command:',
    request.command.length > 1200 ? `${request.command.slice(0, 1200)}\n…` : request.command,
  ].join('\n')

  const owner =
    [getSettingsWindow(), getAnswerWindow(), getOverlayWindow()].find(
      (win) => win && !win.isDestroyed()
    ) || undefined

  const result = owner
    ? await dialog.showMessageBox(owner, {
        type: 'question',
        buttons: ['Run Command', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Approve Terminal Command',
        message: 'Allow terminal command execution?',
        detail,
      })
    : await dialog.showMessageBox({
        type: 'question',
        buttons: ['Run Command', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Approve Terminal Command',
        message: 'Allow terminal command execution?',
        detail,
      })

  return result.response === 0
}

async function requestApproval(_input: {
  toolName: string
  summary: string
  payload: Record<string, any>
  preview?: string
  bytes?: number
}): Promise<'approve' | 'decline' | 'always-allow-session'> {
  // No interactive tool-approval gates exist after Workspace mode was removed
  // — tool calls in Session/Companion never need user confirmation. Decline
  // any future gated request as a safe default.
  return 'decline'
}

function isAgentTaskBusy(): boolean {
  return answerTaskActive || pendingWorkspaceWriteApprovals.size > 0
}

function beginAgentTask(label: string): boolean {
  if (isAgentTaskBusy()) return false
  answerTaskActive = true
  activeAnswerTaskLabel = label
  heartbeatService.setPresenceState('thinking')
  return true
}

function endAgentTask(): void {
  answerTaskActive = false
  activeAnswerTaskLabel = ''
  if (sessionRuntimeStore.isSessionActive && !sessionRuntimeStore.isSessionPaused) {
    heartbeatService.setPresenceState('listening')
  }
}

function notifyAgentBusy(reason = 'I am still working on the current request. Please wait a moment.'): void {
  const now = Date.now()
  if (now - lastBusyNoticeAt < 3500) return
  lastBusyNoticeAt = now
  widgetManager.register({
    type: 'bubble',
    props: {
      message: activeAnswerTaskLabel
        ? `${reason} Current task: ${activeAnswerTaskLabel}`
        : reason,
      urgency: 'low',
      expandable: false,
    },
    ttl: 4500,
  })
}

async function generateImageArtifact(params: {
  prompt: string
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
  quality?: 'auto' | 'low' | 'medium' | 'high'
  background?: 'auto' | 'transparent' | 'opaque'
}, options: { preview?: boolean } = {}): Promise<{ artifactId: string; absolutePath: string; relativePath: string; mimeType: string; revisedPrompt?: string }> {
  const apiKey = (getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '') as string
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured.')
  }

  const imageModel = (configStore.get(
    'imageGenerationModel',
    ImageGenerationService.DEFAULT_MODEL
  ) || ImageGenerationService.DEFAULT_MODEL) as string
  const imageService = new ImageGenerationService(apiKey, imageModel)
  const generated = await imageService.generate(params)
  const timestamp = Date.now()
  const fileStamp = new Date(timestamp).toISOString().replace(/[:.]/g, '-')
  const extension = extensionForImageMimeType(generated.mimeType)
  const filename = `generated-${fileStamp}.${extension}`
  const sessionFolderName = sessionRuntimeStore.currentSessionFolderName || undefined
  const sessionId = getCurrentSessionId()

  const absolutePath = sessionFolderName
    ? memoryPipeline.getSessionArtifactAbsolutePath(sessionFolderName, ['generated-images', filename])
    : path.join(contextManager.getAppDataPath(), 'generated-images', filename)
  const relativePath = sessionFolderName
    ? memoryPipeline.getSessionArtifactRelativePath(sessionFolderName, ['generated-images', filename])
    : ['generated-images', filename].join('/')

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, Buffer.from(generated.base64, 'base64'))

  const artifact = memoryPipeline.registerArtifact({
    type: 'generated.image',
    createdAt: timestamp,
    sessionId,
    sessionFolderName,
    absolutePath,
    relativePath,
    mimeType: generated.mimeType,
    metadata: {
      prompt: params.prompt,
      revisedPrompt: generated.revisedPrompt || null,
      size: generated.size || params.size || '1024x1024',
      quality: generated.quality || params.quality || 'auto',
      background: params.background || 'auto',
      model: generated.model,
      aspectRatio: generated.aspectRatio || null,
    },
  })

  if (!artifact) {
    throw new Error('Generated image was created on disk but failed to register as an artifact.')
  }

  if (options.preview !== false) {
    await previewArtifactById(artifact.id)
  }
  return {
    artifactId: artifact.id,
    absolutePath: artifact.absolutePath,
    relativePath: artifact.relativePath || artifact.absolutePath,
    mimeType: generated.mimeType,
    revisedPrompt: generated.revisedPrompt,
  }
}

function extensionForImageMimeType(mimeType: string): 'png' | 'jpg' | 'webp' {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

// Tuning constants
const UTTERANCE_DEBOUNCE_MS = 2500       // Wait after last utterance-end before triggering
const ANSWER_COOLDOWN_MS = 4000          // Min gap between auto-answers
const MAX_TRANSCRIPT_ENTRIES = 5000     // Cap to prevent unbounded memory growth
const VOICE_PLAYBACK_SUPPRESSION_TAIL_MS = 400
const MIC_PLAYBACK_BARGE_IN_RMS_THRESHOLD = 0.03
const MIC_PLAYBACK_BARGE_IN_PEAK_THRESHOLD = 0.12
const PROACTIVE_SCREEN_CAPTURE_INTERVAL_MS = 45000
const RECALL_QUERY_NOISE_TOKENS = new Set([
  'about',
  'answer',
  'company',
  'general',
  'help',
  'session',
  'later',
  'need',
  'notes',
  'question',
  'remember',
  'role',
  'session',
  'should',
  'something',
  'technical',
  'using',
  'with',
  'work',
])

function sendToOverlay(channel: string, ...args: any[]): void {
  const overlay = getOverlayWindow()
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send(channel, ...args)
  }
}

function sendToSettings(channel: string, ...args: any[]): void {
  const settings = getSettingsWindow()
  if (settings && !settings.isDestroyed()) {
    settings.webContents.send(channel, ...args)
  }
}

function sendToAnswer(channel: string, ...args: any[]): void {
  const answer = getAnswerWindow()
  if (answer && !answer.isDestroyed()) {
    answer.webContents.send(channel, ...args)
  }
}

function sendToPreview(channel: string, ...args: any[]): void {
  const preview = getPreviewWindow()
  if (preview && !preview.isDestroyed()) {
    preview.webContents.send(channel, ...args)
  }
}

function sendToCanvas(channel: string, ...args: any[]): void {
  const canvas = getCanvasWindow()
  if (canvas && !canvas.isDestroyed()) {
    canvas.webContents.send(channel, ...args)
  }
}

function sendToAllWindows(channel: string, ...args: any[]): void {
  sendToOverlay(channel, ...args)
  sendToSettings(channel, ...args)
  sendToAnswer(channel, ...args)
  sendToPreview(channel, ...args)
  sendToCanvas(channel, ...args)
}

function isCompanionMode(mode: AgentMode): boolean {
  return mode === 'companion'
}

function syncModeWindowContracts(mode: AgentMode): void {
  // Canvas is the bubble surface — Companion mode needs it whenever captions
  // are on, otherwise the heartbeat registers bubbles into a hidden window
  // and the user only hears the voice.
  const canvasNeededForCompanion = isCompanionMode(mode) && isLiveAgentCaptionsEnabled()
  setModeWindowVisibilityContract({
    answerWindowAllowed: !isCompanionMode(mode),
    canvasWindowAllowed: canvasNeededForCompanion,
  })
}

function broadcastActiveMode(mode: AgentMode): void {
  syncModeWindowContracts(mode)
  sendToAllWindows(KernelChannels.modeActive, mode)
}

function sendSessionQuestion(question: string): void {
  sendToOverlay(IPC.LLM_QUESTION, question)
  sendToAnswer(IPC.LLM_QUESTION, question)
  sendToCanvas(IPC.LLM_QUESTION, question)
  sendToAnswer(ModeChannels.answer.question, question)
}

function sendSessionModelSelection(selection: ModelSelectionInfo): void {
  sendToOverlay(IPC.LLM_MODEL_SELECTION, selection)
  sendToAnswer(IPC.LLM_MODEL_SELECTION, selection)
  sendToCanvas(IPC.LLM_MODEL_SELECTION, selection)
  sendToAnswer(ModeChannels.answer.modelSelection, selection)
}

function sendSessionAnswerChunk(value: string): void {
  sendToOverlay(IPC.LLM_RESPONSE_CHUNK, value)
  sendToAnswer(IPC.LLM_RESPONSE_CHUNK, value)
  sendToCanvas(IPC.LLM_RESPONSE_CHUNK, value)
  sendToAnswer(ModeChannels.answer.answerToken, value)
}

function sendSessionAnswerDone(value: string | AnswerDonePayload): void {
  sendToOverlay(IPC.LLM_RESPONSE_DONE, value)
  sendToAnswer(IPC.LLM_RESPONSE_DONE, value)
  sendToCanvas(IPC.LLM_RESPONSE_DONE, value)
  sendToAnswer(ModeChannels.answer.answerEnd, value)
}

export function setupIpcHandlers(): void {
  // Wire WidgetManager to the canvas window (created by main.ts before this runs)
  widgetManager.setCanvasWindow(getCanvasWindow())

  // Initialize folder structure and migrate data on startup
  contextManager.initFolders()
  artifactStore.init()
  eventStore.init()
  memoryStore.init()
  entityStore.init()
  relationStore.init()
  embeddingStore.init()
  embeddingService.init().then(() => {
    const activeMemories = memoryStore.listRecent({ limit: 500, statuses: ['active'] })
    embeddingService.backfill(activeMemories).catch((error) =>
      console.error('[EmbeddingService] Backfill failed:', error)
    )
  }).catch((error) => console.error('[EmbeddingService] Init failed:', error))
  contextManager.migrateSessionsFromStore(sessionStore)
  entityGraphService.backfillMemories(memoryStore.listRecent({ limit: 500 }))

  // ── Mode-isolation pipelines (phases 1 + 2) ────────────────────
  // Register pipeline builders. The router invokes the matching
  // closure on each session start so it captures fresh per-session
  // inputs (deepgram key, language, mic toggle, …) at that moment.
  // Companion voice is a config flag inside the single companion builder;
  // the audio-chunk + transcript callbacks are identical to session,
  // so we share a helper.
  const buildSttRuntimeCallbacks = () => ({
    onTranscript: handleTranscriptEntry,
    onAudioChunk: (source: 'system' | 'user', chunk: Buffer) => {
      const suppressSystemAudioCapture =
        source === 'system' && shouldSuppressCapturedSystemAudio()
      const suppressMicBleed =
        source === 'user' && !voiceBargeInOpen && shouldSuppressMicBleedDuringPlayback(chunk)
      if (suppressSystemAudioCapture || suppressMicBleed) return

      if (source === 'system') {
        sessionRuntimeStore.sttService?.sendAudio(chunk)
        return
      }
      sessionRuntimeStore.micSttService?.sendAudio(chunk)
    },
    onAnswerChunk: streamAnswerChunk,
    onAnswerDone: (answer: string) => {
      completeAnswerStream(answer, sessionRuntimeStore.lastRequestedQuestion)
    },
    onAnswerError: reportAnswerError,
  })

  const readPerSessionInputs = () => ({
    createSttService: createSelectedSttService,
    openrouterApiKey: getOpenRouterApiKey(),
    defaultModel: modeConfig.getAnswerModelConfig().defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL,
    sttLanguage: configStore.get('sttLanguage', 'en') as string,
    micEnabled: getMicEnabled(),
    utteranceDebounceMs: UTTERANCE_DEBOUNCE_MS,
    shouldAutoTriggerFromMic: shouldAutoAnswerFromMic(),
    keyterms: sessionRuntimeStore.currentSttKeyterms ?? [],
  })

  configurePipelineFactory({
    companion: () => ({
      ...readPerSessionInputs(),
      voiceEnabled: modeConfig.getCompanionModeConfig().voiceEnabled,
      sessionRuntimeStore,
      sessionRuntimeService,
      audioCapture,
      // Companion mode drives replies via the heartbeat tick in
      // ipc-handlers (handleTranscriptEntry → scheduleHeartbeatTrigger).
      // The auto-answer pipeline is session-only, so this hook is a
      // no-op in companion.
      onAutoAnswerTrigger: () => {},
      stopVoiceOutput: () => {
        stopCompanionVoiceOutput()
      },
      ...buildSttRuntimeCallbacks(),
    }),
    companionEngine: () => modeConfig.getCompanionModeConfig().engine,
    companionRealtime: () => ({
      clientOptions: () => {
        const companion = modeConfig.getCompanionModeConfig()
        return {
          baseUrl: getFreeLlmApiBaseUrl(),
          apiKey: getFreeLlmApiKey(),
          model: companion.realtimeModel || 'auto',
          voice: companion.realtimeVoiceName || 'alloy',
          responseModalities: ['AUDIO'],
          instructions: buildRealtimeCompanionInstructions(),
          inputAudioTranscription: true,
          outputAudioTranscription: true,
          tools: getRealtimeCompanionToolDefinitions(),
          // On reconnect after a live WS drop (FreeLLMAPI model rotation),
          // re-seed the fresh model with the session-brain summary.
          getReconnectContext: () => sessionRuntimeStore.sessionBrain?.getSummary() ?? '',
        }
      },
      openrouterApiKey: getOpenRouterApiKey(),
      defaultModel: modeConfig.getAnswerModelConfig().defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL,
      audioCapture,
      sessionRuntimeStore,
      onTranscript: handleTranscriptEntry,
      emitVoiceAudioChunk: (payload) => {
        sendToCanvas('voice:audio-chunk', payload)
        sendToOverlay('voice:audio-chunk', payload)
      },
      emitVoiceAudioEnd: () => {
        sendToCanvas('voice:audio-end')
        sendToOverlay('voice:audio-end')
        sendToAnswer('voice:audio-end')
      },
      setPresenceState: (state) => heartbeatService.setPresenceState(state),
      onRealtimeStatus: () => broadcastSessionState(),
      onRealtimeError: (error) => console.warn('[CompanionRealtime] error:', error),
      executeToolCall: buildSharedToolExecutor,
      onAnswerChunk: streamAnswerChunk,
      onAnswerDone: (answer: string) => {
        completeAnswerStream(answer, sessionRuntimeStore.lastRequestedQuestion)
      },
      onAnswerError: reportAnswerError,
      playRealtimeAudio: true,
      onCompanionTextStart: handleRealtimeCompanionTextStart,
      onCompanionTextToken: handleRealtimeCompanionTextToken,
      onCompanionTextEnd: handleRealtimeCompanionTextEnd,
    }),
  })

  const router = getModeRouter()
  router.setModeActiveBroadcast(broadcastActiveMode)
  if (!router.hasActivePipeline()) {
    router.setMode(currentAgentMode())
  }
  broadcastActiveMode(currentAgentMode())

  function canStartCurrentSessionWithConfiguredProviders(): { ok: true } | { ok: false; reason: string } {
    const mode = currentAgentMode()
    const modes = modeConfig.readModeScopedConfig()
    const openrouterKey = getOpenRouterApiKey()

    if (mode !== 'companion') {
      return openrouterKey
        ? { ok: true }
        : { ok: false, reason: 'OpenRouter API key not configured' }
    }

    if (modes.companion.engine === 'realtime-beta') {
      if (getFreeLlmApiKey()) return { ok: true }
      return { ok: false, reason: 'FreeLLMAPI API key not configured for Realtime Beta' }
    }

    return openrouterKey
      ? { ok: true }
      : { ok: false, reason: 'OpenRouter API key not configured' }
  }

  // ── Session Control ──────────────────────────────────────────
  ipcMain.handle(IPC.START_SESSION, async (_event, sessionCtx?: SessionContext) => {
    if (sessionRuntimeStore.isSessionActive) {
      return { success: true, alreadyActive: true }
    }

    const openrouterKey = (getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '') as string
    const model = modeConfig.getAnswerModelConfig().defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL

    const providerGate = canStartCurrentSessionWithConfiguredProviders()
    if (!providerGate.ok) throw new Error(providerGate.reason)

    const preparedSessionStart = await sessionLifecycleService.prepareSessionStart({
      sessionCtx,
      defaultModel: model,
      noiseTokens: RECALL_QUERY_NOISE_TOKENS,
    })

    sessionRuntimeStore.applyPreparedSessionStart(preparedSessionStart)
    // Reset the dialog log so the heartbeat / answer pipeline start with
    // a clean conversation state. Persisted from the previous session
    // was already serialized to disk at stop.
    conversationLog.clear()
    // Open the telemetry log for this session — every heartbeat tick,
    // suppression, dedup hit, and updater outcome lands here.
    {
      const folderName = sessionRuntimeStore.currentSessionFolderName
      if (folderName) {
        const sessionDir = path.join(contextManager.getAppDataPath(), 'sessions', folderName)
        telemetry.start(sessionDir)
        telemetry.record('session.start', {
          mode: currentAgentMode(),
          intent: sessionCtx?.sessionIntent,
          subject: sessionCtx?.subject,
          companyName: sessionCtx?.companyName,
        })
      }
    }
    // Reset the running token meter so each session starts at zero.
    costTracker.reset()
    {
      const profile = contextManager.getProfile()
      sessionRuntimeStore.currentSttKeyterms = extractKeyterms([
        sessionRuntimeStore.currentFileContext,
        profile.extraInstructions,
        profile.languages,
        profile.occupation,
        profile.currentFocus,
        profile.relationships,
        sessionCtx?.companyName,
        sessionCtx?.roleName,
        sessionCtx?.subject,
        sessionCtx?.sessionNotes,
      ])
      if (sessionRuntimeStore.currentSttKeyterms.length > 0) {
        const keytermPreview = `${sessionRuntimeStore.currentSttKeyterms.slice(0, 10).join(', ')}${sessionRuntimeStore.currentSttKeyterms.length > 10 ? '…' : ''}`
        const realtimeCompanionSession =
          currentAgentMode() === 'companion' &&
          modeConfig.getCompanionModeConfig().engine === 'realtime-beta'
        console.log(
          realtimeCompanionSession
            ? `[Realtime] Prepared ${sessionRuntimeStore.currentSttKeyterms.length} context keyterms: ${keytermPreview}`
            : `[STT] Boosting ${sessionRuntimeStore.currentSttKeyterms.length} keyterms: ${keytermPreview}`
        )
      }
    }
    sessionRuntimeStore.currentAgentEngine = sessionCtx?.agentEngine ?? 'default'
    modeConfig.rememberLastSessionForMode(sessionCtx ?? contextManager.getSessionContext(), currentAgentMode())
    answerTaskActive = false
    activeAnswerTaskLabel = ''
    sessionRuntimeStore.isSessionPaused = false
    if (preparedSessionStart.loadedFiles.length > 0) {
      console.log(`[FileContext] Loaded ${preparedSessionStart.loadedFiles.length} files: ${preparedSessionStart.loadedFiles.join(', ')}`)
    }

    memoryPipeline.recordEvent({
      type: 'session.started',
      source: 'system',
      sessionId: getCurrentSessionId(),
      sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
      payload: {
        startedAt: sessionRuntimeStore.currentSessionStartTime || undefined,
        sessionIntent: sessionCtx?.sessionIntent,
        companyName: sessionCtx?.companyName,
        roleName: sessionCtx?.roleName,
        subject: sessionCtx?.subject,
      },
    })

    // Mode pipelines own STT setup, audio capture, and the LLM service
    // binding. Realtime Beta failures stay visible; the app does not
    // silently switch the user's selected Companion engine to Classic.
    await router.startSession(currentAgentMode(), sessionCtx ?? ({} as SessionContext))
    if (!router.hasActivePipeline()) {
      // Legacy fallback for modes without an active pipeline.
      const sttLanguage = configStore.get('sttLanguage', 'en') as string
      const keyterms = sessionRuntimeStore.currentSttKeyterms ?? []
      sessionRuntimeStore.sttService = createSelectedSttService('system', sttLanguage, keyterms)
      sessionRuntimeStore.micSttService = getMicEnabled() ? createSelectedSttService('user', sttLanguage, keyterms) : null
      sessionRuntimeStore.llmService = new LLMService(openrouterKey, model)
      sessionRuntimeService.clearPendingGeneration()

      sessionRuntimeService.bindSessionRuntime({
        systemSttService: sessionRuntimeStore.sttService,
        micSttService: sessionRuntimeStore.micSttService,
        llmService: sessionRuntimeStore.llmService,
        audioCapture,
        utteranceDebounceMs: UTTERANCE_DEBOUNCE_MS,
        onTranscript: handleTranscriptEntry,
        onAutoAnswerTrigger: () => {},
        shouldAutoTriggerFromMic: shouldAutoAnswerFromMic(),
        onAudioChunk: (source, chunk) => {
          const suppressSystemAudioCapture =
            source === 'system' && shouldSuppressCapturedSystemAudio()
          const suppressMicBleed =
            source === 'user' && !voiceBargeInOpen && shouldSuppressMicBleedDuringPlayback(chunk)
          if (suppressSystemAudioCapture || suppressMicBleed) {
            return
          }

          if (source === 'system') {
            sessionRuntimeStore.sttService?.sendAudio(chunk)
            return
          }

          sessionRuntimeStore.micSttService?.sendAudio(chunk)
        },
        onAnswerChunk: streamAnswerChunk,
        onAnswerDone: (answer) => {
          completeAnswerStream(answer, sessionRuntimeStore.lastRequestedQuestion)
        },
        onAnswerError: reportAnswerError,
      })

      await sessionRuntimeStore.sttService.connect()
      await sessionRuntimeStore.micSttService?.connect()
      audioCapture.startCapture()
    }

    sessionRuntimeStore.isSessionActive = true
    markSessionActivity()
    startProactiveScreenObserver()
    void maybeRefreshProactiveScreenContext(true)
    if (isLiveAgentEnabled() && !heartbeatService.getState().enabled) {
      heartbeatService.setEnabled(true)
      configStore.set('heartbeatEnabled', true)
      modeConfig.updateModeScopedConfigFromFlatPatch({ heartbeatEnabled: true })
    }

    // Cross-session recall from Vault, before the brain/heartbeat run their
    // first tick. One call per session; '' when vault-memory is offline.
    sessionRuntimeStore.vaultRecallContext = await buildVaultRecallContext(
      vaultMcpManager,
      sessionCtx ?? contextManager.getSessionContext(),
      getVaultMemoryProject()
    )

    const brainEnabled = configStore.get('brainEnabled', DEFAULT_BRAIN_CONFIG.brainEnabled) as boolean
    const canStartSessionBrain = Boolean(getOpenRouterApiKey())
    if (brainEnabled && !canStartSessionBrain) {
      console.warn('[SessionBrain] disabled for this session because cheap text/vision helpers remain OpenRouter-only.')
    }
    if (brainEnabled && canStartSessionBrain && sessionRuntimeStore.llmService) {
      const brain = new SessionBrainService({
        llmService: sessionRuntimeStore.llmService,
        contextManager,
        runtimeStore: sessionRuntimeStore,
        config: {
          brainEnabled: true,
          brainModel: configStore.get('brainModel', DEFAULT_BRAIN_CONFIG.brainModel) as string,
          brainVisionModel: configStore.get('brainVisionModel', DEFAULT_BRAIN_CONFIG.brainVisionModel) as string,
          brainSummaryIntervalMs: configStore.get('brainSummaryIntervalMs', DEFAULT_BRAIN_CONFIG.brainSummaryIntervalMs) as number,
          brainSummaryMinUtterances: configStore.get('brainSummaryMinUtterances', DEFAULT_BRAIN_CONFIG.brainSummaryMinUtterances) as number,
          brainScreenshotIntervalMs: configStore.get('brainScreenshotIntervalMs', DEFAULT_BRAIN_CONFIG.brainScreenshotIntervalMs) as number,
          brainScreenshotMaxKept: configStore.get('brainScreenshotMaxKept', DEFAULT_BRAIN_CONFIG.brainScreenshotMaxKept) as number,
          brainSummaryMaxTicks: configStore.get('brainSummaryMaxTicks', DEFAULT_BRAIN_CONFIG.brainSummaryMaxTicks) as number,
          brainScreenshotKeepThreshold: configStore.get('brainScreenshotKeepThreshold', DEFAULT_BRAIN_CONFIG.brainScreenshotKeepThreshold) as number,
        },
        recordUsage: (model, promptTokens, completionTokens) =>
          costTracker.add(model, promptTokens, completionTokens),
        onStudyNotesSnapshot: (snapshot) => {
          sendToOverlay(IPC.STUDY_NOTES_UPDATE, snapshot)
          sendToAnswer(IPC.STUDY_NOTES_UPDATE, snapshot)
        },
        getVaultRecallContext: () => sessionRuntimeStore.vaultRecallContext,
      })
      try {
        await brain.start({
          sessionFolderName: sessionRuntimeStore.currentSessionFolderName,
          sessionContext: sessionCtx ?? contextManager.getSessionContext(),
          startedAt: sessionRuntimeStore.currentSessionStartTime ?? Date.now(),
        })
        sessionRuntimeStore.sessionBrain = brain
      } catch (err) {
        console.error('[SessionBrain] start failed:', err)
      }
    }
    const sessionState = {
      isActive: true,
      isPaused: false,
      startTime: sessionRuntimeStore.currentSessionStartTime,
      micEnabled: getMicEnabled(),
      sessionIntent: contextManager.getSessionContext().sessionIntent || 'session',
      liveAgentMode: liveAgentMode(),
      liveAgentCaptionsEnabled: isLiveAgentCaptionsEnabled(),
      companionEngine: modeConfig.getCompanionModeConfig().engine,
      companionRealtimeStatus: sessionRuntimeStore.companionRealtimeStatus,
    }
    sendToOverlay(IPC.SESSION_STATE, sessionState)
    sendToAnswer(IPC.SESSION_STATE, sessionState)
    sendToSettings(IPC.SESSION_STATE, sessionState)
    sendToPreview(IPC.SESSION_STATE, sessionState)
    sendToCanvas(IPC.SESSION_STATE, sessionState)

    heartbeatService.start()
    heartbeatService.setPresenceState('listening')

    return { success: true }
  })

  ipcMain.handle(IPC.STOP_SESSION, async () => {
    const router = getModeRouter()
    const usingPipeline = router.hasActivePipeline()

    answerTaskActive = false
    activeAnswerTaskLabel = ''

    if (usingPipeline) {
      await router.stopSession('user-stop')
    } else {
      sessionRuntimeService.clearPendingGeneration()
      audioCapture.stopCapture()
      audioCapture.removeAllListeners('audio-data')
      await sessionRuntimeStore.sttService?.disconnect()
      await sessionRuntimeStore.micSttService?.disconnect()
      sessionRuntimeStore.llmService?.abort()
    }

    stopCompanionVoiceOutput()
    sessionRuntimeStore.isSessionPaused = false

    const preparedSessionStop = sessionLifecycleService.prepareSessionStop(sessionRuntimeStore.currentSessionStartTime)
    memoryPipeline.recordEvent({
      type: 'session.stopped',
      source: 'system',
      createdAt: preparedSessionStop.stoppedAt,
      sessionId: getCurrentSessionId(),
      sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
      payload: {
        startedAt: sessionRuntimeStore.currentSessionStartTime || undefined,
        endedAt: preparedSessionStop.stoppedAt,
        durationSeconds: preparedSessionStop.durationSeconds,
      },
    })

    heartbeatService.stop()
    stopProactiveScreenObserver()
    lastSessionActivityAt = 0
    sessionRuntimeStore.currentAgentEngine = 'default'

    let finalStudyNotes: StudyNotesSnapshot | null = null
    let brainFinalSummary = ''
    if (sessionRuntimeStore.sessionBrain) {
      try {
        await sessionRuntimeStore.sessionBrain.stop()
        finalStudyNotes = sessionRuntimeStore.sessionBrain.readStudyNotesSnapshot()
        brainFinalSummary = sessionRuntimeStore.sessionBrain.getSummary()
      } catch (err) {
        console.error('[SessionBrain] stop failed:', err)
      }
      sessionRuntimeStore.sessionBrain = null
    }

    // Fire-and-forget Vault save — session summary (brain markdown when
    // available, closing transcript excerpt otherwise). Never blocks stop.
    void saveVaultSessionMemory(vaultMcpManager, {
      subject: contextManager.getSessionContext().subject || '',
      summaryMarkdown: brainFinalSummary,
      startedAt: sessionRuntimeStore.currentSessionStartTime,
      endedAt: preparedSessionStop.stoppedAt,
      transcript: [...sessionRuntimeStore.sessionTranscript],
      project: getVaultMemoryProject(),
    })

    const sessionStopTelemetryCounts = {
      transcriptCount: sessionRuntimeStore.sessionTranscript.length,
      answerCount: sessionRuntimeStore.currentSessionAnswers.length,
    }

    saveCurrentSession(finalStudyNotes)
    sessionRuntimeStore.applyPreparedSessionStop(preparedSessionStop)
    const stoppedState = {
      isActive: false,
      isPaused: false,
      startTime: null,
      micEnabled: getMicEnabled(),
      sessionIntent: contextManager.getSessionContext().sessionIntent || 'session',
      liveAgentMode: liveAgentMode(),
      liveAgentCaptionsEnabled: isLiveAgentCaptionsEnabled(),
      companionEngine: modeConfig.getCompanionModeConfig().engine,
      companionRealtimeStatus: sessionRuntimeStore.companionRealtimeStatus,
    }
    sendToOverlay(IPC.SESSION_STATE, stoppedState)
    sendToAnswer(IPC.SESSION_STATE, stoppedState)
    sendToSettings(IPC.SESSION_STATE, stoppedState)
    sendToPreview(IPC.SESSION_STATE, stoppedState)
    sendToCanvas(IPC.SESSION_STATE, stoppedState)

    // Fire-and-forget profile.md auto-merge. Must run AFTER session brain
    // stop so the merger can read final-summary.md as part of its input.
    // Reads the runtime store immediately into a snapshot so a concurrent
    // session start can't yank the values mid-flight.
    void runProfileUpdate({
      transcript: [...sessionRuntimeStore.sessionTranscript],
      sessionContext: contextManager.getSessionContext(),
      sessionFolderName: sessionRuntimeStore.currentSessionFolderName,
    })

    telemetry.record('session.stop', sessionStopTelemetryCounts)
    telemetry.stop('user-stop')

    return { success: true, transcript: sessionRuntimeStore.sessionTranscript }
  })

  ipcMain.handle(IPC.PAUSE_SESSION, async () => {
    if (!sessionRuntimeStore.isSessionActive) {
      return { success: false, reason: 'session-not-active' }
    }
    if (sessionRuntimeStore.isSessionPaused) {
      return { success: true, alreadyPaused: true }
    }

    sessionRuntimeStore.isSessionPaused = true
    sessionRuntimeService.clearPendingGeneration()
    audioCapture.stopCapture()
    heartbeatService.stop()
    stopCompanionVoiceOutput()
    sessionRuntimeStore.sessionBrain?.pause()
    broadcastSessionState()
    return { success: true }
  })

  ipcMain.handle(IPC.RESUME_SESSION, async () => {
    if (!sessionRuntimeStore.isSessionActive) {
      return { success: false, reason: 'session-not-active' }
    }
    if (!sessionRuntimeStore.isSessionPaused) {
      return { success: true, alreadyRunning: true }
    }

    sessionRuntimeStore.isSessionPaused = false
    audioCapture.startCapture()
    markSessionActivity()
    heartbeatService.start()
    heartbeatService.setPresenceState('listening')
    sessionRuntimeStore.sessionBrain?.resume()
    broadcastSessionState()
    return { success: true }
  })

  ipcMain.handle(IPC.GET_SESSION_STATE, async () => ({
    isActive: sessionRuntimeStore.isSessionActive,
    isPaused: sessionRuntimeStore.isSessionPaused,
    startTime: sessionRuntimeStore.currentSessionStartTime,
    micEnabled: getMicEnabled(),
    answerWindowVisible: Boolean(getAnswerWindow()?.isVisible()),
    liveAgentMode: liveAgentMode(),
    liveAgentCaptionsEnabled: isLiveAgentCaptionsEnabled(),
    companionEngine: modeConfig.getCompanionModeConfig().engine,
    companionRealtimeStatus: sessionRuntimeStore.companionRealtimeStatus,
    sessionIntent: contextManager.getSessionContext().sessionIntent || 'session',
  }))

  ipcMain.handle(IPC.GET_SESSIONS, async () => {
    return contextManager.listSessions()
  })

  ipcMain.handle(IPC.GET_SESSION_DETAIL, async (_event, folderName: string) => {
    return contextManager.getSessionDetail(folderName)
  })

  ipcMain.handle(IPC.DELETE_SESSION, async (_event, folderName: string) => {
    return contextManager.deleteSession(folderName)
  })

  ipcMain.handle(IPC.EXPORT_SESSION, async (_event, folderName: string, format: 'md' | 'json') => {
    return contextManager.exportSession(folderName, format)
  })

  ipcMain.handle(IPC.OPEN_SESSION_FOLDER, async (_event, folderName: string) => {
    contextManager.openSessionFolder(folderName)
    return { success: true }
  })

  ipcMain.handle(IPC.GET_STUDY_NOTES, async () => {
    return sessionRuntimeStore.sessionBrain?.readStudyNotesSnapshot() ?? null
  })

  ipcMain.handle(IPC.GET_RECENT_MEMORIES, async (_event, request?: number | MemoryListFilters) => {
    const filters = typeof request === 'number'
      ? { limit: request }
      : request || {}

    return memoryStore.listRecent(filters)
  })

  ipcMain.handle(IPC.GET_RECENT_ENTITIES, async (_event, filters?: import('@shared/types').EntityListFilters) => {
    return entityStore.listRecent(filters || {})
  })

  ipcMain.handle(IPC.GET_RELATIONS, async (_event, filters?: import('@shared/types').RelationListFilters) => {
    return relationStore.listRecent(filters || {})
  })

  ipcMain.handle(IPC.GET_RELATIONS_FOR_SOURCE, async (
    _event,
    sourceKind: import('@shared/types').RelationEndpointKind,
    sourceId: string
  ) => {
    return relationStore.listForSource(sourceKind, sourceId)
  })

  ipcMain.handle(IPC.GET_RELATIONS_FOR_TARGET, async (
    _event,
    targetKind: import('@shared/types').RelationEndpointKind,
    targetId: string
  ) => {
    return relationStore.listForTarget(targetKind, targetId)
  })

  ipcMain.handle(IPC.UPDATE_MEMORY_STATUS, async (_event, memoryId: string, status: AuraMemoryStatus) => {
    const updated = memoryStore.updateStatus(memoryId, status)
    if (!updated) {
      throw new Error('Memory not found')
    }

    entityGraphService.syncMemory(updated)

    return updated
  })

  ipcMain.handle(IPC.UPDATE_MEMORY, async (_event, memoryId: string, updates: MemoryUpdateInput) => {
    const updated = memoryStore.updateMemory(memoryId, updates)
    if (!updated) {
      throw new Error('Memory not found')
    }

    entityGraphService.syncMemory(updated)

    return updated
  })

  ipcMain.handle(IPC.RECALL_SEARCH, async (_event, query: RecallQuery) => {
    return await recallService.search(query)
  })

  ipcMain.handle(IPC.GET_RUNTIME_RECALL_DEBUG, async () => {
    return getRuntimeRecallDebugState()
  })

  ipcMain.handle(IPC.GET_AGENT_TOOLS, async () => {
    return getAvailableAgentTools()
  })

  ipcMain.handle(IPC.GET_HEARTBEAT_STATE, async () => {
    return heartbeatService.getState()
  })

  ipcMain.handle(IPC.GET_RECENT_ARTIFACTS, async (_event, filters?: ArtifactListFilters) => {
    return artifactStore.listRecent(filters || {})
  })

  ipcMain.handle(IPC.GET_ARTIFACTS_BY_IDS, async (_event, artifactIds: string[]) => {
    return artifactStore.getByIds(Array.isArray(artifactIds) ? artifactIds : [])
  })

  ipcMain.handle(IPC.OPEN_ARTIFACT, async (_event, artifactId: string) => {
    return await openArtifactById(artifactId)
  })

  // ── Audio from renderer ──────────────────────────────────────
  ipcMain.on('audio:chunk', (_event, source: 'system' | 'user', chunk: ArrayBuffer) => {
    if (sessionRuntimeStore.isSessionPaused) return
    audioCapture.processAudioChunk(source, Buffer.from(chunk))
  })
  ipcMain.on('voice:playback-state', (_event, active: boolean) => {
    const isActive = Boolean(active)
    setCompanionVoicePlaybackActive(isActive)
    setCompanionVoiceSpeaking(isActive)
  })
  ipcMain.on('voice:barge-in-state', (_event, open: boolean) => {
    voiceBargeInOpen = Boolean(open)
    console.log('[ipc] voice barge-in state ->', voiceBargeInOpen)
  })

  // ── LLM ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.LLM_REQUEST, async (_event, requestedQuestion?: string) => {
    const question = requestedQuestion?.trim() || getLatestQuestionCandidate(
      sessionRuntimeStore.sessionTranscript,
      sessionRuntimeStore.lastGeneratedPromptTranscriptCount,
      true,
      contextManager.getSessionContext().sessionIntent || 'session'
    )
    if (!question) return { success: false, reason: 'No question available yet' }
    if (isAgentTaskBusy()) {
      notifyAgentBusy()
      return { success: false, reason: 'busy' }
    }

    await runManualAnswer(question)
    return { success: true }
  })

  // User chat input — typed into the overlay chat field. Routed through the
  // active agent as a conversational turn (not a one-shot question):
  //   * Always appended to the session transcript with source:'chat' so it
  //     shows up in the transcript strip and saved transcript.md, and feeds
  //     heartbeat context like any other turn.
  //   * In Companion modes, handleTranscriptEntry schedules the OpenRouter
  //     heartbeat so the model replies in the same tool-capable thread.
  //   * Tool-heavy messages are routed through the main answer pipeline.
  ipcMain.handle(IPC.CHAT_SEND, async (_event, text?: string) => {
    const trimmed = (text || '').trim()
    if (!trimmed) return { success: false, reason: 'empty' }
    if (!sessionRuntimeStore.isSessionActive) {
      return { success: false, reason: 'no-session' }
    }
    const entry: TranscriptEntry = {
      id: randomUUID(),
      text: trimmed,
      speaker: 'user',
      timestamp: Date.now(),
      isFinal: true,
      source: 'chat',
    }
    const reportRequest = isSessionReportRequest(trimmed)
    const shouldUseAnswerPipeline =
      !reportRequest && (liveAgentMode() === 'off' || shouldRouteChatToToolCapableAnswer(trimmed))

    handleTranscriptEntry(entry, { suppressHeartbeat: shouldUseAnswerPipeline || reportRequest })

    if (shouldUseAnswerPipeline) {
      if (isAgentTaskBusy()) {
        notifyAgentBusy()
        return { success: false, reason: 'busy', routed: 'answer-pipeline' }
      }
      runManualAnswerInBackground(trimmed)
      return { success: true, routed: 'answer-pipeline' }
    }

    return { success: true }
  })

  ipcMain.handle(IPC.LLM_REGENERATE, async () => {
    const question = getLatestQuestionCandidate(
      sessionRuntimeStore.sessionTranscript,
      sessionRuntimeStore.lastGeneratedPromptTranscriptCount,
      true,
      contextManager.getSessionContext().sessionIntent || 'session'
    )
    if (!question) return
    if (isAgentTaskBusy()) {
      notifyAgentBusy()
      return
    }

    await runManualAnswer(question)
  })

  // ── Screen Capture ───────────────────────────────────────────
  ipcMain.handle(IPC.CAPTURE_SCREEN, async () => {
    if (isAgentTaskBusy()) {
      notifyAgentBusy('I am still working on the current request. I will not start screen analysis yet.')
      return { success: false, reason: 'busy' }
    }
    await runCurrentScreenAnswer(buildScreenAnalysisQuestion())

    return { success: true }
  })

  // ── Context ──────────────────────────────────────────────────
  ipcMain.handle(IPC.SET_CONTEXT, async (_event, context: UserContext) => {
    contextManager.setContext(context)
    return { success: true }
  })

  ipcMain.handle(IPC.GET_CONTEXT, async () => {
    return contextManager.getContext()
  })

  ipcMain.handle(IPC.GET_PROFILE, async () => {
    return contextManager.getProfile()
  })

  ipcMain.handle(IPC.SET_PROFILE, async (_event, profile: any) => {
    contextManager.setProfile(profile)
    return { success: true }
  })

  ipcMain.handle(IPC.GET_LAST_SESSION_CONTEXT, async () => {
    const modes = modeConfig.readModeScopedConfig()
    const section = modeConfig.modeConfigSectionForAgentMode(currentAgentMode())
    return modes[section].lastSession || contextManager.getLastSessionContext()
  })

  // ── Session presets ────────────────────────────────────────
  ipcMain.handle('session-preset:list', async () => listSessionPresets())

  ipcMain.handle(
    'session-preset:save',
    async (
      _event,
      input: { id?: string; name: string; agentMode: 'companion'; context: Record<string, unknown> }
    ) => {
      try {
        return saveSessionPreset({
          id: input.id,
          name: input.name,
          agentMode: input.agentMode,
          context: input.context as never,
        })
      } catch (err) {
        console.warn('[session-preset] save failed:', err)
        return null
      }
    }
  )

  ipcMain.handle('session-preset:delete', async (_event, id: string) => {
    return deleteSessionPreset(id)
  })

  // Mark a preset as used. The renderer applies the preset's context
  // locally — main only needs to bump lastUsedAt for sort order.
  ipcMain.handle('session-preset:touch', async (_event, id: string) => {
    return touchSessionPreset(id) ?? null
  })

  // ── Session cost meter ─────────────────────────────────────
  ipcMain.handle('cost:get', async () => costTracker.get())

  // ── Bubble feedback (👍 / 👎) ───────────────────────────────
  ipcMain.handle(
    'bubble:feedback',
    async (
      _event,
      input: { bubbleId: string; sentiment: 'up' | 'down'; text: string }
    ) => {
      const sentiment = input?.sentiment === 'down' ? 'down' : 'up'
      const text = String(input?.text || '').trim()
      const bubbleId = String(input?.bubbleId || '').trim() || `bubble-${Date.now()}`

      // Telemetry — paired with the heartbeat.tick.complete event for replay.
      telemetry.record('bubble.feedback', {
        sentiment,
        bubbleId,
        textChars: text.length,
        textPreview: text.slice(0, 200),
      })

      // Persist as a memory so the next profile/voice update can see it.
      // 'down' votes become 'insight' so voice.md learns what to avoid;
      // 'up' votes become 'note' for positive reinforcement.
      let saved = false
      try {
        const summary = text.length > 280 ? text.slice(0, 280).trimEnd() + '…' : text
        const title =
          sentiment === 'down'
            ? `User thumbed down: ${summary.slice(0, 60)}${summary.length > 60 ? '…' : ''}`
            : `User thumbed up: ${summary.slice(0, 60)}${summary.length > 60 ? '…' : ''}`
        memoryStore.createMemory({
          type: sentiment === 'down' ? 'insight' : 'note',
          title,
          summary: `[${sentiment === 'down' ? '👎' : '👍'}] Bubble text: "${summary}"`,
          status: 'active',
          confidence: 0.95,
        })
        saved = true
      } catch (err) {
        console.warn('[bubble:feedback] memory save failed:', err)
      }

      // Show a transient confirmation toast so the click feels acknowledged.
      try {
        const toastMessage =
          sentiment === 'up'
            ? saved
              ? '👍 Saved — voice.md will reinforce this style'
              : '👍 Logged'
            : saved
              ? '👎 Noted — voice.md will learn to avoid this pattern'
              : '👎 Logged'
        widgetManager.register({
          type: 'toast',
          props: { message: toastMessage },
          ttl: 2400,
        })
      } catch (err) {
        console.warn('[bubble:feedback] toast register failed:', err)
      }

      return { saved }
    }
  )

  // File context
  ipcMain.handle(IPC.LIST_CONTEXT_FOLDERS, async () => {
    return contextManager.listContextFolders()
  })

  ipcMain.handle(IPC.LOAD_FILE_CONTEXT, async (_event, company?: string) => {
    return contextManager.loadFileContext(company)
  })

  ipcMain.handle(IPC.OPEN_CONTEXT_FOLDER, async () => {
    contextManager.openContextFolder()
    return { success: true }
  })

  ipcMain.handle(IPC.OPEN_APP_DATA_FOLDER, async () => {
    contextManager.openAppDataFolder()
    return { success: true }
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
      await shell.openExternal(url)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.SAVE_IMAGE_ATTACHMENT, async (_event, input: { src?: string; caption?: string }) => {
    try {
      const src = String(input?.src ?? '')
      const match = src.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
      if (!match) return { success: false, error: 'Unsupported image data.' }

      const mimeType = match[1]
      const base64 = match[2]
      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
      const safeCaption = String(input?.caption ?? 'generated-image')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'generated-image'
      const defaultPath = `${safeCaption}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`

      const result = await dialog.showSaveDialog({
        title: 'Save generated image',
        defaultPath,
        filters: [{ name: 'Image', extensions: [ext] }],
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }

      fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
      return { success: true, path: result.filePath }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle(IPC.SPEAK_ANSWER, async (_event, text: string) => {
    const clean = markdownToPlaintext(typeof text === 'string' ? text : '')
    if (!clean) return false
    const provider = getSelectedAnswerTtsProvider()
    const availability = await provider.isAvailable()
    if (!availability.ok) {
      sendToAnswer('answer:tts-unavailable')
      return false
    }
    stopActiveAnswerTtsProviderForReplacement()
    activeAnswerTtsProvider = provider
    explicitAnswerTtsActive = true
    sendToAnswer('answer:tts-start')
    try {
      await provider.speak(clean, emitAnswerTtsChunk)
      if (activeAnswerTtsProvider !== provider) return false
      finishNonDeepgramAnswerTtsProvider(provider)
      return true
    } catch (error) {
      if (activeAnswerTtsProvider === provider && explicitAnswerTtsActive) {
        activeAnswerTtsProvider = null
        console.warn('[AnswerTTS] provider failed:', error)
        sendToAnswer('answer:tts-unavailable')
        emitAnswerTtsEnd()
      }
      return false
    }
  })

  ipcMain.handle(IPC.STOP_SPEAKING_ANSWER, async () => {
    const provider = activeAnswerTtsProvider
    provider?.stop()
    activeAnswerTtsProvider = null
    if (!provider || provider.id !== 'deepgram') emitAnswerTtsEnd()
    return true
  })

  // Update check
  ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
    return await checkForUpdates()
  })

  // ── Config ───────────────────────────────────────────────────
  // What Aura has learned about the user across sessions — read-only
  // surface for the Profile page (profile.md / voice.md are rebuilt by
  // the post-session updaters).
  ipcMain.handle('profile:learned', async () => ({
    profileMd: readProfileMdRaw(),
    voiceMd: readVoiceMdRaw(),
  }))

  // ── Vault MCP bridge (Phase 2) ─────────────────────────────────
  ipcMain.handle('vault:memory:recall', async (_event, topic?: string) => {
    const base = contextManager.getSessionContext()
    const context = await buildVaultRecallContext(
      vaultMcpManager,
      {
        ...base,
        subject: topic?.trim() || base.subject,
      },
      getVaultMemoryProject()
    )
    return { success: true, connected: vaultMcpManager.isConnected('vault_memory'), context }
  })

  ipcMain.handle('vault:memory:save', async (_event, payload: Record<string, any>) => {
    const title = String(payload?.title ?? '').trim()
    const content = String(payload?.content ?? '').trim()
    if (!title && !content) {
      return { success: false, error: 'Nothing to save — provide a title or content.' }
    }
    const vaultProject = getVaultMemoryProject()
    if (!vaultProject) {
      console.warn('[VaultMemory] no project configured, skipping save.')
      return { success: false, error: 'No Vault memory project configured — set one in Settings → Memory & Sync.' }
    }
    try {
      const result = await vaultMcpManager.callTool('vault_memory', 'vault_save_memory', {
        title: title || `Aura note (${new Date().toISOString().slice(0, 10)})`,
        project: vaultProject,
        memory_type: 'reference',
        subject: String(payload?.subject ?? '').trim() || title || 'Aura note',
        summary: String(payload?.summary ?? '').trim() || content.slice(0, 300) || title,
        content: content || undefined,
        tags: ['aura-manual-save'],
        source_app: 'other',
      })
      console.log('[VaultMemory] manual save via IPC completed.')
      return { success: true, result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('vault:collab:status', async () => auraCollabSession.getStatus())

  ipcMain.handle('vault:collab:drain', async () => {
    try {
      return { success: true, ...(await auraCollabSession.drain()) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Settings panel feed: connection states + the bridged tool list with
  // per-tool enable flags (vaultDisabledTools).
  ipcMain.handle('vault:mcp:status', async () => {
    const snapshot = vaultMcpManager.getStatusSnapshot()
    const disabled = new Set(getVaultDisabledTools())
    const tools = (['vault_memory', 'vault_collab'] as const).flatMap((namespace) =>
      vaultMcpManager.getAvailableTools(namespace).map((tool) => ({
        namespace,
        name: tool.bridgedName,
        description: tool.description,
        enabled: !disabled.has(tool.bridgedName),
      }))
    )
    return {
      vaultMemory: {
        ...snapshot.vault_memory,
        enabled: configStore.get('vaultMemoryEnabled', true) as boolean,
      },
      vaultCollab: {
        ...snapshot.vault_collab,
        enabled: configStore.get('vaultCollabEnabled', true) as boolean,
        sessionUid: auraCollabSession.getStatus().sessionUid,
      },
      tools,
    }
  })

  ipcMain.handle(IPC.GET_CONFIG, async () => {
    const modes = modeConfig.readModeScopedConfig()
    const activeMode = currentAgentMode()
    return {
      openrouterApiKey: getSecureKey('openrouterApiKey'),
      deepgramApiKey: getSecureKey('deepgramApiKey'),
      freeLlmApiKey: getSecureKey('freeLlmApiKey'),
      freeLlmApiBaseUrl: getFreeLlmApiBaseUrl(),
      activeMode,
      modes,
      defaultModel: modeConfig.getAnswerModelConfig().defaultModel,
      codingModel: modeConfig.getAnswerModelConfig().codingModel,
      imageGenerationModel: configStore.get(
        'imageGenerationModel',
        ImageGenerationService.DEFAULT_MODEL
      ) as string,
      autoModelSelection: configStore.get('autoModelSelection', false) as boolean,
      overlayOpacity: configStore.get('overlayOpacity', 0.92) as number,
      fontSize: configStore.get('fontSize', 14) as number,
      bubbleFontSize: configStore.get('bubbleFontSize', 13) as number,
      bubbleWidth: configStore.get('bubbleWidth', 320) as number,
      micEnabled: configStore.get('micEnabled', true) as boolean,
      sttLanguage: configStore.get('sttLanguage', 'en') as string,
      contentProtection: configStore.get('contentProtection', true) as boolean,
      agentMode: activeMode,
      liveAgentEnabled: activeMode === 'companion',
      liveAgentVoiceEnabled: modes.companion.voiceEnabled,
      liveAgentVoiceName: modes.companion.voiceName,
      companionVoiceModel: modes.companion.voiceModel,
      companionEngine: modes.companion.engine,
      companionRealtimeModel: modes.companion.realtimeModel,
      companionRealtimeVoiceName: modes.companion.realtimeVoiceName,
      companionRealtimeInputTranscription: modes.companion.realtimeInputTranscription,
      companionRealtimeOutputTranscription: modes.companion.realtimeOutputTranscription,
      liveAgentModel: modes.companion.model,
      liveAgentDisabledTools: modes.companion.disabledTools,
      liveAgentCaptionsEnabled: modes.companion.captionsEnabled,
      personality: modes.companion.personality,
      interruptionPolicy: modes.companion.interruptionPolicy,
      heartbeatIntervalMs: modes.companion.heartbeatIntervalMs,
      heartbeatEnabled: modes.companion.heartbeatEnabled,
      brainEnabled: configStore.get('brainEnabled', DEFAULT_BRAIN_CONFIG.brainEnabled) as boolean,
      brainModel: configStore.get('brainModel', DEFAULT_BRAIN_CONFIG.brainModel) as string,
      brainVisionModel: configStore.get('brainVisionModel', DEFAULT_BRAIN_CONFIG.brainVisionModel) as string,
      brainScreenshotIntervalMs: configStore.get('brainScreenshotIntervalMs', DEFAULT_BRAIN_CONFIG.brainScreenshotIntervalMs) as number,
      localAi: readLocalAiConfig(),
      vaultMemoryEnabled: configStore.get('vaultMemoryEnabled', true) as boolean,
      vaultCollabEnabled: configStore.get('vaultCollabEnabled', true) as boolean,
      vaultDisabledTools: getVaultDisabledTools(),
      vaultMemoryProject: getVaultMemoryProject(),
    }
  })

  ipcMain.handle(IPC.SET_CONFIG, async (_event, config: Record<string, any>) => {
    const secureKeys = new Set(['openrouterApiKey', 'deepgramApiKey', 'freeLlmApiKey'])
    const ALLOWED_CONFIG_KEYS = new Set([
      'openrouterApiKey', 'deepgramApiKey',
      'freeLlmApiKey', 'freeLlmApiBaseUrl',
      'defaultModel', 'codingModel', 'imageGenerationModel',
      'autoModelSelection', 'overlayOpacity', 'fontSize', 'autoAnswerEnabled',
      'micEnabled', 'sttLanguage', 'contentProtection',
      'personality', 'interruptionPolicy', 'heartbeatIntervalMs', 'heartbeatEnabled',
      'sessionHeartbeatEnabled',
      'bubbleFontSize', 'bubbleWidth', 'agentMode', 'liveAgentEnabled',
      'liveAgentVoiceEnabled', 'liveAgentVoiceName', 'companionVoiceModel',
      'companionEngine',
      'companionRealtimeModel', 'companionRealtimeVoiceName',
      'companionRealtimeInputTranscription', 'companionRealtimeOutputTranscription',
      'liveAgentModel', 'liveAgentDisabledTools',
      'liveAgentCaptionsEnabled',
      'activeMode',
      'brainEnabled', 'brainModel', 'brainVisionModel', 'brainScreenshotIntervalMs',
      'localAi',
      'vaultMemoryEnabled', 'vaultCollabEnabled', 'vaultDisabledTools', 'vaultMemoryProject',
    ])
    for (const [key, value] of Object.entries(config)) {
      if (!ALLOWED_CONFIG_KEYS.has(key)) continue
      if (secureKeys.has(key)) {
        setSecureKey(key, value as string)
      } else if (key === 'localAi') {
        configStore.set('localAi', normalizeLocalAiConfig(value))
      } else {
        configStore.set(key, value)
      }
    }
    if (config.activeMode !== undefined && config.agentMode === undefined) {
      config.agentMode = config.activeMode
    }
    modeConfig.updateModeScopedConfigFromFlatPatch(config)

    if (config.agentMode !== undefined) {
      const nextMode = modeConfig.normalizeAgentMode(config.agentMode)
      if (nextMode) applyAgentMode(nextMode)
      heartbeatService.setEnabled(true)
      configStore.set('heartbeatEnabled', true)
      modeConfig.updateModeScopedConfigFromFlatPatch({ heartbeatEnabled: true })
    }

    // Forward agent behavior changes to heartbeat service
    if (config.personality !== undefined) {
      heartbeatService.setPersonality(config.personality as PersonalityPreset)
    }
    if (config.interruptionPolicy !== undefined) {
      heartbeatService.setInterruptionPolicy(config.interruptionPolicy as InterruptionPolicy)
    }
    if (config.heartbeatEnabled !== undefined) {
      heartbeatService.setEnabled(Boolean(config.heartbeatEnabled))
      if (config.heartbeatEnabled && sessionRuntimeStore.isSessionActive) {
        heartbeatService.start()
      }
    }
    if (config.sessionHeartbeatEnabled !== undefined) {
      heartbeatService.setProactiveEnabled(Boolean(config.sessionHeartbeatEnabled))
    }
    if (config.vaultMemoryEnabled !== undefined) {
      void vaultMcpManager.setEnabled('vault_memory', Boolean(config.vaultMemoryEnabled))
    }
    if (config.vaultCollabEnabled !== undefined) {
      if (config.vaultCollabEnabled) {
        void vaultMcpManager
          .setEnabled('vault_collab', true)
          .then(() => auraCollabSession.start())
      } else {
        void auraCollabSession
          .stop()
          .then(() => vaultMcpManager.setEnabled('vault_collab', false))
      }
    }
    if (config.heartbeatIntervalMs !== undefined) {
      heartbeatService.setIntervalMs(Number(config.heartbeatIntervalMs))
    }

    const companionModeChanged =
      config.agentMode !== undefined ||
      config.liveAgentEnabled !== undefined ||
      config.liveAgentVoiceEnabled !== undefined
    const voiceChanged =
      companionModeChanged ||
      config.liveAgentVoiceName !== undefined ||
      config.companionVoiceModel !== undefined
    if (voiceChanged && !isLiveAgentVoiceEnabled()) {
      stopCompanionVoiceOutput()
    } else if (voiceChanged && companionTtsService && readLocalAiConfig().ttsProvider === 'deepgram') {
      ensureCompanionTtsService()
    }
    if (
      sessionRuntimeStore.isSessionActive &&
      !sessionRuntimeStore.isSessionPaused &&
      (companionModeChanged || config.heartbeatEnabled !== undefined)
    ) {
      if (heartbeatService.getState().enabled) heartbeatService.start()
    }

    // Apply opacity change immediately
    if (config.overlayOpacity !== undefined) {
      const overlay = getOverlayWindow()
      overlay?.setOpacity(config.overlayOpacity)
    }

    // Live-update canvas bubble style on save
    if (config.bubbleFontSize !== undefined || config.bubbleWidth !== undefined) {
      sendToCanvas('canvas:bubble-style', {
        fontSize: configStore.get('bubbleFontSize', 13) as number,
        width: configStore.get('bubbleWidth', 320) as number,
      })
    }

    if (config.autoAnswerEnabled !== undefined) {
      broadcastSessionState()
    }

    if (config.sttLanguage !== undefined && sessionRuntimeStore.isSessionActive) {
      // Reconnect STT with new language
      const newLang = config.sttLanguage as string

      sendToOverlay('stt:reconnecting', true)

      try {
        if (sessionRuntimeStore.sttService) {
          await sessionRuntimeStore.sttService.disconnect()
          sessionRuntimeStore.sttService = createSelectedSttService('system', newLang, sessionRuntimeStore.currentSttKeyterms ?? [])
          sessionRuntimeService.attachSystemSttService(
            sessionRuntimeStore.sttService,
            handleTranscriptEntry,
            UTTERANCE_DEBOUNCE_MS,
            () => {}
          )
          await sessionRuntimeStore.sttService.connect()
        }
        if (sessionRuntimeStore.micSttService && getMicEnabled()) {
          await sessionRuntimeStore.micSttService.disconnect()
          sessionRuntimeStore.micSttService = createSelectedSttService('user', newLang, sessionRuntimeStore.currentSttKeyterms ?? [])
          sessionRuntimeService.attachMicSttService(
            sessionRuntimeStore.micSttService,
            handleTranscriptEntry,
            undefined,
            undefined
          )
          await sessionRuntimeStore.micSttService.connect()
        }
        sendToOverlay('stt:reconnecting', false)
      } catch (error: any) {
        console.error('[STT] Language reconnection failed:', error.message)
        sendToOverlay('stt:reconnecting', false)
        sendToOverlay('stt:reconnect-error', error.message)
        // Attempt to restore with previous language
        const prevLang = configStore.get('sttLanguage', 'en') as string
        try {
          if (sessionRuntimeStore.sttService) {
            sessionRuntimeStore.sttService = createSelectedSttService('system', prevLang, sessionRuntimeStore.currentSttKeyterms ?? [])
            sessionRuntimeService.attachSystemSttService(
              sessionRuntimeStore.sttService,
              handleTranscriptEntry,
              UTTERANCE_DEBOUNCE_MS,
              () => {}
            )
            await sessionRuntimeStore.sttService.connect()
          }
          if (sessionRuntimeStore.micSttService && getMicEnabled()) {
            sessionRuntimeStore.micSttService = createSelectedSttService('user', prevLang, sessionRuntimeStore.currentSttKeyterms ?? [])
            sessionRuntimeService.attachMicSttService(
              sessionRuntimeStore.micSttService,
              handleTranscriptEntry,
              undefined,
              undefined
            )
            await sessionRuntimeStore.micSttService.connect()
          }
        } catch (restoreError: any) {
          console.error('[STT] Failed to restore previous language:', restoreError.message)
        }
      }
    }

    if (config.contentProtection !== undefined) {
      setContentProtection(config.contentProtection as boolean)
    }

    if (config.micEnabled !== undefined) {
      if (sessionRuntimeStore.isSessionActive && sessionRuntimeStore.sttService) {
        if (getMicEnabled()) {
          if (!sessionRuntimeStore.micSttService) {
            const lang = configStore.get('sttLanguage', 'en') as string
            sessionRuntimeStore.micSttService = createSelectedSttService('user', lang, sessionRuntimeStore.currentSttKeyterms ?? [])
            sessionRuntimeService.attachMicSttService(
              sessionRuntimeStore.micSttService,
              handleTranscriptEntry,
              undefined,
              undefined
            )
            await sessionRuntimeStore.micSttService.connect()
          }
        } else {
          await sessionRuntimeStore.micSttService?.disconnect()
          sessionRuntimeStore.micSttService = null
        }
      }

      broadcastSessionState()
    }

    return { success: true }
  })

  ipcMain.handle(IPC.LOCAL_AI_SET_CONFIG, async (_event, config: unknown) => {
    const next = normalizeLocalAiConfig(config)
    configStore.set('localAi', next)
    if (sessionRuntimeStore.isSessionActive) {
      try {
        resolveDeepgramSpeechInputKey(next, deepgramKeyFromConfig)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.warn('[STT] Cloud speech input stopped:', reason)
        await stopCloudSpeechInput(reason)
      }
    }
    return next
  })

  ipcMain.handle(IPC.LOCAL_AI_GET_STATUS, async () => {
    return getLocalAiManager().getStatus()
  })

  ipcMain.handle(IPC.LOCAL_AI_TEST_TTS, async () => {
    const config = readLocalAiConfig()
    if (config.ttsProvider === 'disabled') {
      getLocalAiManager().recordProviderDiagnostic('disabled', {
        lastTestAt: Date.now(),
        lastTestSuccess: false,
        lastError: 'Local AI voice output is disabled',
      })
      return { success: false, reason: 'Local AI voice output is disabled' }
    }
    const startedAt = Date.now()
    const provider = getSelectedAnswerTtsProvider()
    const availability = await provider.isAvailable()
    if (!availability.ok) {
      getLocalAiManager().recordProviderDiagnostic(provider.id, {
        lastTestAt: Date.now(),
        lastTestSuccess: false,
        lastLatencyMs: Date.now() - startedAt,
        lastError: availability.reason || 'Selected TTS provider is not available',
      })
      return { success: false, provider: config.ttsProvider, reason: availability.reason || 'Selected TTS provider is not available' }
    }

    stopActiveAnswerTtsProviderForReplacement()
    activeAnswerTtsProvider = provider
    explicitAnswerTtsActive = true
    try {
      await provider.speak('Aura local AI voice test.', emitAnswerTtsChunk)
      if (activeAnswerTtsProvider !== provider) {
        return { success: false, provider: config.ttsProvider, reason: 'TTS request was cancelled' }
      }
      finishNonDeepgramAnswerTtsProvider(provider)
      getLocalAiManager().recordProviderDiagnostic(provider.id, {
        lastTestAt: Date.now(),
        lastTestSuccess: true,
        lastLatencyMs: Date.now() - startedAt,
        lastError: undefined,
      })
      return {
        success: true,
        provider: config.ttsProvider,
        message: `${provider.label} is available`,
      }
    } catch (error) {
      if (activeAnswerTtsProvider !== provider) {
        return { success: false, provider: config.ttsProvider, reason: 'TTS request was cancelled' }
      }
      activeAnswerTtsProvider = null
      emitAnswerTtsEnd()
      getLocalAiManager().recordProviderDiagnostic(provider.id, {
        lastTestAt: Date.now(),
        lastTestSuccess: false,
        lastLatencyMs: Date.now() - startedAt,
        lastError: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        provider: config.ttsProvider,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle(IPC.LOCAL_AI_TEST_VISION, async () => {
    const config = readLocalAiConfig()
    if (config.mode === 'off' || config.visionProvider === 'disabled') {
      return { success: false, reason: 'Local AI vision is disabled' }
    }
    const startedAt = Date.now()
    const providerId = 'openrouter'
    const provider = getLocalAiManager().getStatus().providers.find((item) => item.id === providerId)
    if (!provider || provider.availability !== 'available') {
      getLocalAiManager().recordProviderDiagnostic(providerId, {
        lastTestAt: Date.now(),
        lastTestSuccess: false,
        lastLatencyMs: Date.now() - startedAt,
        lastError: provider?.lastError || 'Selected vision provider is not available',
      })
      return { success: false, provider: providerId, reason: provider?.lastError || 'Selected vision provider is not available' }
    }
    getLocalAiManager().recordProviderDiagnostic(providerId, {
      lastTestAt: Date.now(),
      lastTestSuccess: true,
      lastLatencyMs: Date.now() - startedAt,
      lastError: undefined,
    })
    return {
      success: true,
      provider: providerId,
      message: `${provider.label} is available`,
    }
  })

  ipcMain.handle(IPC.LOCAL_AI_INSTALL_MODEL, async (_event, providerId: string) => {
    const config = readLocalAiConfig()
    if (!config.allowModelDownloads) {
      return { success: false, provider: providerId, reason: 'Enable model downloads before installing local model packs' }
    }
    const pack = modelPackForProvider(providerId)
    if (!pack) {
      return { success: false, provider: providerId, reason: 'Unknown local AI model pack' }
    }
    try {
      const result = await getLocalAiManager().installModelPack(pack.id, (progress) => {
        const payload: LocalAiInstallProgress = {
          provider: providerId,
          packId: pack.id,
          ...progress,
        }
        sendToSettings(IPC.LOCAL_AI_INSTALL_PROGRESS, payload)
      })
      return {
        success: true,
        provider: providerId,
        message: `${pack.label} installed`,
        bytes: result.bytes,
      }
    } catch (error) {
      sendToSettings(IPC.LOCAL_AI_INSTALL_PROGRESS, {
        provider: providerId,
        packId: pack.id,
        phase: 'failed',
        downloadedBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      } satisfies LocalAiInstallProgress)
      return {
        success: false,
        provider: providerId,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle(IPC.LOCAL_AI_REMOVE_MODEL, async (_event, providerId: string) => {
    const pack = modelPackForProvider(providerId)
    if (!pack) {
      return { success: false, provider: providerId, reason: 'Unknown local AI model pack' }
    }
    try {
      const result = getLocalAiManager().removeModelPack(pack.id)
      return {
        success: true,
        provider: providerId,
        message: result.removed ? `${pack.label} removed` : `${pack.label} was not installed`,
      }
    } catch (error) {
      return {
        success: false,
        provider: providerId,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  })

  // ── Clipboard ──────────────────────────────────────────────
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
    return true
  })

  // ── Window Control ───────────────────────────────────────────
  ipcMain.on(IPC.TOGGLE_OVERLAY, () => toggleOverlay())
  ipcMain.on(IPC.SHOW_OVERLAY, () => showOverlay())
  ipcMain.on(IPC.HIDE_OVERLAY, () => hideOverlay())
  ipcMain.on(IPC.TOGGLE_ANSWER_WINDOW, () => {
    const answerWindow = getAnswerWindow()
    if (isCompanionMode(currentAgentMode()) && !answerWindow?.isVisible()) {
      showAnswerWindow({ force: true })
    } else {
      toggleAnswerWindow()
    }
    broadcastSessionState()
  })
  ipcMain.on(IPC.HIDE_ANSWER_WINDOW, () => {
    hideAnswerWindow()
    broadcastSessionState()
  })
  ipcMain.on(IPC.SET_CONTENT_PROTECTION, (_event, enabled: boolean) => {
    setContentProtection(enabled)
    configStore.set('contentProtection', enabled)
  })

  // Toggle companion voice playback on/off while a session is running.
  // The companion itself stays OpenRouter/tool-driven; this only switches
  // whether text bubbles are also rendered through Deepgram Aura.
  ipcMain.handle('live-agent:set-voice-playback', (_event, enabled: boolean) => {
    if (!isLiveAgentEnabled()) return { success: false, reason: 'live-agent-not-running' }
    const modes = modeConfig.readModeScopedConfig()
    if (modes.companion.voiceEnabled === enabled) return { success: true }
    modes.companion.voiceEnabled = Boolean(enabled)
    modeConfig.writeModeScopedConfig(modes)
    configStore.set('liveAgentVoiceEnabled', Boolean(enabled))
    sessionRuntimeStore.currentAgentEngine = 'companion'
    applyAgentMode('companion')
    if (!enabled) {
      // Cut any in-flight audio immediately when turning voice off.
      stopCompanionVoiceOutput()
    }
    broadcastSessionState()
    return { success: true }
  })

  ipcMain.handle('live-agent:set-captions', (_event, enabled: boolean) => {
    configStore.set('liveAgentCaptionsEnabled', Boolean(enabled))
    const modes = modeConfig.readModeScopedConfig()
    modes.companion.captionsEnabled = Boolean(enabled)
    modeConfig.writeModeScopedConfig(modes)
    // When captions get turned off, clear any bubble that's currently up.
    if (!enabled) {
      stopCompanionVoiceOutput()
    }
    // Re-sync the canvas window visibility since canvas-availability in
    // Companion mode follows the captions toggle.
    syncModeWindowContracts(currentAgentMode())
    broadcastSessionState()
    return { success: true }
  })

  ipcMain.on(IPC.OPEN_SETTINGS, () => {
    openSettings()
  })


  ipcMain.handle(IPC.GET_ANSWER_WINDOW_BOUNDS, () => getAnswerWindowBounds())
  ipcMain.handle(IPC.SET_ANSWER_WINDOW_BOUNDS, (_event, bounds: { x?: number; y?: number; width?: number; height?: number }) => {
    setAnswerWindowBounds(bounds)
    return getAnswerWindowBounds()
  })
  ipcMain.handle(IPC.RESIZE_OVERLAY, (_event, width: number, height: number) => {
    resizeOverlayWindow(width, height)
    return { success: true }
  })

  // ── Preview Window ──────────────────────────────────────────
  ipcMain.on(IPC.TOGGLE_PREVIEW_WINDOW, () => togglePreviewWindow())
  ipcMain.on(IPC.HIDE_PREVIEW_WINDOW, () => hidePreviewWindow())
  ipcMain.handle(IPC.GET_PREVIEW_WINDOW_BOUNDS, () => getPreviewWindowBounds())
  ipcMain.handle(IPC.SET_PREVIEW_WINDOW_BOUNDS, (_event, bounds: { x?: number; y?: number; width?: number; height?: number }) => {
    setPreviewWindowBounds(bounds)
    return getPreviewWindowBounds()
  })
  ipcMain.handle(IPC.GET_PREVIEW_ITEMS, () => previewWindowItems)

  // PDF to Markdown conversion
  ipcMain.handle(IPC.CONVERT_PDF_TO_MARKDOWN, async (_event, pdfBase64: string, filename: string) => {
    const key = getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || ''
    const model = modeConfig.getAnswerModelConfig().defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL
    if (!key) throw new Error('OpenRouter API key required for PDF conversion')
    const llm = new LLMService(key, model)
    return llm.convertPdfToMarkdown(pdfBase64, filename)
  })

  // ── Canvas & Widgets ─────────────────────────────────────
  ipcMain.handle('canvas:widget-dismiss', (_event, widgetId: string) => {
    widgetManager.dismiss(widgetId)
  })

  ipcMain.handle('canvas:expand-bubble', (_event, bubbleId: string) => {
    const bubble = widgetManager.get(bubbleId)
    if (!bubble) return

    const message = String(bubble.props.message ?? '')
    widgetManager.dismiss(bubbleId)

    widgetManager.register({
      type: 'panel',
      props: {
        title: 'Aura',
        content: message,
        panelType: 'context',
      },
    })
  })

  ipcMain.on('canvas:set-interactive', (_event, interactive: boolean) => {
    setCanvasInteractive(interactive)
  })

  ipcMain.on('canvas:widget-position', (_event, widgetId: string, position: { x?: number; y?: number }) => {
    const x = Number(position?.x)
    const y = Number(position?.y)
    if (!widgetId || !Number.isFinite(x) || !Number.isFinite(y)) return
    widgetManager.setPosition(widgetId, x, y)
  })

  ipcMain.on('canvas:report-region', (_event, _id: string, _rect: any) => {
    // no-op for now; hit-testing is done in the renderer via mousemove
  })
}

async function injectBrainContext(request: LLMRequest): Promise<LLMRequest> {
  const brain = sessionRuntimeStore.sessionBrain
  if (!brain) return request
  try {
    const snapshot = await brain.readContextSnapshot()
    const parts: string[] = []
    if (snapshot.subject) {
      parts.push(`Active session subject: ${snapshot.subject.current_subject} (confidence ${snapshot.subject.confidence.toFixed(2)})`)
    }
    if (snapshot.summaryTailMd) {
      parts.push(`Session summary so far:\n${snapshot.summaryTailMd}`)
    }
    if (snapshot.latestRelevantScreenshot) {
      const s = snapshot.latestRelevantScreenshot
      const tsLabel = new Date(s.ts).toISOString().slice(11, 19)
      parts.push(`Most recent relevant on-screen content (caption only, ts=${tsLabel}, relevance=${s.relevance_score.toFixed(2)}): ${s.caption}`)
    }
    if (parts.length === 0) return request
    const brainBlock = `## Session Brain\n${parts.join('\n\n')}`
    const merged = request.recallContext ? `${brainBlock}\n\n${request.recallContext}` : brainBlock
    return { ...request, recallContext: merged }
  } catch (err) {
    console.warn('[SessionBrain] context injection failed:', err)
    return request
  }
}

async function generateAnswer(request: LLMRequest, source: AnswerSource = 'transcript'): Promise<void> {
  if (!sessionRuntimeStore.llmService) return
  if (!beginAgentTask(request.question.slice(0, 120) || 'answer generation')) {
    notifyAgentBusy()
    return
  }
  sessionRuntimeStore.lastRequestedQuestion = request.question
  try {
    sessionRuntimeStore.currentModelSelection = resolveModel(source, request.question)
    sessionRuntimeStore.llmService.setModel(sessionRuntimeStore.currentModelSelection.modelId)
    beginAnswerStream(request.question, sessionRuntimeStore.currentModelSelection)

    const resolvedPersonality = heartbeatService.getResolvedPersonality()
    const requestWithBrain = await injectBrainContext(request)

    const requestWithTools: LLMRequest = {
      ...requestWithBrain,
      tools: getAnswerPipelineToolDefinitions(),
      toolChoiceMode: 'auto',
      executeToolCall: createToolExecutor({
        recallService,
        memoryStore,
        artifactStore,
        getSessionContextSummary: buildSessionContextSummary,
        analyzeCurrentScreen: analyzeCurrentScreenOnce,
        copyToClipboard: (text: string) => clipboard.writeText(text),
        openArtifactById: openArtifactById,
        previewArtifactById: previewArtifactById,
        getCurrentTaskSummary: buildCurrentTaskSummary,
        getLatestAnswerSnapshot: getLatestAnswerSnapshot,
        openAnswerWindow: showAgentAnswerWindow,
        solveWithOpenRouter: delegateComplexOpenRouterAnswer,
        searchWeb: async (query, limit) => {
          const result = await webSearchService.search(query, limit)
          addWebSourceAttachments(result)
          return result
        },
        generateImage: async (params) => {
          const result = await generateImageArtifact(params, { preview: false })
          addGeneratedImageAttachment(
            result.absolutePath,
            typeof params.prompt === 'string' ? params.prompt.slice(0, 200) : undefined,
            result.mimeType
          )
          return result
        },
        requestApproval,
        sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
        getLastEventTimestamp: () => lastSessionActivityAt,
        callVaultTool: callVaultToolGuarded,
      }),
      soulPrompt: heartbeatService.getSoulPrompt(),
      personalityFragment: resolvedPersonality.systemPromptFragment,
    }

    await sessionRuntimeStore.llmService.generateAnswer(requestWithTools)
  } finally {
    endAgentTask()
  }
}

function shouldUseScreenOnlyAnswer(question: string): boolean {
  return isExplicitScreenInspectionQuestion(question)
}

async function runManualAnswer(question: string): Promise<boolean> {
  markSessionActivity()
  if (isAgentTaskBusy()) {
    notifyAgentBusy()
    return false
  }
  const prepared = await answerRequestService.buildManualAnswerRequest({
    question,
    llmService: sessionRuntimeStore.llmService,
    sessionTranscript: sessionRuntimeStore.sessionTranscript,
    answerHistory: sessionRuntimeStore.currentSessionAnswers,
    userContext: contextManager.getContext(),
    sessionContext: contextManager.getSessionContext(),
    fileContext: sessionRuntimeStore.currentFileContext,
    answerLanguage: getAnswerLanguage(),
    baseRecallContext: sessionRuntimeStore.currentSessionRecallContext,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
    sessionId: getCurrentSessionId(),
    noiseTokens: RECALL_QUERY_NOISE_TOKENS,
    memoryPipeline,
  })
  if (!prepared) return false

  sessionRuntimeStore.lastAnswerRecallQuestion = prepared.preparedQuestion
  sessionRuntimeStore.lastAnswerRecallContext = prepared.recallContext
  sessionRuntimeStore.lastRuntimeRecallUpdatedAt = prepared.recallContext ? Date.now() : sessionRuntimeStore.lastRuntimeRecallUpdatedAt
  sessionRuntimeStore.lastGeneratedQuestion = prepared.normalizedQuestion
  sessionRuntimeStore.lastGeneratedPromptTranscriptCount = prepared.promptTranscriptCount
  if (shouldUseScreenOnlyAnswer(prepared.preparedQuestion)) {
    await runCurrentScreenAnswer(prepared.preparedQuestion)
    return true
  }
  await generateAnswer(prepared.request, 'manual')
  return true
}

function getRuntimeRecallDebugState(): RuntimeRecallDebugState {
  return sessionStateService.buildRuntimeRecallDebugState({
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
    sessionRecallContext: sessionRuntimeStore.currentSessionRecallContext || undefined,
    lastAnswerQuestion: sessionRuntimeStore.lastAnswerRecallQuestion || undefined,
    lastAnswerRecallContext: sessionRuntimeStore.lastAnswerRecallContext || undefined,
    lastScreenshotTrigger: sessionRuntimeStore.lastScreenshotRecallTrigger || undefined,
    lastScreenshotRecallContext: sessionRuntimeStore.lastScreenshotRecallContext || undefined,
    updatedAt: sessionRuntimeStore.lastRuntimeRecallUpdatedAt,
  })
}

function getCurrentSessionId(): string | undefined {
  return sessionRuntimeStore.getCurrentSessionId()
}

let heartbeatTriggerTimer: NodeJS.Timeout | null = null

// Heartbeat trigger debounce — adaptive based on whether the user's last
// finalized turn looks like a complete thought.
//
//  - "Open" debounce: the latest final ended mid-thought (no
//    sentence terminator like . ! ?), so the user is probably still talking.
//  - "Closed" debounce: the latest final ended with terminator
//    punctuation or a question form. The user finished their turn —
//    respond quickly so the conversation feels live.
// Debounce before firing a triggered heartbeat tick. CLOSED = the last
// finalized line looks like a complete sentence (ended on . ! ? etc) so we
// can react fast. OPEN = the speaker is probably mid-thought, give them a
// beat to keep going before we reply.
const HEARTBEAT_TRIGGER_DEBOUNCE_OPEN_MS = 2400
const HEARTBEAT_TRIGGER_DEBOUNCE_CLOSED_MS = 350

type TurnBoundaryClass = 'closed' | 'open-clause' | 'fragment' | 'continuation'

interface TurnBoundaryDecision {
  kind: TurnBoundaryClass
  reason: 'closed' | 'open-clause' | 'fragment' | 'acknowledgement'
}

function looksLikeSentenceEnd(text: string): boolean {
  return classifyTurnBoundary(text).kind === 'closed'
}

function classifyTurnBoundary(text: string): TurnBoundaryDecision {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'fragment', reason: 'fragment' }
  const normalized = trimmed.toLowerCase().replace(/[^\w\s?']/g, ' ').replace(/\s+/g, ' ').trim()
  const words = normalized.split(/\s+/).filter(Boolean)
  if (isShortAcknowledgement(normalized)) return { kind: 'continuation', reason: 'acknowledgement' }
  if (words.length < 3 && trimmed.length < 18) return { kind: 'fragment', reason: 'fragment' }

  // Terminator punctuation — Deepgram smart_format inserts these on
  // detected sentence boundaries.
  if (/[!?]$/.test(trimmed)) return { kind: 'closed', reason: 'closed' }
  if (/[.]$/.test(trimmed) && !looksLikeOpenClause(normalized)) return { kind: 'closed', reason: 'closed' }

  // The latest final turn looks open-ended. Deepgram often finalizes a
  // partial request like "Can you check the bonus" before the user adds
  // "iteration five on my screen", so modal request starters wait longer.
  if (looksLikeOpenClause(normalized)) return { kind: 'open-clause', reason: 'open-clause' }
  if (words.length < 5 && !/[.!?]$/.test(trimmed)) return { kind: 'fragment', reason: 'fragment' }
  return { kind: 'open-clause', reason: 'open-clause' }
}

function looksLikeOpenClause(normalized: string): boolean {
  if (/(?:\b(and|or|but|because|so|then|when|while|before|after|with|without|for|to|about|on|in|at|from|that|which|where|if)\s*)$/.test(normalized)) {
    return true
  }
  if (/^(can|could|would|should)\s+you\b/.test(normalized) && !/[?]$/.test(normalized)) {
    return true
  }
  if (/^(i want|i need|i would like|let me|we need|we should|please)\b/.test(normalized) && !/[.!?]$/.test(normalized)) {
    return true
  }
  return false
}

function isShortAcknowledgement(normalized: string): boolean {
  return /^(ok|okay|cool|correct|right|yes|yeah|yep|thanks|thank you|got it|it works|it's working|its working|perfect|great|nice)(?:\s|$)/.test(normalized) &&
    normalized.split(/\s+/).filter(Boolean).length <= 6
}

function scheduleHeartbeatTrigger(): void {
  // Don't trigger on transcript fragments. Deepgram finalizes mid-sentence
  // chunks ("I'm not", "going pretty smooth", "For your answers") on natural
  // pauses; replying to each one floods the bubble with noise and burns the
  // cooldown on incomplete thoughts. Wait for a finalized line of meaningful
  // length to decide whether it's worth a tick.
  const lastFinal = [...sessionRuntimeStore.sessionTranscript]
    .reverse()
    .find((entry) => entry.isFinal && entry.speaker === 'user')
  if (lastFinal) {
    const boundary = classifyTurnBoundary(lastFinal.text)
    if (boundary.kind === 'fragment' || boundary.kind === 'continuation') {
      // Too short to be a meaningful turn — let the next final or the polling
      // tick pick it up if context accumulates.
      telemetry.record('trigger.dropped', {
        reason: boundary.reason,
        boundaryClass: boundary.kind,
        wordCount: lastFinal.text.trim().split(/\s+/).filter(Boolean).length,
        chars: lastFinal.text.trim().length,
        text: lastFinal.text.trim().slice(0, 80),
      })
      return
    }
  }

  const boundary = lastFinal ? classifyTurnBoundary(lastFinal.text) : null
  const delayMs = boundary?.kind === 'closed'
    ? HEARTBEAT_TRIGGER_DEBOUNCE_CLOSED_MS
    : HEARTBEAT_TRIGGER_DEBOUNCE_OPEN_MS

  // Telemetry — so we can see in the JSONL which debounce mode triggered
  // and tune the thresholds based on real sessions.
  telemetry.record('trigger.scheduled', {
    delayMs,
    sentenceEnd: boundary?.kind === 'closed',
    boundaryClass: boundary?.kind ?? null,
    lastFinalPreview: lastFinal?.text.slice(0, 80) ?? null,
  })

  if (heartbeatTriggerTimer) clearTimeout(heartbeatTriggerTimer)
  heartbeatTriggerTimer = setTimeout(() => {
    heartbeatTriggerTimer = null
    heartbeatService.triggerTick()
  }, delayMs)
}

function handleTranscriptEntry(
  entry: TranscriptEntry,
  options: { suppressHeartbeat?: boolean } = {}
): void {
  sessionRuntimeStore.sessionTranscript = sessionStateService.handleTranscriptEntry({
    entry,
    transcript: sessionRuntimeStore.sessionTranscript,
    maxTranscriptEntries: MAX_TRANSCRIPT_ENTRIES,
    getCurrentSessionId,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
    recordTranscriptFinalized: (finalEntry, sessionId, sessionFolderName) => {
      memoryPipeline.recordEvent({
        type: 'transcript.finalized',
        source: 'transcription',
        createdAt: finalEntry.timestamp,
        sessionId,
        sessionFolderName,
        payload: {
          entry: finalEntry,
        },
      })
    },
    publishTranscriptUpdate: (updatedEntry) => {
      sendToOverlay(IPC.TRANSCRIPT_UPDATE, updatedEntry)
      sendToAnswer(IPC.TRANSCRIPT_UPDATE, updatedEntry)
      sendToPreview(IPC.TRANSCRIPT_UPDATE, updatedEntry)
      sendToCanvas(IPC.TRANSCRIPT_UPDATE, updatedEntry)
    },
  })

  sendToOverlay('stt:activity')

  if (entry.isFinal) {
    markSessionActivity()
    const transcriptIsAgentOutput = entry.speaker === 'unknown' && entry.audioSource === 'chat'
    const shouldNotifyHeartbeat = !options.suppressHeartbeat && !transcriptIsAgentOutput
    // Feed the shared dialog log so heartbeat / answer pipeline see real
    // turn-taking. Both user transcript and typed chat input land here.
    conversationLog.append({
      role: transcriptIsAgentOutput ? 'agent' : 'user',
      source: entry.source === 'chat' ? 'chat' : 'transcript',
      text: entry.text,
      triggeredBy: entry.id,
    })
    // Barge-in: the user said something new while the agent is mid-reply.
    // Drop the now-stale reply (and its TTS) immediately rather than letting
    // it finish narrating — the debounced re-trigger below produces a fresh
    // one. Only for the user's own voice/chat, not the speaker channel.
    if (entry.speaker === 'user' && heartbeatService.isTickInFlight()) {
      heartbeatService.abortInFlightTick()
      stopCompanionVoiceOutput()
    }
    // Keep the "chime in unprompted" timer tracking the last activity. In
    // Companion mode triggerTick (below) also runs and re-arms; in Session
    // mode this is the only thing that keeps proactive nudges alive now that
    // the old metronome poll is gone.
    if (shouldNotifyHeartbeat) {
      heartbeatService.notifyActivity()
    }
    const handledReportRequest = entry.speaker === 'user' && maybeHandleSessionReportRequest(entry)
    if (shouldNotifyHeartbeat && !handledReportRequest) {
      scheduleHeartbeatTrigger()
    }
  }
}

function isSessionReportRequest(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  const asksForReport = /\breport\b/.test(normalized)
  const asksToWrite = /\b(write|save|create|generate|make|draft|add|put)\b/.test(normalized)
  const scopesToSessionNotes = /\b(session|conversation|notes?|note)\b/.test(normalized)
  return asksForReport && asksToWrite && scopesToSessionNotes
}

function maybeHandleSessionReportRequest(entry: TranscriptEntry): boolean {
  if (!isSessionReportRequest(entry.text)) return false

  const report = createSessionReportArtifact(entry.text)
  sessionRuntimeStore.currentSessionReport = report

  const confirmation = 'Saved report to notes.md: Session Report.'
  sessionRuntimeStore.currentSessionAnswers.push({
    question: entry.text.trim(),
    answer: confirmation,
    timestamp: Date.now(),
    routingReason: 'session-report-artifact',
  })
  conversationLog.append({
    role: 'agent',
    source: 'bubble',
    text: confirmation,
    triggeredBy: entry.id,
  })
  widgetManager.register({
    type: 'bubble',
    props: { message: confirmation, urgency: 'low', expandable: false },
    ttl: 4500,
  })
  telemetry.record('session.report.saved', {
    title: report.title,
    sourceRequest: entry.text.trim().slice(0, 160),
  })
  return true
}

function createSessionReportArtifact(sourceRequest: string): SessionReport {
  const now = Date.now()
  const sessionContext = contextManager.getSessionContext()
  const transcript = sessionRuntimeStore.sessionTranscript.filter((entry) => entry.isFinal)
  const answers = sessionRuntimeStore.currentSessionAnswers
  const studyNotes = sessionRuntimeStore.sessionBrain?.readStudyNotesSnapshot() ?? null
  const durationSeconds = sessionRuntimeStore.currentSessionStartTime
    ? Math.max(1, Math.round((now - sessionRuntimeStore.currentSessionStartTime) / 1000))
    : 0
  const title = 'Session Report'
  const subject = sessionContext.subject?.trim() || sessionContext.companyName?.trim() || 'Current session'
  const lines: string[] = [
    '### Overview',
    `- Subject: ${subject}`,
    `- Intent: ${sessionContext.sessionIntent || 'quick-help'}`,
    `- Duration so far: ${formatReportDuration(durationSeconds)}`,
    `- Transcript entries: ${transcript.length}`,
    `- Answers captured: ${answers.length}`,
    '',
  ]

  const keyPoints = studyNotes?.sections.key_points?.slice(-4) ?? []
  if (keyPoints.length > 0) {
    lines.push('### Key Points')
    for (const point of keyPoints) {
      lines.push(`- ${point.text}`)
    }
    lines.push('')
  }

  const codeShown = studyNotes?.sections.code_shown?.slice(-3) ?? []
  if (codeShown.length > 0) {
    lines.push('### Code / Exercises')
    for (const item of codeShown) {
      lines.push(`- ${item.text}`)
    }
    lines.push('')
  }

  const recentAnswers = answers.slice(-4)
  if (recentAnswers.length > 0) {
    lines.push('### Recent Answers')
    for (const answer of recentAnswers) {
      lines.push(`- ${answer.question.trim() || 'User prompt'}: ${answer.answer.trim().replace(/\s+/g, ' ').slice(0, 280)}`)
    }
    lines.push('')
  }

  const recentTranscript = transcript.slice(-12)
  if (recentTranscript.length > 0) {
    lines.push('### Recent Transcript')
    for (const turn of recentTranscript) {
      lines.push(`- [${formatReportTime(turn.timestamp)}] ${turn.speaker}: ${turn.text.trim().replace(/\s+/g, ' ').slice(0, 260)}`)
    }
    lines.push('')
  }

  lines.push('### Source Request')
  lines.push(sourceRequest.trim())

  return {
    title,
    createdAt: now,
    sourceRequest: sourceRequest.trim(),
    markdown: lines.join('\n').trim(),
  }
}

function formatReportTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatReportDuration(seconds: number): string {
  if (!seconds) return 'unknown'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes <= 0) return `${remainder}s`
  return `${minutes}m ${remainder}s`
}

function isAnswerCandidateText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 4 || words.length > 70) return false
  if (normalized.endsWith('?')) return true

  const fillerPhrases = [
    'got it', 'sounds good', 'perfect', 'alright', 'okay',
    'good answer', 'great answer', 'nice work', 'thanks',
    'thank you', 'i see', 'that makes sense', 'interesting',
    'let me', 'moving on', 'so next', 'one moment',
  ]
  if (fillerPhrases.some((phrase) => normalized.startsWith(phrase))) return false

  const starters = [
    'what', 'why', 'how', 'when', 'where', 'which',
    'tell me', 'walk me', 'can you', 'could you', 'would you',
    'describe', 'explain', 'give me', 'talk about', 'share',
    'have you', 'do you', 'did you', 'are you', 'were you',
    'is there', 'was there',
  ]
  if (starters.some((starter) => normalized.startsWith(starter))) return true

  return [
    /\b(can|could) someone\b/,
    /\bdoes anyone\b/,
    /\bthe question is\b/,
    /\bmy question is\b/,
    /\bi (?:would )?like to understand\b/,
    /\bi wonder\b/,
    /\blet'?s (?:discuss|talk through|compare|review)\b/,
    /\bwe (?:need|should|have) to (?:answer|explain|decide|figure out|understand|compare)\b/,
    /\bhelp me understand\b/,
    /\bwhat about\b/,
    /\bdefine\b/,
    /\bderive\b/,
    /\bcalculate\b/,
    /\bsolve\b/,
  ].some((pattern) => pattern.test(normalized))
}

function broadcastSessionState(): void {
  sessionStateService.broadcastSessionState({
    isActive: sessionRuntimeStore.isSessionActive,
    isPaused: sessionRuntimeStore.isSessionPaused,
    startTime: sessionRuntimeStore.currentSessionStartTime,
    micEnabled: getMicEnabled(),
    answerWindowVisible: Boolean(getAnswerWindow()?.isVisible()),
    liveAgentMode: liveAgentMode(),
    liveAgentCaptionsEnabled: isLiveAgentCaptionsEnabled(),
    companionEngine: modeConfig.getCompanionModeConfig().engine,
    companionRealtimeStatus: sessionRuntimeStore.companionRealtimeStatus,
    sessionIntent: contextManager.getSessionContext().sessionIntent || 'session',
    publishSessionState: (sessionState) => {
      sendToOverlay(IPC.SESSION_STATE, sessionState)
      sendToAnswer(IPC.SESSION_STATE, sessionState)
      sendToSettings(IPC.SESSION_STATE, sessionState)
      sendToPreview(IPC.SESSION_STATE, sessionState)
      sendToCanvas(IPC.SESSION_STATE, sessionState)
    },
  })
}

function showAnswerSurfaceWindow(): void {
  showAnswerWindow({ force: isCompanionMode(currentAgentMode()) })
}

function beginAnswerStream(question: string, modelSelection: ModelSelectionInfo): void {
  resetPendingAnswerAttachments()
  sessionStateService.beginAnswerStream({
    question,
    modelSelection,
    showAnswerWindow: showAnswerSurfaceWindow,
    publishQuestion: (nextQuestion) => {
      heartbeatService.setPresenceState('speaking')
      sendSessionQuestion(nextQuestion)
    },
    publishModelSelection: (selection) => {
      sendSessionModelSelection(selection)
    },
    publishChunk: (value) => {
      sendSessionAnswerChunk(value)
    },
    broadcastSessionState,
  })
}

function streamAnswerChunk(fullAnswer: string): void {
  sessionStateService.streamAnswerChunk({
    fullAnswer,
    showAnswerWindow: showAnswerSurfaceWindow,
    publishChunk: (value) => {
      sendSessionAnswerChunk(value)
    },
  })
}

function completeAnswerStream(answer: string, question: string): void {
  const completed = sessionStateService.completeAnswerStream({
    answer,
    question,
    currentAnswers: sessionRuntimeStore.currentSessionAnswers,
    modelSelection: sessionRuntimeStore.currentModelSelection,
    completedAt: Date.now(),
    showAnswerWindow: showAnswerSurfaceWindow,
    publishDone: (value) => {
      sendSessionAnswerDone({
        text: value,
        attachments: pendingAnswerAttachments.length ? [...pendingAnswerAttachments] : undefined,
      })
      if (sessionRuntimeStore.isSessionActive) {
        heartbeatService.setPresenceState('listening')
      }
    },
    broadcastSessionState,
  })
  sessionRuntimeStore.currentSessionAnswers = completed.answers
  sessionRuntimeStore.lastAnswerCompletedAt = completed.completedAt

  // Feed the shared dialog log so a subsequent heartbeat tick (or chat
  // follow-up like "make it shorter") sees the answer-window output as a
  // real assistant turn — no more "two amnesiac surfaces" effect.
  const trimmedAnswer = answer.trim()
  if (trimmedAnswer && sessionRuntimeStore.isSessionActive) {
    conversationLog.append({
      role: 'agent',
      source: 'answer-window',
      text: trimmedAnswer,
    })
  }
}

function showAgentAnswerWindow(title: string, content: string): void {
  const cleanTitle = title.trim()
  const cleanContent = content.trim()
  if (!cleanTitle || !cleanContent) return

  markSessionActivity()
  sessionRuntimeStore.currentModelSelection = {
    modelId: 'openrouter-companion',
    reason: 'Companion detailed answer',
  }
  sessionRuntimeStore.lastRequestedQuestion = cleanTitle
  beginAnswerStream(cleanTitle, sessionRuntimeStore.currentModelSelection)
  completeAnswerStream(cleanContent, cleanTitle)
}

async function delegateComplexOpenRouterAnswer(question: string): Promise<string> {
  const cleanQuestion = question.trim()
  if (!cleanQuestion) return 'OpenRouter delegation skipped: question is empty.'

  markSessionActivity()
  const started = await runManualAnswer(cleanQuestion)
  return started
    ? `OpenRouter completed the detailed answer for "${cleanQuestion}".`
    : 'OpenRouter delegation could not start because another answer task is active.'
}

function reportAnswerError(error: Error): void {
  sessionStateService.reportAnswerError({
    error,
    publishDone: (value) => {
      sendSessionAnswerDone(value)
      if (sessionRuntimeStore.isSessionActive) {
        heartbeatService.setPresenceState('listening')
      }
    },
  })
}

function deepgramKeyFromConfig(): string {
  return (getSecureKey('deepgramApiKey') || process.env.DEEPGRAM_API_KEY || '') as string
}

function resolveModel(source: AnswerSource, question: string): ModelSelectionInfo {
  const answerModels = modeConfig.getAnswerModelConfig()
  const defaultModel = answerModels.defaultModel || process.env.DEFAULT_MODEL || DEFAULT_MODEL
  const codingModel = answerModels.codingModel || ''
  const autoModelSelection = configStore.get('autoModelSelection', false) as boolean

  return selectModel({
    autoModelSelection,
    source,
    question,
    defaultModel,
    codingModel,
  })
}

function getMicEnabled(): boolean {
  return configStore.get('micEnabled', true) as boolean
}

function getAnswerLanguage(): string {
  const code = configStore.get('sttLanguage', 'en') as string
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name || 'English'
}

async function getFreshLocalVisionContext(): Promise<VisionCortexResult | null> {
  const summary = sessionRuntimeStore.latestScreenSummary.trim()
  const capturedAt = sessionRuntimeStore.latestScreenSummaryCapturedAt
  if (!summary || !capturedAt) return null
  if (Date.now() - capturedAt > PROACTIVE_SCREEN_CAPTURE_INTERVAL_MS * 2) return null

  return {
    provider: 'openrouter',
    summary,
    visibleText: [],
    uiHints: [],
    confidence: 'medium',
    latencyMs: 0,
    shouldEscalate: false,
  }
}

function markSessionActivity(): void {
  lastSessionActivityAt = Date.now()
}

function getEffectiveInterruptionPolicy(): InterruptionPolicy {
  const basePolicy = heartbeatService.getInterruptionPolicy()
  const msSinceLastEvent = lastSessionActivityAt > 0 ? Date.now() - lastSessionActivityAt : Number.POSITIVE_INFINITY
  return resolveAutoPolicy(basePolicy, msSinceLastEvent)
}

async function captureProactiveScreenSummary(): Promise<void> {
  const openrouterKey = (getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '') as string
  if (!openrouterKey) return

  const { imageBase64 } = await screenshotAnalysisService.captureAndPersistScreenshot({
    isSessionActive: sessionRuntimeStore.isSessionActive,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName,
    getCurrentSessionId,
    saveScreenshot: (folderName, screenshotBase64) =>
      contextManager.saveScreenshot(folderName, screenshotBase64),
    onScreenshotSaved: (filename) => {
      sessionRuntimeStore.currentSessionScreenshots.push(filename)
    },
  })

  const profile = contextManager.getProfile()
  const sessionCtx = contextManager.getSessionContext()
  const recallContext = await buildScreenshotRecallContext('proactive screen tracking', sessionCtx, {
    recallService,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
    noiseTokens: RECALL_QUERY_NOISE_TOKENS,
    baseRecallContext: sessionRuntimeStore.currentSessionRecallContext,
    transcriptEntries: sessionRuntimeStore.sessionTranscript,
  })
  const screenModel = resolveModel('screen-analysis', 'proactive screen tracking')
  const llm = new LLMService(openrouterKey, screenModel.modelId)
  const summary = await llm.analyzeScreenshotOnce(
    imageBase64,
    profile,
    sessionCtx,
    recallContext,
    getAnswerLanguage(),
    'Provide a short factual internal summary of what is currently visible on screen. Mention the main app, current task, and any obvious errors or code editors. Do not invent details and keep it under 120 words.'
  )

  sessionRuntimeStore.latestScreenSummary = summary.trim().slice(0, 600)
  sessionRuntimeStore.latestScreenSummaryCapturedAt = Date.now()
}

async function maybeRefreshProactiveScreenContext(force = false): Promise<void> {
  if (!sessionRuntimeStore.isSessionActive) return
  if (proactiveScreenCaptureInFlight) return
  if (isAgentTaskBusy()) return
  if (!force && getEffectiveInterruptionPolicy() !== 'proactive') return
  if (!force && companionVoiceSpeaking) return

  const lastCaptureAt = sessionRuntimeStore.latestScreenSummaryCapturedAt ?? 0
  if (!force && Date.now() - lastCaptureAt < PROACTIVE_SCREEN_CAPTURE_INTERVAL_MS) {
    return
  }

  proactiveScreenCaptureInFlight = true
  try {
    await captureProactiveScreenSummary()
  } catch (error) {
    console.error('[ProactiveScreen] Failed to refresh screen context:', error)
  } finally {
    proactiveScreenCaptureInFlight = false
  }
}

function startProactiveScreenObserver(): void {
  if (proactiveScreenObserverTimer) return
  proactiveScreenObserverTimer = setInterval(() => {
    void maybeRefreshProactiveScreenContext()
  }, PROACTIVE_SCREEN_CAPTURE_INTERVAL_MS)
}

function stopProactiveScreenObserver(): void {
  if (!proactiveScreenObserverTimer) return
  clearInterval(proactiveScreenObserverTimer)
  proactiveScreenObserverTimer = null
}

function isExplicitScreenInspectionQuestion(question: string): boolean {
  const normalized = question.trim().toLowerCase()
  if (!normalized) return false

  return [
    /what do you see/,
    /what can you see/,
    /what(?:'s| is) on (?:my|the) screen/,
    /look at (?:my|the) screen/,
    /check (?:my|the) screen/,
    /describe (?:my|the) screen/,
    /can you see (?:my|the) screen/,
    /what do you notice on (?:my|the) screen/,
    /what error (?:do you|can you) see/,
    /read (?:what(?:'s| is) )?on (?:my|the) screen/,
  ].some((pattern) => pattern.test(normalized))
}

async function analyzeCurrentScreenOnce(question?: string): Promise<string> {
  const config = readLocalAiConfig()
  const openrouterKey = (getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '') as string
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured')
  }
  if (config.mode === 'local-only' && config.localOnlyBlocksCloudVision) {
    return cloudVisionUnavailableMessage()
  }

  const { imageBase64 } = await screenshotAnalysisService.captureAndPersistScreenshot({
    isSessionActive: sessionRuntimeStore.isSessionActive,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName,
    getCurrentSessionId,
    saveScreenshot: (folderName, screenshotBase64) =>
      contextManager.saveScreenshot(folderName, screenshotBase64),
    onScreenshotSaved: (filename) => {
      sessionRuntimeStore.currentSessionScreenshots.push(filename)
    },
  })

  const profile = contextManager.getProfile()
  const sessionCtx = contextManager.getSessionContext()
  const recallContext = await buildScreenshotRecallContext(question || 'Current screen', sessionCtx, {
    recallService,
    sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
    noiseTokens: RECALL_QUERY_NOISE_TOKENS,
    baseRecallContext: sessionRuntimeStore.currentSessionRecallContext,
    transcriptEntries: sessionRuntimeStore.sessionTranscript,
  })
  const screenModel = resolveModel('screen-analysis', question || '')
  const llm = new LLMService(openrouterKey, screenModel.modelId)
  const answer = await llm.analyzeScreenshotOnce(
    imageBase64,
    profile,
    sessionCtx,
    recallContext,
    getAnswerLanguage(),
    question
  )
  sessionRuntimeStore.latestScreenSummary = answer.trim().slice(0, 600)
  sessionRuntimeStore.latestScreenSummaryCapturedAt = Date.now()
  return answer
}

async function runCurrentScreenAnswer(question: string): Promise<void> {
  markSessionActivity()
  if (!beginAgentTask(question.slice(0, 120) || 'screen analysis')) {
    notifyAgentBusy('I am still working on the current request. I will not start screen analysis yet.')
    return
  }

  try {
    const config = readLocalAiConfig()
    const { imageBase64 } = await screenshotAnalysisService.captureAndPersistScreenshot({
      isSessionActive: sessionRuntimeStore.isSessionActive,
      sessionFolderName: sessionRuntimeStore.currentSessionFolderName,
      getCurrentSessionId,
      saveScreenshot: (folderName, screenshotBase64) =>
        contextManager.saveScreenshot(folderName, screenshotBase64),
      onScreenshotSaved: (filename) => {
        sessionRuntimeStore.currentSessionScreenshots.push(filename)
      },
    })

    if (config.mode === 'local-only' && config.localOnlyBlocksCloudVision) {
      sessionRuntimeStore.currentModelSelection = {
        modelId: 'cloud-vision-blocked',
        reason: 'Local-only mode blocks raw screenshot upload to cloud.',
      }
      sessionRuntimeStore.lastRequestedQuestion = question
      beginAnswerStream(question, sessionRuntimeStore.currentModelSelection)
      completeAnswerStream(cloudVisionUnavailableMessage(), question)
      return
    }

    const profile = contextManager.getProfile()
    const sessionCtx = contextManager.getSessionContext()
    const openrouterKey = (getSecureKey('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '') as string
    const screenModel = resolveModel('screen-analysis', question)

    if (!openrouterKey) {
      throw new Error('OpenRouter API key not configured')
    }

    sessionRuntimeStore.currentModelSelection = screenModel
    sessionRuntimeStore.lastRequestedQuestion = question
    beginAnswerStream(question, sessionRuntimeStore.currentModelSelection)

    const screenshotRecallContext = await buildScreenshotRecallContext(question, sessionCtx, {
      recallService,
      sessionFolderName: sessionRuntimeStore.currentSessionFolderName || undefined,
      noiseTokens: RECALL_QUERY_NOISE_TOKENS,
      baseRecallContext: sessionRuntimeStore.currentSessionRecallContext,
      transcriptEntries: sessionRuntimeStore.sessionTranscript,
    })

    sessionRuntimeStore.lastScreenshotRecallTrigger = question
    sessionRuntimeStore.lastScreenshotRecallContext = screenshotRecallContext
    sessionRuntimeStore.lastRuntimeRecallUpdatedAt = screenshotRecallContext
      ? Date.now()
      : sessionRuntimeStore.lastRuntimeRecallUpdatedAt

    sessionRuntimeStore.llmService = await screenshotAnalysisService.analyzeScreenshot({
      openrouterKey,
      llmService: sessionRuntimeStore.llmService,
      modelSelection: screenModel,
      imageBase64,
      profile,
      sessionCtx,
      recallContext: screenshotRecallContext,
      answerLanguage: getAnswerLanguage(),
      question,
      onChunk: (fullAnswer) => {
        streamAnswerChunk(fullAnswer)
      },
      onDone: (answer) => {
        sessionRuntimeStore.latestScreenSummary = answer.trim().slice(0, 600)
        sessionRuntimeStore.latestScreenSummaryCapturedAt = Date.now()
        completeAnswerStream(answer, question)
      },
      onError: (error) => {
        reportAnswerError(error)
      },
    })
  } finally {
    endAgentTask()
  }
}

function buildScreenAnalysisQuestion(): string {
  const sessionIntent = contextManager.getSessionContext().sessionIntent || 'session'
  const latestQuestion = getLatestQuestionCandidate(
    sessionRuntimeStore.sessionTranscript,
    sessionRuntimeStore.lastGeneratedPromptTranscriptCount,
    true,
    sessionIntent
  )
  if (latestQuestion) {
    return `Screen context: ${shortenAnswerTitle(latestQuestion)}`
  }

  const latestTranscript = [...sessionRuntimeStore.sessionTranscript]
    .reverse()
    .find((entry) => entry.isFinal && entry.speaker !== 'user' && !isLowSignalScreenTitle(entry.text))
  if (latestTranscript?.text) {
    return `Screen context: ${shortenAnswerTitle(latestTranscript.text)}`
  }

  return 'Screen Analysis'
}

function shortenAnswerTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 96) return cleaned
  return `${cleaned.slice(0, 93).trim()}...`
}

function isLowSignalScreenTitle(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return true
  if (normalized.split(/\s+/).length < 4) return true
  return /^(?:okay|alright|cool|thanks|thank you|yeah|so|well)[\s.!,]*$/.test(normalized)
}

async function openArtifactById(artifactId: string): Promise<{ success: true; fallback?: 'folder' }> {
  const artifact = artifactStore.getById(artifactId)
  if (!artifact) {
    throw new Error('Artifact not found')
  }

  const targetResult = await shell.openPath(artifact.absolutePath)
  if (!targetResult) {
    return { success: true }
  }

  const folderResult = await shell.openPath(path.dirname(artifact.absolutePath))
  if (!folderResult) {
    return { success: true, fallback: 'folder' }
  }

  throw new Error(targetResult || folderResult || 'Failed to open artifact')
}

function broadcastPreviewWindowItems(): void {
  const previewWindow = getPreviewWindow()
  if (!previewWindow || previewWindow.isDestroyed()) return
  previewWindow.webContents.send(IPC.PREVIEW_ITEMS_UPDATED, previewWindowItems)
}

function upsertPreviewWindowItem(item: PreviewWindowItem): void {
  previewWindowItems = previewWindowItems.filter((existing) => existing.id !== item.id)
  previewWindowItems = [...previewWindowItems, item].slice(-8)
  broadcastPreviewWindowItems()
}

function buildPreviewItemFromArtifact(artifactId: string): PreviewWindowItem | null {
  const artifact = artifactStore.getById(artifactId)
  if (!artifact) {
    throw new Error('Artifact not found')
  }
  if (!fs.existsSync(artifact.absolutePath)) {
    throw new Error('Artifact file is missing on disk')
  }

  const ext = path.extname(artifact.absolutePath).toLowerCase()
  const title = path.basename(artifact.absolutePath)
  const sourceLabel = artifact.relativePath || artifact.absolutePath
  const imageMimeTypeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  }

  if (
    artifact.mimeType?.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)
  ) {
    const mimeType = artifact.mimeType || imageMimeTypeByExt[ext] || 'image/jpeg'
    const imageBase64 = fs.readFileSync(artifact.absolutePath).toString('base64')
    return {
      id: artifact.id,
      title,
      kind: 'image',
      imageUrl: `data:${mimeType};base64,${imageBase64}`,
      mimeType,
      sourceLabel,
    }
  }

  if (artifact.mimeType === 'application/pdf' || ext === '.pdf') {
    return {
      id: artifact.id,
      title,
      kind: 'pdf',
      pdfBase64: fs.readFileSync(artifact.absolutePath).toString('base64'),
      mimeType: artifact.mimeType || 'application/pdf',
      sourceLabel,
    }
  }

  if (
    [
      '.txt', '.md', '.markdown', '.json', '.log', '.js', '.ts', '.tsx', '.jsx',
      '.py', '.java', '.go', '.rs', '.sql', '.html', '.css', '.xml', '.yaml', '.yml',
    ].includes(ext) ||
    artifact.type !== 'screenshot.image'
  ) {
    const raw = fs.readFileSync(artifact.absolutePath, 'utf-8')
    const content = ext === '.json' ? `\`\`\`json\n${raw}\n\`\`\`` : raw
    return {
      id: artifact.id,
      title,
      kind: 'text',
      content,
      mimeType: artifact.mimeType || 'text/plain',
      sourceLabel,
    }
  }

  return null
}

async function previewArtifactById(artifactId: string): Promise<{ success: true; fallback?: 'external' }> {
  const previewItem = buildPreviewItemFromArtifact(artifactId)
  if (!previewItem) {
    await openArtifactById(artifactId)
    return { success: true, fallback: 'external' }
  }

  upsertPreviewWindowItem(previewItem)
  showPreviewWindow()
  return { success: true }
}

function saveCurrentSession(studyNotes?: StudyNotesSnapshot | null): void {
  if (!sessionRuntimeStore.currentSessionStartTime) return

  const sessionContext = contextManager.getSessionContext()
  const hasSessionMetadata = Boolean(
    sessionContext.companyName ||
      sessionContext.roleName ||
      sessionContext.subject ||
      sessionContext.sessionNotes
  )
  const hasPersistableContent =
    sessionRuntimeStore.sessionTranscript.length > 0 ||
    sessionRuntimeStore.currentSessionAnswers.length > 0 ||
    Boolean(sessionRuntimeStore.currentSessionReport) ||
    sessionRuntimeStore.currentSessionScreenshots.length > 0 ||
    Boolean(sessionRuntimeStore.latestScreenSummary.trim()) ||
    hasSessionMetadata

  if (!hasPersistableContent) {
    console.log('[Session] Skipping save for empty session')
    sessionRuntimeStore.currentSessionStartTime = null
    return
  }

  try {
    sessionPersistenceService.saveSession({
      startedAt: sessionRuntimeStore.currentSessionStartTime,
      transcript: sessionRuntimeStore.sessionTranscript,
      answers: sessionRuntimeStore.currentSessionAnswers,
      sessionReport: sessionRuntimeStore.currentSessionReport,
      screenshots: sessionRuntimeStore.currentSessionScreenshots,
      profile: contextManager.getProfile(),
      context: contextManager.getContext(),
      sessionContext,
    })

    // Dump the conversation log alongside the other session artifacts so
    // we can replay the agent's actual dialog state post-session for
    // debugging / heuristic tuning. JSONL so each line is one append event.
    const folderName = sessionRuntimeStore.currentSessionFolderName
    if (folderName && conversationLog.size() > 0) {
      const sessionDir = path.join(contextManager.getAppDataPath(), 'sessions', folderName)
      try {
        fs.writeFileSync(
          path.join(sessionDir, 'conversation.jsonl'),
          conversationLog.serialize() + '\n',
          'utf-8'
        )
      } catch (err) {
        console.error('[Session] Failed to write conversation.jsonl:', err)
      }
    }
  } catch (err) {
    console.error('[Session] Failed to save to filesystem:', err)
  }

  sessionRuntimeStore.clearPersistedSessionBuffers()
}

async function runProfileUpdate(args: {
  transcript: TranscriptEntry[]
  sessionContext: SessionContext
  sessionFolderName: string | null
}): Promise<void> {
  const llmService = sessionRuntimeStore.llmService
  if (!llmService) return
  // Sessions with effectively no signal aren't worth a merge call.
  const finalized = args.transcript.filter((e) => e.isFinal).length
  if (finalized < 4 && !sessionRuntimeStore.currentSessionFolderName) return

  const model = (configStore.get('brainModel', DEFAULT_BRAIN_CONFIG.brainModel) as string) || DEFAULT_MODEL
  const sharedInputs = {
    profile: contextManager.getProfile(),
    sessionContext: args.sessionContext,
    transcript: args.transcript,
    appDataPath: contextManager.getAppDataPath(),
    sessionFolderName: args.sessionFolderName ?? undefined,
  }
  const sharedDeps = {
    llmService,
    model,
    onUsage: (u: { promptTokens: number; completionTokens: number; model: string }) =>
      costTracker.add(u.model, u.promptTokens, u.completionTokens),
  }

  // Run profile.md and voice.md updates in parallel — they're independent
  // calls hitting the same cheap model.
  const profilePromise = updateProfileForSession(sharedInputs, sharedDeps)
    .then((result) => {
      if (result.written) {
        console.log('[profile-update] profile.md updated')
      } else if (result.reason && result.reason !== 'empty-delta') {
        console.log(`[profile-update] skipped (${result.reason})`)
      }
      telemetry.record('profile-update', { written: result.written, reason: result.reason })
    })
    .catch((err) => {
      console.warn('[profile-update] unexpected failure:', err)
      telemetry.record('profile-update', { written: false, reason: 'unexpected-error' })
    })

  const voicePromise = updateVoiceForSession(sharedInputs, sharedDeps)
    .then((result) => {
      if (result.written) {
        console.log('[voice-update] voice.md updated')
      } else if (result.reason && result.reason !== 'empty-delta') {
        console.log(`[voice-update] skipped (${result.reason})`)
      }
      telemetry.record('voice-update', { written: result.written, reason: result.reason })
    })
    .catch((err) => {
      console.warn('[voice-update] unexpected failure:', err)
      telemetry.record('voice-update', { written: false, reason: 'unexpected-error' })
    })

  await Promise.all([profilePromise, voicePromise])
}

