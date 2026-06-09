import {
  AgentMode,
  CompanionEngine,
  InterruptionPolicy,
  ModeScopedConfig,
  PersonalityPreset,
  SessionContext,
} from '@shared/types'
import {
  AGENT_MODE_DEFAULTS,
  DEFAULT_COMPANION_ENGINE,
  DEFAULT_COMPANION_REALTIME_MODEL,
  DEFAULT_COMPANION_REALTIME_VOICE,
  DEFAULT_MODEL,
  HEARTBEAT_DEFAULTS,
} from '@shared/constants'
import { ContextManager } from './context-manager'

const CONFIG_SCHEMA_VERSION = 1
const DEFAULT_COMPANION_VOICE_MODEL = 'aura-2-thalia-en'

interface ConfigStoreLike {
  get(key: string, fallback?: unknown): unknown
  set(key: string, value: unknown): void
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value.trim() : ''
  return candidate || fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function companionEngineValue(value: unknown): CompanionEngine {
  return value === 'realtime-beta' ? 'realtime-beta' : 'classic'
}

export class ModeConfigService {
  constructor(private readonly configStore: ConfigStoreLike) {}

  isAgentModeValue(value: unknown): value is AgentMode {
    switch (value) {
      case 'interview':
      case 'companion':
        return true
      default:
        return false
    }
  }

  normalizeAgentMode(value: unknown): AgentMode | null {
    return this.isAgentModeValue(value) ? value : null
  }

  legacyAgentModeFromFlatConfig(): AgentMode {
    const stored = this.normalizeAgentMode(this.configStore.get('agentMode'))
    if (stored) return stored
    const liveOn = Boolean(this.configStore.get('liveAgentEnabled', false))
    return liveOn ? 'companion' : 'interview'
  }

  readModeScopedConfig(): ModeScopedConfig {
    const raw = this.configStore.get('modes', {}) as unknown
    const modes = isPlainObject(raw) ? raw : {}
    const interview = isPlainObject(modes.interview) ? modes.interview : {}
    const companion = isPlainObject(modes.companion) ? modes.companion : {}

    return {
      interview: {
        autoAnswerEnabled: booleanValue(
          interview.autoAnswerEnabled,
          Boolean(this.configStore.get('autoAnswerEnabled', true))
        ),
        defaultModel: nonEmptyString(
          interview.defaultModel,
          String(this.configStore.get('defaultModel', DEFAULT_MODEL))
        ),
        codingModel: nonEmptyString(
          interview.codingModel,
          String(this.configStore.get('codingModel', ''))
        ),
        interviewHeartbeatEnabled: booleanValue(
          interview.interviewHeartbeatEnabled,
          Boolean(this.configStore.get('interviewHeartbeatEnabled', AGENT_MODE_DEFAULTS.interviewHeartbeatEnabled))
        ),
        lastSession: isPlainObject(interview.lastSession) ? interview.lastSession as SessionContext : null,
      },
      companion: {
        personality: nonEmptyString(
          companion.personality,
          String(this.configStore.get('personality', 'auto'))
        ) as PersonalityPreset,
        interruptionPolicy: nonEmptyString(
          companion.interruptionPolicy,
          String(this.configStore.get('interruptionPolicy', 'ask-first'))
        ) as InterruptionPolicy,
        heartbeatIntervalMs: Number(companion.heartbeatIntervalMs ?? this.configStore.get('heartbeatIntervalMs', HEARTBEAT_DEFAULTS.intervalMs)),
        heartbeatEnabled: booleanValue(
          companion.heartbeatEnabled,
          Boolean(this.configStore.get('heartbeatEnabled', HEARTBEAT_DEFAULTS.enabled))
        ),
        proactiveNudges: booleanValue(
          companion.proactiveNudges,
          Boolean(this.configStore.get('heartbeatEnabled', HEARTBEAT_DEFAULTS.enabled))
        ),
        voiceEnabled: booleanValue(
          companion.voiceEnabled,
          Boolean(this.configStore.get('liveAgentVoiceEnabled', false))
        ),
        voiceName: nonEmptyString(
          companion.voiceName,
          String(this.configStore.get('liveAgentVoiceName', 'Aoede'))
        ),
        voiceModel: nonEmptyString(
          companion.voiceModel,
          String(this.configStore.get('companionVoiceModel', this.configStore.get('liveAgentVoiceName', DEFAULT_COMPANION_VOICE_MODEL)))
        ),
        model: nonEmptyString(
          companion.model,
          String(this.configStore.get('liveAgentModel', ''))
        ),
        engine: companionEngineValue(
          companion.engine ?? this.configStore.get('companionEngine', DEFAULT_COMPANION_ENGINE)
        ),
        realtimeModel: nonEmptyString(
          companion.realtimeModel,
          String(this.configStore.get('companionRealtimeModel', DEFAULT_COMPANION_REALTIME_MODEL))
        ),
        realtimeVoiceName: nonEmptyString(
          companion.realtimeVoiceName,
          String(this.configStore.get('companionRealtimeVoiceName', DEFAULT_COMPANION_REALTIME_VOICE))
        ),
        realtimeInputTranscription: booleanValue(
          companion.realtimeInputTranscription,
          Boolean(this.configStore.get('companionRealtimeInputTranscription', true))
        ),
        realtimeOutputTranscription: booleanValue(
          companion.realtimeOutputTranscription,
          Boolean(this.configStore.get('companionRealtimeOutputTranscription', true))
        ),
        captionsEnabled: booleanValue(
          companion.captionsEnabled,
          Boolean(this.configStore.get('liveAgentCaptionsEnabled', true))
        ),
        disabledTools: stringArrayValue(companion.disabledTools ?? this.configStore.get('liveAgentDisabledTools', [])),
        lastSession: isPlainObject(companion.lastSession) ? companion.lastSession as SessionContext : null,
      },
    }
  }

