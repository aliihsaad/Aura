export const DEFAULT_MODEL = 'google/gemini-3-flash-preview'
export const DEFAULT_CODING_MODEL = 'deepseek/deepseek-chat-v3-0324'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_FREELLMAPI_BASE_URL = 'http://localhost:3001/v1'
export const DEFAULT_COMPANION_ENGINE = 'classic' as const
export const DEFAULT_COMPANION_REALTIME_VOICE = 'alloy'
export const DEFAULT_COMPANION_REALTIME_MODEL = 'auto'

export const DEFAULT_SHORTCUTS = {
  toggleOverlay: 'CommandOrControl+Shift+O',
  startStopSession: 'CommandOrControl+Shift+S',
  captureScreen: 'CommandOrControl+Shift+C',
  regenerateAnswer: 'CommandOrControl+Shift+R',
  hideOverlay: 'CommandOrControl+Shift+H',
  answerNow: 'CommandOrControl+Shift+Space',
}

export const DEEPGRAM_CONFIG = {
  model: 'nova-3',
  language: 'en',
  smart_format: true,
  punctuate: true,
  interim_results: true,
  utterance_end_ms: 1800,
  vad_events: true,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
]

export const DEFAULT_OVERLAY = {
  width: 1320,
  height: 980,
  opacity: 0.92,
  fontSize: 22,
}

// ── Heartbeat ────────────────────────────────────────────

export const HEARTBEAT_DEFAULTS = {
  enabled: true,
  // No longer a metronome — this is the "how long after the conversation
  // goes quiet before the agent may chime in unprompted" delay. A single
  // one-shot timer armed after each real user turn (see HeartbeatService).
  intervalMs: 20000,
  minIntervalMs: 10000,
  maxIntervalMs: 45000,
}

export const HEARTBEAT_COOLDOWNS = {
  showBubbleMs: 60000,
  showPanelMs: 120000,
  saveMemoryMs: 10000,
  // Minimum gap between heartbeat LLM calls. Low because it now only needs
  // to prevent a runaway loop of triggered ticks — there's no metronome
  // poll to throttle anymore, and a real user turn should get a fast reply.
  globalMinMs: 2000,
}

export const AGENT_MODE_DEFAULTS = {
  mode: 'interview' as const,
  // When true, the OpenRouter heartbeat fires proactive bubbles even without
  // a direct user/interviewer prompt. When false, the heartbeat only runs in
  // response to finalized transcript events (still surfaces tool-driven answers).
  interviewHeartbeatEnabled: true,
}

// ── Widgets ──────────────────────────────────────────────

export const WIDGET_DEFAULTS = {
  bubbleTtlMs: 7000,
  toastTtlMs: 4000,
  maxBubbles: 1,
}

// ── Personality ──────────────────────────────────────────

export const DEFAULT_PERSONALITY = 'auto' as const
export const DEFAULT_INTERRUPTION_POLICY = 'ask-first' as const

// ── Session Brain ────────────────────────────────────────

import type { BrainConfig } from './session-brain-types'

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  brainEnabled: true,
  // DEFAULT_MODEL is already a cheap fast model — reuse it for the brain
  // text loop. Vision uses the same identifier; OpenRouter routes images
  // automatically when a multimodal model is selected.
  brainModel: DEFAULT_MODEL,
  brainVisionModel: DEFAULT_MODEL,
  brainSummaryIntervalMs: 45_000,
  brainSummaryMinUtterances: 4,
  brainScreenshotIntervalMs: 20_000,
  brainScreenshotMaxKept: 60,
  brainSummaryMaxTicks: 200,
  brainScreenshotKeepThreshold: 0.55,
}

