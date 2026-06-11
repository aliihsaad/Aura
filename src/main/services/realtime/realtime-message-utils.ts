import type { ToolCallRequest, ToolDefinition } from '@shared/types'

export interface RealtimeAudioChunk {
  data: string
  mimeType: string
}

export interface RealtimeToolResponse {
  id: string
  name: string
  result: string
}

export interface RealtimeServerMessageSummary {
  text: string
  inputTranscription?: string
  outputTranscription?: string
  audioChunks: RealtimeAudioChunk[]
  toolCalls: ToolCallRequest[]
  interrupted: boolean
  turnComplete: boolean
  setupComplete: boolean
  usage?: Record<string, unknown>
}

export interface RealtimeSetupMessageOptions {
  model: string
  responseModalities?: string[]
  temperature?: number
  instructions?: string
  voice?: string
  inputAudioTranscription?: boolean
  outputAudioTranscription?: boolean
  tools?: ToolDefinition[]
}

const DEFAULT_OUTPUT_AUDIO_MIME_TYPE = 'audio/pcm;rate=24000'

type JsonRecord = Record<string, unknown>

export function createRealtimeSetupMessage(
  options: RealtimeSetupMessageOptions
): Record<string, unknown> {
  const responseModalities =
    options.responseModalities && options.responseModalities.length > 0
      ? options.responseModalities
      : ['AUDIO']
  const generationConfig: JsonRecord = {
    responseModalities,
  }

  if (typeof options.temperature === 'number') {
    generationConfig.temperature = options.temperature
  }

  const voice = cleanString(options.voice)
  if (voice && responseModalitiesIncludeAudio(generationConfig.responseModalities)) {
    generationConfig.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voice,
        },
      },
    }
  }

  const setup: JsonRecord = {
    model: normalizeGeminiLiveModel(options.model),
    generationConfig,
  }

  const instructions = cleanString(options.instructions)
  if (instructions) {
    setup.systemInstruction = {
      parts: [{ text: instructions }],
    }
  }

  if (options.inputAudioTranscription) {
    setup.inputAudioTranscription = {}
  }

  if (options.outputAudioTranscription) {
    setup.outputAudioTranscription = {}
  }

  const functionDeclarations = toolFunctionDeclarations(options.tools)
  if (functionDeclarations.length > 0) {
    setup.tools = [{ functionDeclarations }]
  }

  return { setup }
}

/** Gemini 3.1 Flash Live expects mic frames as `realtimeInput.audio`; the
 * older native-audio models still want `realtimeInput.mediaChunks`. Sending
 * the wrong shape disconnects the session as soon as the mic starts. */
export function usesAudioWireFormat(model: string): boolean {
  return /3\.1-flash-live/i.test(model)
}

export function createRealtimeAudioInputMessage(
  data: string,
  sampleRate = 16000,
  audioWireFormat = false
): Record<string, unknown> {
  const mimeType = `audio/pcm;rate=${sampleRate}`
  if (audioWireFormat) {
    return {
      realtimeInput: {
        audio: { data, mimeType },
      },
    }
  }
  return {
    realtimeInput: {
      mediaChunks: [
        {
          data,
          mimeType,
        },
      ],
    },
  }
}

export function createRealtimeAudioStreamEndMessage(): Record<string, unknown> {
  return {
    realtimeInput: {
      audioStreamEnd: true,
    },
  }
}

export function createRealtimeToolResponseMessage(
  responses: RealtimeToolResponse[]
): Record<string, unknown> {
  return {
    toolResponse: {
      functionResponses: responses.map((response) => ({
        id: response.id,
        name: response.name,
        response: {
          result: response.result,
        },
      })),
    },
  }
}

