import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(path, needle, message) {
  const text = read(path)
  if (!text.includes(needle)) {
    throw new Error(`${message}\nMissing in ${path}: ${needle}`)
  }
}

function assertNotIncludes(path, needle, message) {
  const text = read(path)
  if (text.includes(needle)) {
    throw new Error(`${message}\nUnexpected in ${path}: ${needle}`)
  }
}

function assertMissing(path, message) {
  if (fs.existsSync(path)) {
    throw new Error(`${message}\nUnexpected file: ${path}`)
  }
}

assertIncludes(
  'src/shared/constants.ts',
  "DEFAULT_FREELLMAPI_BASE_URL = 'http://localhost:3001/v1'",
  'FreeLLMAPI realtime default base URL must be centralized.'
)

assertIncludes(
  'src/shared/types.ts',
  'freeLlmApiBaseUrl?: string',
  'AppConfig must expose FreeLLMAPI realtime base URL.'
)

assertIncludes(
  'src/shared/types.ts',
  'freeLlmApiKey?: string',
  'AppConfig must expose FreeLLMAPI realtime key through getConfig.'
)

assertIncludes(
  'src/shared/types.ts',
  "export type CompanionEngine = 'classic' | 'realtime-beta'",
  'Companion engine must remain the only Companion mode switch for FreeLLMAPI realtime.'
)

assertIncludes(
  'src/shared/types.ts',
  'engine: CompanionEngine',
  'ModeScopedConfig.companion must persist Classic vs Realtime Beta.'
)

assertNotIncludes(
  'src/shared/types.ts',
  'CompanionLlmProvider',
  'Classic Companion must not expose a FreeLLMAPI LLM provider switch.'
)

assertNotIncludes(
  'src/shared/types.ts',
  'companionLlmProvider',
  'AppConfig must not expose a Classic Companion FreeLLMAPI LLM provider.'
)

assertIncludes(
  'src/shared/local-ai-types.ts',
  "export type TtsProviderId = 'deepgram' | 'system' | 'disabled'",
  'Local AI TTS providers must stay Deepgram/System/Disabled only.'
)

assertNotIncludes(
  'src/shared/local-ai-types.ts',
  'freellmapi',
  'FreeLLMAPI must not be exposed as a normal TTS provider.'
)

assertMissing(
  'src/main/services/local-ai/providers/freellmapi-tts-provider.ts',
  'FreeLLMAPI TTS provider must not exist in the narrow realtime-only scope.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "const LOCAL_AI_TTS_PROVIDERS: TtsProviderId[] = ['deepgram', 'system', 'disabled']",
  'Local AI TTS normalization must not accept FreeLLMAPI.'
)

assertNotIncludes(
  'src/main/ipc-handlers.ts',
  'FreeLlmApiTtsProvider',
  'ipc-handlers must not route normal TTS through FreeLLMAPI.'
)

assertNotIncludes(
  'src/main/ipc-handlers.ts',
  "case 'freellmapi'",
  'Selected answer TTS provider switch must not include FreeLLMAPI.'
)

assertNotIncludes(
  'src/renderer/settings/components/LocalAiSettings.tsx',
  "value: 'freellmapi'",
  'Settings must not show FreeLLMAPI as Speech Output.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "getSecureKey('freeLlmApiKey')",
  'ipc-handlers must read FreeLLMAPI secure key for Realtime Beta.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "new Set(['openrouterApiKey', 'deepgramApiKey', 'freeLlmApiKey'])",
  'FreeLLMAPI realtime key must use secure key storage.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "'freeLlmApiBaseUrl'",
  'FreeLLMAPI realtime base URL must be allowed through SET_CONFIG.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "return { ok: false, reason: 'FreeLLMAPI API key not configured for Realtime Beta' }",
  'Realtime Beta must require a FreeLLMAPI key instead of falling through to OpenRouter.'
)

assertIncludes(
  'src/main/pipelines/companion-pipeline.ts',
  'buildLlmRouting(d.openrouterApiKey, d.defaultModel)',
  'Classic Companion pipeline must use settings-controlled LLM-Hub-first routing with OpenRouter fallback.'
)

assertIncludes(
  'src/main/pipelines/companion-pipeline.ts',
  'new LLMService(',
  'Classic Companion pipeline must initialize its LLM service.'
)

assertNotIncludes(
  'src/main/ipc-handlers.ts',
  'buildCompanionLlmRouting',
  'ipc-handlers must use the shared LLM routing factory, not a separate Companion-only router.'
)

assertIncludes(
  'src/main/services/llm-routing.ts',
  "export type LlmEndpointId = 'openrouter' | 'freellmapi'",
  'Generic LLM routing must support OpenRouter plus the LLM-Hub relay endpoint.'
)

assertIncludes(
  'src/main/services/llm-routing-factory.ts',
  "enabled: boolean",
  'LLM-Hub routing must remain controlled by the Settings toggle.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "freeLlmRoutingEnabled: configStore.get('freeLlmRoutingEnabled', true) as boolean",
  'ipc-handlers must expose the LLM-Hub reasoning and vision routing toggle.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'Prefer LLM-Hub for reasoning &amp; vision',
  'Settings UI must expose the LLM-Hub reasoning and vision toggle.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'FreeLLMAPI Realtime Beta base URL',
  'Settings UI must clearly scope FreeLLMAPI base URL to Realtime Beta.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'FreeLLMAPI Realtime Beta key',
  'Settings UI must clearly scope FreeLLMAPI key to Realtime Beta.'
)

assertIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'companionEngine',
  'Settings UI must expose Companion engine.'
)

assertNotIncludes(
  'src/renderer/settings/components/ApiConfig.tsx',
  'companionLlmProvider',
  'Settings UI must not expose a Classic Companion FreeLLMAPI LLM provider.'
)

assertIncludes(
  'package.json',
  'check:freellmapi-provider',
  'package.json must expose the FreeLLMAPI scope guardrail.'
)

console.log('check-freellmapi-provider-config: ok')