  writeModeScopedConfig(modes: ModeScopedConfig): void {
    this.configStore.set('modes', modes)
    this.configStore.set('configSchemaVersion', CONFIG_SCHEMA_VERSION)
  }

  migrateFlatConfigToModes(): void {
    const modes = this.readModeScopedConfig()
    this.writeModeScopedConfig(modes)
    if (!this.normalizeAgentMode(this.configStore.get('activeMode'))) {
      this.configStore.set('activeMode', this.legacyAgentModeFromFlatConfig())
    }
  }

  getInterviewModeConfig(): ModeScopedConfig['interview'] {
    return this.readModeScopedConfig().interview
  }

  getCompanionModeConfig(): ModeScopedConfig['companion'] {
    return this.readModeScopedConfig().companion
  }

  updateModeScopedConfigFromFlatPatch(config: Record<string, any>): void {
    const modes = this.readModeScopedConfig()

    if (config.defaultModel !== undefined) modes.interview.defaultModel = String(config.defaultModel)
    if (config.codingModel !== undefined) modes.interview.codingModel = String(config.codingModel)
    if (config.autoAnswerEnabled !== undefined) modes.interview.autoAnswerEnabled = Boolean(config.autoAnswerEnabled)
    if (config.interviewHeartbeatEnabled !== undefined) {
      modes.interview.interviewHeartbeatEnabled = Boolean(config.interviewHeartbeatEnabled)
    }

    if (config.personality !== undefined) modes.companion.personality = config.personality as PersonalityPreset
    if (config.interruptionPolicy !== undefined) {
      modes.companion.interruptionPolicy = config.interruptionPolicy as InterruptionPolicy
    }
    if (config.heartbeatIntervalMs !== undefined) modes.companion.heartbeatIntervalMs = Number(config.heartbeatIntervalMs)
    if (config.heartbeatEnabled !== undefined) {
      modes.companion.heartbeatEnabled = Boolean(config.heartbeatEnabled)
      modes.companion.proactiveNudges = Boolean(config.heartbeatEnabled)
    }
    if (config.liveAgentVoiceName !== undefined) modes.companion.voiceName = String(config.liveAgentVoiceName)
    if (config.companionVoiceModel !== undefined) modes.companion.voiceModel = String(config.companionVoiceModel)
    if (config.liveAgentModel !== undefined) modes.companion.model = String(config.liveAgentModel)
    if (config.companionEngine !== undefined) {
      modes.companion.engine = companionEngineValue(config.companionEngine)
    }
    if (config.companionRealtimeModel !== undefined) {
      modes.companion.realtimeModel = nonEmptyString(config.companionRealtimeModel, DEFAULT_COMPANION_REALTIME_MODEL)
    }
    if (config.companionRealtimeVoiceName !== undefined) {
      modes.companion.realtimeVoiceName = nonEmptyString(config.companionRealtimeVoiceName, DEFAULT_COMPANION_REALTIME_VOICE)
    }
    if (config.companionRealtimeInputTranscription !== undefined) {
      modes.companion.realtimeInputTranscription = Boolean(config.companionRealtimeInputTranscription)
    }
    if (config.companionRealtimeOutputTranscription !== undefined) {
      modes.companion.realtimeOutputTranscription = Boolean(config.companionRealtimeOutputTranscription)
    }
    if (config.liveAgentDisabledTools !== undefined) {
      modes.companion.disabledTools = stringArrayValue(config.liveAgentDisabledTools)
    }
    if (config.liveAgentCaptionsEnabled !== undefined) {
      modes.companion.captionsEnabled = Boolean(config.liveAgentCaptionsEnabled)
    }
    if (config.liveAgentVoiceEnabled !== undefined) {
      modes.companion.voiceEnabled = Boolean(config.liveAgentVoiceEnabled)
    }

    if (config.agentMode !== undefined) {
      const normalized = this.normalizeAgentMode(config.agentMode)
      if (normalized) {
        this.configStore.set('activeMode', normalized)
      }
    }

    this.writeModeScopedConfig(modes)
  }

  modeConfigSectionForAgentMode(mode: AgentMode): keyof ModeScopedConfig {
    return mode === 'companion' ? 'companion' : 'interview'
  }

  modeConfigSectionForSession(ctx: SessionContext): keyof ModeScopedConfig {
    return ctx.sessionIntent === 'quick-help' ? 'companion' : 'interview'
  }

  rememberLastSessionForMode(ctx: SessionContext, mode: AgentMode): void {
    const modes = this.readModeScopedConfig()
    const section = this.modeConfigSectionForAgentMode(mode)
    modes[section].lastSession = ctx
    this.writeModeScopedConfig(modes)
  }

  migrateLastSessionContextToModes(contextManager: ContextManager): void {
    const legacyLastSession = contextManager.getLastSessionContext()
    const hasLegacySession =
      Boolean(legacyLastSession.companyName || legacyLastSession.roleName || legacyLastSession.subject || legacyLastSession.sessionNotes) ||
      legacyLastSession.sessionIntent !== 'interview' ||
      legacyLastSession.interviewType !== 'general' ||
      Boolean(legacyLastSession.contextFolder)
    if (!hasLegacySession) return

    const modes = this.readModeScopedConfig()
    const section = this.modeConfigSectionForSession(legacyLastSession)
    if (!modes[section].lastSession) {
      modes[section].lastSession = legacyLastSession
      this.writeModeScopedConfig(modes)
    }
  }
}