export function summarizeRealtimeServerMessage(
  message: unknown
): RealtimeServerMessageSummary {
  const root = asRecord(message)
  const serverContent = getRecord(root, 'serverContent', 'server_content')
  const content = serverContent ?? root
  const parts = collectParts(root, content)
  const textParts = parts
    .map((part) => partText(part))
    .filter((text) => text.length > 0)

  if (textParts.length === 0) {
    const directText = firstCleanString(
      getValue(content, 'text', 'text'),
      getValue(root, 'text', 'text')
    )
    if (directText) {
      textParts.push(directText)
    }
  }

  const inputTranscription = firstCleanString(
    transcriptText(getValue(content, 'inputTranscription', 'input_transcription')),
    transcriptText(getValue(root, 'inputTranscription', 'input_transcription')),
    transcriptText(getValue(content, 'inputAudioTranscription', 'input_audio_transcription')),
    transcriptText(getValue(root, 'inputAudioTranscription', 'input_audio_transcription'))
  )
  const outputTranscription = firstCleanString(
    transcriptText(getValue(content, 'outputTranscription', 'output_transcription')),
    transcriptText(getValue(root, 'outputTranscription', 'output_transcription')),
    transcriptText(getValue(content, 'outputAudioTranscription', 'output_audio_transcription')),
    transcriptText(getValue(root, 'outputAudioTranscription', 'output_audio_transcription'))
  )
  const usage = firstRecord(
    getValue(root, 'usageMetadata', 'usage_metadata'),
    getValue(content, 'usageMetadata', 'usage_metadata'),
    getValue(root, 'usage', 'usage'),
    getValue(content, 'usage', 'usage')
  )

  return {
    text: textParts.join(''),
    inputTranscription: inputTranscription || undefined,
    outputTranscription: outputTranscription || undefined,
    audioChunks: parts.flatMap((part) => partAudioChunks(part)),
    toolCalls: collectToolCalls(root, content, parts),
    interrupted: booleanValue(
      getValue(content, 'interrupted', 'interrupted'),
      getValue(root, 'interrupted', 'interrupted')
    ),
    turnComplete: booleanValue(
      getValue(content, 'turnComplete', 'turn_complete'),
      getValue(root, 'turnComplete', 'turn_complete')
    ),
    setupComplete: presenceFlag(
      getValue(root, 'setupComplete', 'setup_complete'),
      getValue(content, 'setupComplete', 'setup_complete')
    ),
    usage: usage ? { ...usage } : undefined,
  }
}

function normalizeGeminiLiveModel(model: string): string {
  const cleaned = cleanString(model) || 'auto'
  return cleaned.startsWith('models/') ? cleaned : `models/${cleaned}`
}

function responseModalitiesIncludeAudio(value: unknown): boolean {
  return Array.isArray(value) &&
    value.some((item) => typeof item === 'string' && item.toUpperCase() === 'AUDIO')
}

function toolFunctionDeclarations(tools: ToolDefinition[] | undefined): JsonRecord[] {
  if (!tools || tools.length === 0) return []

  return tools
    .map((tool) => {
      const name = cleanString(tool.function.name)
      if (!name) return null
      const declaration: JsonRecord = {
        name,
        description: cleanString(tool.function.description) || undefined,
      }
      if (tool.function.parameters && typeof tool.function.parameters === 'object') {
        declaration.parameters = tool.function.parameters
      }
      return Object.fromEntries(
        Object.entries(declaration).filter(([, value]) => value !== undefined)
      ) as JsonRecord
    })
    .filter((declaration): declaration is JsonRecord => Boolean(declaration))
}

function collectParts(root: JsonRecord | null, content: JsonRecord | null): unknown[] {
  const parts: unknown[] = []
  appendRecordParts(parts, content)
  appendRecordParts(parts, getRecord(content, 'modelTurn', 'model_turn'))
  appendRecordParts(parts, getRecord(root, 'modelTurn', 'model_turn'))
  appendCandidateParts(parts, root)
  appendCandidateParts(parts, content)
  return parts
}

function appendRecordParts(target: unknown[], record: JsonRecord | null): void {
  const parts = getArray(record, 'parts', 'parts')
  if (parts) {
    target.push(...parts)
  }
}

function appendCandidateParts(target: unknown[], record: JsonRecord | null): void {
  const candidates = getArray(record, 'candidates', 'candidates')
  if (!candidates) return

  for (const candidate of candidates) {
    const candidateRecord = asRecord(candidate)
    appendRecordParts(target, candidateRecord)
    appendRecordParts(target, getRecord(candidateRecord, 'content', 'content'))
  }
}

function partText(part: unknown): string {
  if (typeof part === 'string') return part
  const record = asRecord(part)
  return firstCleanString(getValue(record, 'text', 'text'))
}

