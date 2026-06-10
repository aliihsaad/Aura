import { contextBridge, ipcRenderer } from 'electron'
import {
  AgentToolInfo,
  AgentPresenceState,
  AgentMode,
  AppConfig,
  AnswerDonePayload,
  ArtifactListFilters,
  ArtifactRecord,
  EntityListFilters,
  EntityRecord,
  IPC,
  MemoryListFilters,
  MemoryUpdateInput,
  ModelSelectionInfo,
  MemoryRecord,
  PreviewWindowItem,
  RecallQuery,
  RecallResult,
  RelationEndpointKind,
  RelationListFilters,
  RelationRecord,
  RuntimeRecallDebugState,
  WhisphryMemoryStatus,
} from '@shared/types'
import type { StudyNotesSnapshot } from '@shared/session-brain-types'
import type { LocalAiConfig, LocalAiInstallProgress, LocalAiStatus } from '@shared/local-ai-types'
import { KernelChannels, ModeChannels } from '@shared/ipc-channels'

type RendererConfig = Partial<AppConfig> & Record<string, any>

const viewParam = new URLSearchParams(window.location.search).get('view')
const isAnswerView = viewParam === 'answer'

function rendererChannel(legacyChannel: string, modeChannel: string): string {
  return isAnswerView ? modeChannel : legacyChannel
}

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Session
  startSession: (sessionContext?: any) => ipcRenderer.invoke(IPC.START_SESSION, sessionContext),
  stopSession: () => ipcRenderer.invoke(IPC.STOP_SESSION),
  pauseSession: () => ipcRenderer.invoke(IPC.PAUSE_SESSION),
  resumeSession: () => ipcRenderer.invoke(IPC.RESUME_SESSION),
  getSessionState: () => ipcRenderer.invoke(IPC.GET_SESSION_STATE),
  getSessions: () => ipcRenderer.invoke(IPC.GET_SESSIONS),
  getSessionDetail: (folderName: string) => ipcRenderer.invoke(IPC.GET_SESSION_DETAIL, folderName),
  deleteSession: (folderName: string) => ipcRenderer.invoke(IPC.DELETE_SESSION, folderName),
  exportSession: (folderName: string, format: 'md' | 'json') => ipcRenderer.invoke(IPC.EXPORT_SESSION, folderName, format),
  openSessionFolder: (folderName: string) => ipcRenderer.invoke(IPC.OPEN_SESSION_FOLDER, folderName),
  getStudyNotes: () => ipcRenderer.invoke(IPC.GET_STUDY_NOTES),

  // Memory
  getRecentMemories: (filters?: number | MemoryListFilters) => ipcRenderer.invoke(IPC.GET_RECENT_MEMORIES, filters),
  getRecentEntities: (filters?: EntityListFilters) => ipcRenderer.invoke(IPC.GET_RECENT_ENTITIES, filters),
  getRecentRelations: (filters?: RelationListFilters) => ipcRenderer.invoke(IPC.GET_RELATIONS, filters),
  getRelationsForSource: (sourceKind: RelationEndpointKind, sourceId: string) =>
    ipcRenderer.invoke(IPC.GET_RELATIONS_FOR_SOURCE, sourceKind, sourceId),
  getRelationsForTarget: (targetKind: RelationEndpointKind, targetId: string) =>
    ipcRenderer.invoke(IPC.GET_RELATIONS_FOR_TARGET, targetKind, targetId),
  updateMemoryStatus: (memoryId: string, status: WhisphryMemoryStatus) =>
    ipcRenderer.invoke(IPC.UPDATE_MEMORY_STATUS, memoryId, status),
  updateMemory: (memoryId: string, updates: MemoryUpdateInput) =>
    ipcRenderer.invoke(IPC.UPDATE_MEMORY, memoryId, updates),
  searchRecall: (query: RecallQuery) => ipcRenderer.invoke(IPC.RECALL_SEARCH, query),
  getRuntimeRecallDebug: () => ipcRenderer.invoke(IPC.GET_RUNTIME_RECALL_DEBUG),
  getRecentArtifacts: (filters?: ArtifactListFilters) => ipcRenderer.invoke(IPC.GET_RECENT_ARTIFACTS, filters),
  getArtifactsByIds: (artifactIds: string[]) => ipcRenderer.invoke(IPC.GET_ARTIFACTS_BY_IDS, artifactIds),
  openArtifact: (artifactId: string) => ipcRenderer.invoke(IPC.OPEN_ARTIFACT, artifactId),

  // LLM
  requestAnswer: (question?: string) => ipcRenderer.invoke(IPC.LLM_REQUEST, question),
  regenerateAnswer: () => ipcRenderer.invoke(IPC.LLM_REGENERATE),

  // Chat input (conversational turn through the active agent)
  sendChatMessage: (text: string) => ipcRenderer.invoke(IPC.CHAT_SEND, text),

  // Screen capture
  captureScreen: () => ipcRenderer.invoke(IPC.CAPTURE_SCREEN),

  // Context
  setContext: (context: any) => ipcRenderer.invoke(IPC.SET_CONTEXT, context),
  getContext: () => ipcRenderer.invoke(IPC.GET_CONTEXT),
  getProfile: () => ipcRenderer.invoke(IPC.GET_PROFILE),
  setProfile: (profile: any) => ipcRenderer.invoke(IPC.SET_PROFILE, profile),
  getLastSessionContext: () => ipcRenderer.invoke(IPC.GET_LAST_SESSION_CONTEXT),
  listSessionPresets: () => ipcRenderer.invoke('session-preset:list'),
  saveSessionPreset: (input: {
    id?: string
    name: string
    agentMode: 'session' | 'companion'
    context: Record<string, unknown>
  }) => ipcRenderer.invoke('session-preset:save', input),
  deleteSessionPreset: (id: string) => ipcRenderer.invoke('session-preset:delete', id),
  touchSessionPreset: (id: string) => ipcRenderer.invoke('session-preset:touch', id),
  bubbleFeedback: (input: { bubbleId: string; sentiment: 'up' | 'down'; text: string }) =>
    ipcRenderer.invoke('bubble:feedback', input),
  getCostMeter: () => ipcRenderer.invoke('cost:get'),
  onCostUpdate: (
    callback: (snapshot: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
      callCount: number
      byModel: Record<string, { promptTokens: number; completionTokens: number; calls: number }>
    }) => void
  ) => {
    const handler = (_e: unknown, snapshot: any): void => callback(snapshot)
    ipcRenderer.on('cost:update', handler)
    return () => ipcRenderer.removeListener('cost:update', handler)
  },
  listContextFolders: () => ipcRenderer.invoke(IPC.LIST_CONTEXT_FOLDERS),
  loadFileContext: (company?: string) => ipcRenderer.invoke(IPC.LOAD_FILE_CONTEXT, company),
  openContextFolder: () => ipcRenderer.invoke(IPC.OPEN_CONTEXT_FOLDER),
  openAppDataFolder: () => ipcRenderer.invoke(IPC.OPEN_APP_DATA_FOLDER),

  // Config
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  setConfig: (config: RendererConfig) => ipcRenderer.invoke(IPC.SET_CONFIG, config),
  getLocalAiStatus: () => ipcRenderer.invoke(IPC.LOCAL_AI_GET_STATUS),
  setLocalAiConfig: (config: unknown) => ipcRenderer.invoke(IPC.LOCAL_AI_SET_CONFIG, config),
  testLocalAiTts: () => ipcRenderer.invoke(IPC.LOCAL_AI_TEST_TTS),
  testLocalAiVision: () => ipcRenderer.invoke(IPC.LOCAL_AI_TEST_VISION),
  installLocalAiModel: (id: string) => ipcRenderer.invoke(IPC.LOCAL_AI_INSTALL_MODEL, id),
  removeLocalAiModel: (id: string) => ipcRenderer.invoke(IPC.LOCAL_AI_REMOVE_MODEL, id),
  onLocalAiInstallProgress: (callback: (progress: LocalAiInstallProgress) => void) => {
    const handler = (_event: any, progress: LocalAiInstallProgress) => callback(progress)
    ipcRenderer.on(IPC.LOCAL_AI_INSTALL_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.LOCAL_AI_INSTALL_PROGRESS, handler)
  },

  // Window
  toggleOverlay: () => ipcRenderer.send(IPC.TOGGLE_OVERLAY),
  showOverlay: () => ipcRenderer.send(IPC.SHOW_OVERLAY),
  hideOverlay: () => ipcRenderer.send(IPC.HIDE_OVERLAY),
  toggleAnswerWindow: () => ipcRenderer.send(IPC.TOGGLE_ANSWER_WINDOW),
  hideAnswerWindow: () => ipcRenderer.send(IPC.HIDE_ANSWER_WINDOW),
  resizeOverlay: (width: number, height: number) => ipcRenderer.invoke(IPC.RESIZE_OVERLAY, width, height),
  getAnswerWindowBounds: () => ipcRenderer.invoke(IPC.GET_ANSWER_WINDOW_BOUNDS),
  setAnswerWindowBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) =>
    ipcRenderer.invoke(IPC.SET_ANSWER_WINDOW_BOUNDS, bounds),

  // Preview window
  togglePreviewWindow: () => ipcRenderer.send(IPC.TOGGLE_PREVIEW_WINDOW),
  hidePreviewWindow: () => ipcRenderer.send(IPC.HIDE_PREVIEW_WINDOW),
  getPreviewWindowBounds: () => ipcRenderer.invoke(IPC.GET_PREVIEW_WINDOW_BOUNDS),
  setPreviewWindowBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) =>
    ipcRenderer.invoke(IPC.SET_PREVIEW_WINDOW_BOUNDS, bounds),
  getPreviewItems: () => ipcRenderer.invoke(IPC.GET_PREVIEW_ITEMS),
  convertPdfToMarkdown: (pdfBase64: string, filename: string) =>
    ipcRenderer.invoke(IPC.CONVERT_PDF_TO_MARKDOWN, pdfBase64, filename),

  // Content protection & settings
  setContentProtection: (enabled: boolean) => ipcRenderer.send(IPC.SET_CONTENT_PROTECTION, enabled),
  openSettings: () => ipcRenderer.send(IPC.OPEN_SETTINGS),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  saveImageAttachment: (input: { src: string; caption?: string }) =>
    ipcRenderer.invoke(IPC.SAVE_IMAGE_ATTACHMENT, input),
  speakAnswer: (text: string) => ipcRenderer.invoke(IPC.SPEAK_ANSWER, text),
  stopSpeakingAnswer: () => ipcRenderer.invoke(IPC.STOP_SPEAKING_ANSWER),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES),
  onUpdateAvailable: (callback: (info: any) => void) => {
    const handler = (_event: any, info: any) => callback(info)
    ipcRenderer.on(IPC.UPDATE_AVAILABLE, handler)
    return () => ipcRenderer.removeListener(IPC.UPDATE_AVAILABLE, handler)
  },

  // Clipboard
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),

  // Audio - send chunks from renderer to main
  sendAudioChunk: (source: 'system' | 'user', chunk: ArrayBuffer) => ipcRenderer.send('audio:chunk', source, chunk),
  getAgentTools: () => ipcRenderer.invoke(IPC.GET_AGENT_TOOLS),
  getHeartbeatState: () => ipcRenderer.invoke(IPC.GET_HEARTBEAT_STATE),

  // Event listeners
  onTranscriptUpdate: (callback: (entry: any) => void) => {
    const handler = (_event: any, entry: any) => callback(entry)
    ipcRenderer.on(IPC.TRANSCRIPT_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.TRANSCRIPT_UPDATE, handler)
  },

  onAnswerQuestion: (callback: (question: string) => void) => {
    const handler = (_event: any, question: string) => callback(question)
    const channel = rendererChannel(IPC.LLM_QUESTION, ModeChannels.answer.question)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onAnswerModelSelection: (callback: (selection: ModelSelectionInfo) => void) => {
    const handler = (_event: any, selection: ModelSelectionInfo) => callback(selection)
    const channel = rendererChannel(IPC.LLM_MODEL_SELECTION, ModeChannels.answer.modelSelection)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onAnswerChunk: (callback: (answer: string) => void) => {
    const handler = (_event: any, answer: string) => callback(answer)
    const channel = rendererChannel(IPC.LLM_RESPONSE_CHUNK, ModeChannels.answer.answerToken)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onAnswerDone: (callback: (answer: string | AnswerDonePayload) => void) => {
    const handler = (_event: any, answer: string | AnswerDonePayload) => callback(answer)
    const channel = rendererChannel(IPC.LLM_RESPONSE_DONE, ModeChannels.answer.answerEnd)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  onModeActive: (callback: (mode: AgentMode) => void) => {
    const handler = (_event: any, mode: AgentMode) => callback(mode)
    ipcRenderer.on(KernelChannels.modeActive, handler)
    return () => ipcRenderer.removeListener(KernelChannels.modeActive, handler)
  },

  onSessionState: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state)
    ipcRenderer.on(IPC.SESSION_STATE, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_STATE, handler)
  },
  onStudyNotesUpdate: (callback: (snapshot: StudyNotesSnapshot) => void) => {
    const handler = (_event: any, snapshot: StudyNotesSnapshot) => callback(snapshot)
    ipcRenderer.on(IPC.STUDY_NOTES_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.STUDY_NOTES_UPDATE, handler)
  },
  onPreviewItemsUpdated: (callback: (items: PreviewWindowItem[]) => void) => {
    const handler = (_event: any, items: PreviewWindowItem[]) => callback(items)
    ipcRenderer.on(IPC.PREVIEW_ITEMS_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.PREVIEW_ITEMS_UPDATED, handler)
  },

  onShortcutToggleSession: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:toggle-session', handler)
    return () => ipcRenderer.removeListener('shortcut:toggle-session', handler)
  },

  onShortcutCaptureScreen: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:capture-screen', handler)
    return () => ipcRenderer.removeListener('shortcut:capture-screen', handler)
  },

  onShortcutRegenerate: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:regenerate', handler)
    return () => ipcRenderer.removeListener('shortcut:regenerate', handler)
  },

  onShortcutAnswerNow: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:answer-now', handler)
    return () => ipcRenderer.removeListener('shortcut:answer-now', handler)
  },

  onSttActivity: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('stt:activity', handler)
    return () => ipcRenderer.removeListener('stt:activity', handler)
  },

  onSttReconnecting: (callback: (reconnecting: boolean) => void) => {
    const handler = (_event: any, reconnecting: boolean) => callback(reconnecting)
    ipcRenderer.on('stt:reconnecting', handler)
    return () => ipcRenderer.removeListener('stt:reconnecting', handler)
  },

  onSttReconnectError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error)
    ipcRenderer.on('stt:reconnect-error', handler)
    return () => ipcRenderer.removeListener('stt:reconnect-error', handler)
  },

  // Canvas
  onWidgetState: (callback: (widgets: any[]) => void) => {
    const handler = (_event: any, widgets: any[]) => callback(widgets)
    ipcRenderer.on('canvas:widget-state', handler)
    return () => ipcRenderer.removeListener('canvas:widget-state', handler)
  },
  onPresenceState: (callback: (state: AgentPresenceState) => void) => {
    const handler = (_event: any, state: AgentPresenceState) => callback(state)
    ipcRenderer.on('agent:presence-state', handler)
    return () => ipcRenderer.removeListener('agent:presence-state', handler)
  },
  onBubbleStyle: (callback: (style: { fontSize: number; width: number }) => void) => {
    const handler = (_event: any, style: { fontSize: number; width: number }) => callback(style)
    ipcRenderer.on('canvas:bubble-style', handler)
    return () => ipcRenderer.removeListener('canvas:bubble-style', handler)
  },
  dismissWidget: (widgetId: string) => ipcRenderer.invoke('canvas:widget-dismiss', widgetId),
  expandBubble: (bubbleId: string) => ipcRenderer.invoke('canvas:expand-bubble', bubbleId),
  setCanvasInteractive: (interactive: boolean) => ipcRenderer.send('canvas:set-interactive', interactive),
  canvasUpdateWidgetPosition: (id: string, position: { x: number; y: number }) =>
    ipcRenderer.send('canvas:widget-position', id, position),
  canvasReportRegion: (id: string, rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('canvas:report-region', id, rect),

  onVoiceAudioChunk: (callback: (payload: { pcmBase64: string; mimeType: string }) => void) => {
    const handler = (_event: any, payload: { pcmBase64: string; mimeType: string }) => callback(payload)
    ipcRenderer.on('voice:audio-chunk', handler)
    return () => ipcRenderer.removeListener('voice:audio-chunk', handler)
  },
  onVoiceAudioEnd: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('voice:audio-end', handler)
    return () => ipcRenderer.removeListener('voice:audio-end', handler)
  },
  onAnswerTtsUnavailable: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('answer:tts-unavailable', handler)
    return () => ipcRenderer.removeListener('answer:tts-unavailable', handler)
  },
  onAnswerTtsStart: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('answer:tts-start', handler)
    return () => ipcRenderer.removeListener('answer:tts-start', handler)
  },
  onVoiceInterrupt: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('voice:interrupt', handler)
    return () => ipcRenderer.removeListener('voice:interrupt', handler)
  },
  setVoicePlaybackState: (active: boolean) => ipcRenderer.send('voice:playback-state', active),
  sendVoiceBargeInState: (open: boolean) => ipcRenderer.send('voice:barge-in-state', open),

  setLiveAgentVoicePlayback: (enabled: boolean) =>
    ipcRenderer.invoke('live-agent:set-voice-playback', enabled),
  setLiveAgentCaptions: (enabled: boolean) =>
    ipcRenderer.invoke('live-agent:set-captions', enabled),

})

