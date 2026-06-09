import type { LocalAiConfig } from '@shared/local-ai-types'

export function resolveDeepgramSpeechInputKey(
  config: LocalAiConfig,
  getDeepgramKey: () => string
): string {
  if (config.sttProvider === 'whisper-local') {
    throw new Error('Whisper local speech input is selected; Deepgram speech input is not active.')
  }

  if (isLocalOnlyMode(config)) {
    throw new Error('Deepgram speech input is unavailable in the selected Local AI mode. Switch speech input to Whisper local or reset Local AI settings.')
  }

  const deepgramKey = getDeepgramKey()
  if (!deepgramKey) {
    throw new Error('Deepgram API key not configured')
  }
  return deepgramKey
}

function isLocalOnlyMode(config: LocalAiConfig): boolean {
  return config.mode === 'local-only'
}