function partAudioChunks(part: unknown): RealtimeAudioChunk[] {
  const record = asRecord(part)
  const inlineData = getRecord(record, 'inlineData', 'inline_data')
  const data = firstCleanString(getValue(inlineData, 'data', 'data'))
  if (!data) return []

  return [
    {
      data,
      mimeType:
        firstCleanString(getValue(inlineData, 'mimeType', 'mime_type')) ||
        DEFAULT_OUTPUT_AUDIO_MIME_TYPE,
    },
  ]
}

function collectToolCalls(
  root: JsonRecord | null,
  content: JsonRecord | null,
  parts: unknown[]
): ToolCallRequest[] {
  const calls: ToolCallRequest[] = []
  appendToolCallContainer(calls, root)
  appendToolCallContainer(calls, content)
  appendToolCallContainer(calls, getRecord(root, 'toolCall', 'tool_call'))
  appendToolCallContainer(calls, getRecord(content, 'toolCall', 'tool_call'))

  for (const part of parts) {
    const record = asRecord(part)
    const functionCall = getRecord(record, 'functionCall', 'function_call')
    if (functionCall) appendFunctionCall(calls, functionCall)
  }

  return dedupeToolCalls(calls)
}

function appendToolCallContainer(target: ToolCallRequest[], container: JsonRecord | null): void {
  if (!container) return
  const functionCalls = getArray(container, 'functionCalls', 'function_calls')
  if (functionCalls) {
    for (const call of functionCalls) {
      appendFunctionCall(target, asRecord(call))
    }
  }

  const functionCall = getRecord(container, 'functionCall', 'function_call')
  if (functionCall) appendFunctionCall(target, functionCall)
}

function appendFunctionCall(target: ToolCallRequest[], functionCall: JsonRecord | null): void {
  if (!functionCall) return
  const name = firstCleanString(getValue(functionCall, 'name', 'name'))
  if (!name) return

  const id =
    firstCleanString(
      getValue(functionCall, 'id', 'id'),
      getValue(functionCall, 'callId', 'call_id')
    ) || `rt_call_${target.length + 1}`
  target.push({
    id,
    function: {
      name,
      arguments: normalizeFunctionCallArgs(getValue(functionCall, 'args', 'args')),
    },
  })
}

function normalizeFunctionCallArgs(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return '{}'
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

function dedupeToolCalls(calls: ToolCallRequest[]): ToolCallRequest[] {
  const seen = new Set<string>()
  const deduped: ToolCallRequest[] = []
  for (const call of calls) {
    const key = `${call.id}:${call.function.name}:${call.function.arguments}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(call)
  }
  return deduped
}

function transcriptText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((item) => transcriptText(item))
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  const record = asRecord(value)
  if (!record) return ''

  const direct = firstCleanString(
    getValue(record, 'text', 'text'),
    getValue(record, 'transcript', 'transcript')
  )
  if (direct) return direct

  const parts = getArray(record, 'parts', 'parts')
  if (!parts) return ''

  return parts
    .map((part) => partText(part))
    .filter(Boolean)
    .join('')
    .trim()
}

function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value)
    if (record) return record
  }
  return null
}

function booleanValue(...values: unknown[]): boolean {
  for (const value of values) {
    if (value === true || value === 'true' || value === 1) return true
  }
  return false
}

function presenceFlag(...values: unknown[]): boolean {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== false) return true
  }
  return false
}

function firstCleanString(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanString(value)
    if (cleaned) return cleaned
  }
  return ''
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getRecord(
  record: JsonRecord | null,
  camelCase: string,
  snakeCase: string
): JsonRecord | null {
  return asRecord(getValue(record, camelCase, snakeCase))
}

function getArray(
  record: JsonRecord | null,
  camelCase: string,
  snakeCase: string
): unknown[] | null {
  const value = getValue(record, camelCase, snakeCase)
  return Array.isArray(value) ? value : null
}

function getValue(
  record: JsonRecord | null,
  camelCase: string,
  snakeCase: string
): unknown {
  if (!record) return undefined
  if (Object.prototype.hasOwnProperty.call(record, camelCase)) {
    return record[camelCase]
  }
  if (Object.prototype.hasOwnProperty.call(record, snakeCase)) {
    return record[snakeCase]
  }
  return undefined
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}