// Type declaration for the exposed API
declare global {
  interface Window {
    api: {
      startSession: (sessionContext?: any) => Promise<any>
      stopSession: () => Promise<any>
      pauseSession: () => Promise<any>
      resumeSession: () => Promise<any>
      getSessionState: () => Promise<any>
      getSessions: () => Promise<any>
      getSessionDetail: (folderName: string) => Promise<any>
      deleteSession: (folderName: string) => Promise<boolean>
      exportSession: (folderName: string, format: 'md' | 'json') => Promise<string | null>
      openSessionFolder: (folderName: string) => Promise<any>
      getStudyNotes: () => Promise<StudyNotesSnapshot | null>
      getRecentMemories: (filters?: number | MemoryListFilters) => Promise<MemoryRecord[]>
      getRecentEntities: (filters?: EntityListFilters) => Promise<EntityRecord[]>
      getRecentRelations: (filters?: RelationListFilters) => Promise<RelationRecord[]>
      getRelationsForSource: (sourceKind: RelationEndpointKind, sourceId: string) => Promise<RelationRecord[]>
      getRelationsForTarget: (targetKind: RelationEndpointKind, targetId: string) => Promise<RelationRecord[]>
      updateMemoryStatus: (memoryId: string, status: WhisphryMemoryStatus) => Promise<MemoryRecord>
      updateMemory: (memoryId: string, updates: MemoryUpdateInput) => Promise<MemoryRecord>
      searchRecall: (query: RecallQuery) => Promise<RecallResult[]>
      getRuntimeRecallDebug: () => Promise<RuntimeRecallDebugState>
      getRecentArtifacts: (filters?: ArtifactListFilters) => Promise<ArtifactRecord[]>
      getArtifactsByIds: (artifactIds: string[]) => Promise<ArtifactRecord[]>
      openArtifact: (artifactId: string) => Promise<any>
      requestAnswer: (question?: string) => Promise<any>
      regenerateAnswer: () => Promise<void>
      sendChatMessage: (text: string) => Promise<{ success: boolean; reason?: string }>
      captureScreen: () => Promise<any>
      setContext: (context: any) => Promise<any>
      getContext: () => Promise<any>
      getProfile: () => Promise<any>
      setProfile: (profile: any) => Promise<any>
      getLastSessionContext: () => Promise<any>
      listSessionPresets: () => Promise<Array<{
        id: string
        name: string
        agentMode: 'session' | 'companion'
        context: Record<string, unknown>
        createdAt: number
        lastUsedAt?: number
      }>>
      saveSessionPreset: (input: {
        id?: string
        name: string
        agentMode: 'session' | 'companion'
        context: Record<string, unknown>
      }) => Promise<{
        id: string
        name: string
        agentMode: 'session' | 'companion'
        context: Record<string, unknown>
        createdAt: number
        lastUsedAt?: number
      } | null>
      deleteSessionPreset: (id: string) => Promise<boolean>
      touchSessionPreset: (id: string) => Promise<unknown>
      bubbleFeedback: (input: {
        bubbleId: string
        sentiment: 'up' | 'down'
        text: string
      }) => Promise<{ saved: boolean }>
      getCostMeter: () => Promise<{
        promptTokens: number
        completionTokens: number
        totalTokens: number
        callCount: number
        byModel: Record<string, { promptTokens: number; completionTokens: number; calls: number }>
      }>
      onCostUpdate: (
        callback: (snapshot: {
          promptTokens: number
          completionTokens: number
          totalTokens: number
          callCount: number
          byModel: Record<string, { promptTokens: number; completionTokens: number; calls: number }>
        }) => void
      ) => () => void
      listContextFolders: () => Promise<string[]>
      loadFileContext: (company?: string) => Promise<{ content: string; files: string[]; warnings: string[] }>
      openContextFolder: () => Promise<any>
      openAppDataFolder: () => Promise<any>
      getConfig: () => Promise<RendererConfig>
      setConfig: (config: RendererConfig) => Promise<any>
      getLocalAiStatus: () => Promise<LocalAiStatus>
      setLocalAiConfig: (config: LocalAiConfig) => Promise<LocalAiConfig>
      testLocalAiTts: () => Promise<any>
      testLocalAiVision: () => Promise<any>
      installLocalAiModel: (id: string) => Promise<any>
      removeLocalAiModel: (id: string) => Promise<any>
      onLocalAiInstallProgress: (callback: (progress: LocalAiInstallProgress) => void) => () => void
      toggleOverlay: () => void
      showOverlay: () => void
      hideOverlay: () => void
      toggleAnswerWindow: () => void
      hideAnswerWindow: () => void
      resizeOverlay: (width: number, height: number) => Promise<any>
      getAnswerWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      setAnswerWindowBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => Promise<any>
      togglePreviewWindow: () => void
      hidePreviewWindow: () => void
      getPreviewWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      setPreviewWindowBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => Promise<any>
      getPreviewItems: () => Promise<PreviewWindowItem[]>
      convertPdfToMarkdown: (pdfBase64: string, filename: string) => Promise<string>
      copyToClipboard: (text: string) => void
      setContentProtection: (enabled: boolean) => void
      openSettings: () => void
      getAgentTools: () => Promise<AgentToolInfo[]>
      getHeartbeatState: () => Promise<any>
      sendAudioChunk: (source: 'system' | 'user', chunk: ArrayBuffer) => void
      onTranscriptUpdate: (callback: (entry: any) => void) => () => void
      onAnswerQuestion: (callback: (question: string) => void) => () => void
      onAnswerModelSelection: (callback: (selection: ModelSelectionInfo) => void) => () => void
      onAnswerChunk: (callback: (answer: string) => void) => () => void
      onAnswerDone: (callback: (answer: string | AnswerDonePayload) => void) => () => void
      onModeActive: (callback: (mode: AgentMode) => void) => () => void
      onSessionState: (callback: (state: any) => void) => () => void
      onStudyNotesUpdate: (callback: (snapshot: StudyNotesSnapshot) => void) => () => void
      onPreviewItemsUpdated: (callback: (items: PreviewWindowItem[]) => void) => () => void
      onShortcutToggleSession: (callback: () => void) => () => void
      onShortcutCaptureScreen: (callback: () => void) => () => void
      onShortcutRegenerate: (callback: () => void) => () => void
      onShortcutAnswerNow: (callback: () => void) => () => void
      onSttActivity: (callback: () => void) => () => void
      onSttReconnecting: (callback: (reconnecting: boolean) => void) => () => void
      onSttReconnectError: (callback: (error: string) => void) => () => void
      openExternal: (url: string) => Promise<any>
      saveImageAttachment: (input: { src: string; caption?: string }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
      speakAnswer: (text: string) => Promise<boolean>
      stopSpeakingAnswer: () => Promise<boolean>
      checkForUpdates: () => Promise<any>
      onUpdateAvailable: (callback: (info: any) => void) => () => void
      onWidgetState: (callback: (widgets: any[]) => void) => () => void
      onPresenceState: (callback: (state: AgentPresenceState) => void) => () => void
      onBubbleStyle: (callback: (style: { fontSize: number; width: number }) => void) => () => void
      dismissWidget: (widgetId: string) => Promise<void>
      expandBubble: (bubbleId: string) => Promise<void>
      setCanvasInteractive: (interactive: boolean) => void
      canvasUpdateWidgetPosition: (id: string, position: { x: number; y: number }) => void
      canvasReportRegion: (id: string, rect: { x: number; y: number; width: number; height: number }) => void
      onVoiceAudioChunk: (callback: (payload: { pcmBase64: string; mimeType: string }) => void) => () => void
      onVoiceAudioEnd: (callback: () => void) => () => void
      onAnswerTtsUnavailable: (callback: () => void) => () => void
      onAnswerTtsStart: (callback: () => void) => () => void
      onVoiceInterrupt: (callback: () => void) => () => void
      setVoicePlaybackState: (active: boolean) => void
      sendVoiceBargeInState: (open: boolean) => void
      setLiveAgentVoicePlayback: (enabled: boolean) => Promise<{ success: boolean; reason?: string }>
      setLiveAgentCaptions: (enabled: boolean) => Promise<{ success: boolean }>
    }
  }
}
