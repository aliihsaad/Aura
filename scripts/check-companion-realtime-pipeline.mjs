import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), 'utf8')
}

function loadTsExports(filePath) {
  const source = read(filePath)
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(transpiled, {
    exports: module.exports,
    module,
    console,
  }, { filename: filePath })
  return module.exports
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

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'createRealtimeAudioInputMessage',
  'Realtime message helper must build audio input messages.'
)

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'summarizeRealtimeServerMessage',
  'Realtime message helper must summarize server events.'
)

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'functionDeclarations',
  'Realtime setup must advertise Whisphry tool declarations to the realtime model.'
)

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'createRealtimeToolResponseMessage',
  'Realtime message helper must build tool response messages.'
)

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'toolCalls:',
  'Realtime server summaries must expose parsed tool calls.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'class FreeLlmApiRealtimeClient',
  'FreeLLMAPI realtime client must exist.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  '/realtime/sessions',
  'Realtime client must mint FreeLLMAPI realtime sessions.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'sendAudioChunk',
  'Realtime client must expose audio chunk sending.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'sendToolResponses',
  'Realtime client must expose tool response sending.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'voice: this.wantsAudioOutput()',
  'Realtime text-output mode must not send a voice to the session mint request.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'instructions: cleanValue(this.options.instructions) || undefined',
  'Realtime session mint must forward optional instructions.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'private openSocket(session: RealtimeSessionResponse',
  'Realtime socket setup must receive the full session response.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'resolveSessionSetupOptions(session)',
  'Realtime socket setup must derive setup options from the minted session.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'responseModalities: session.config.responseModalities',
  'Realtime socket setup must prefer session response modalities.'
)

assertIncludes(
  'src/main/services/realtime/realtime-message-utils.ts',
  'responseModalitiesIncludeAudio(generationConfig.responseModalities)',
  'Realtime setup must only include speechConfig when AUDIO output is requested.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'private mintController: AbortController | null = null',
  'Realtime client must keep an abort controller for in-flight session minting.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'signal: controller.signal',
  'Realtime session mint fetch must be abortable.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'this.mintController?.abort()',
  'Realtime stop must abort in-flight session minting.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'isActiveSocket(generation, socket)',
  'Realtime socket handlers must guard against stale socket generations.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'if (!connection.isActive()) return',
  'Realtime message handling must re-check active socket state after async decode.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'connectSettled = true\n        closeSocket(socket)',
  'Realtime pre-live rejection must close the rejected socket.'
)

assertIncludes(
  'package.json',
  'check:companion-realtime',
  'package.json must expose realtime guardrail.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'export class CompanionRealtimePipeline',
  'Dedicated realtime pipeline class must exist.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'new LLMService(d.openrouterApiKey, d.defaultModel)',
  'Realtime Companion must initialize the OpenRouter LLM service so Detail/OpenRouter tool routing works.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'private attachLlmListeners(llmService: LLMService): void',
  'Realtime Companion must bind OpenRouter LLM stream events to the Detail window pipeline.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "llmService.on('chunk'",
  'Realtime Companion must forward OpenRouter chunks into the Detail window.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "llmService.on('done'",
  'Realtime Companion must forward OpenRouter completion into the Detail window.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "llmService.on('error'",
  'Realtime Companion must forward OpenRouter errors into the Detail window.'
)

assertIncludes(
  'src/main/services/agent/tool-definitions.ts',
  'solveWithOpenRouter?: (question: string) => Promise<string> | string',
  'solve_with_openrouter must be awaitable so realtime tool execution cannot race the Detail answer stream.'
)

assertIncludes(
  'src/main/services/agent/tool-definitions.ts',
  'return await executeSolveWithOpenRouter(deps, args)',
  'The shared tool executor must await solve_with_openrouter.'
)

assertIncludes(
  'src/main/services/agent/tool-definitions.ts',
  'await deps.solveWithOpenRouter(question)',
  'solve_with_openrouter must wait for delegated OpenRouter answer completion.'
)

assertNotIncludes(
  'src/main/ipc-handlers.ts',
  'void runManualAnswer(cleanQuestion)',
  'Realtime OpenRouter delegation must not fire-and-forget the manual answer path.'
)

assertIncludes(
  'src/main/pipelines/index.ts',
  'companionRealtime?',
  'Pipeline builders must expose a realtime Companion builder.'
)

assertIncludes(
  'src/main/pipelines/index.ts',
  "companionEngine: () => 'classic' | 'realtime-beta'",
  'Pipeline factory must choose Companion engine through an injected getter.'
)

assertIncludes(
  'src/main/pipelines/index.ts',
  'new CompanionRealtimePipeline',
  'Pipeline factory must instantiate realtime pipeline when selected.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'companionRealtime: () =>',
  'ipc-handlers must register realtime pipeline deps.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "case 'turn-complete':",
  'Realtime pipeline must end each realtime voice turn cleanly.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'this.deps.emitVoiceAudioEnd()',
  'Realtime pipeline must emit voice audio end for completed turns.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'this.deps.onTranscript',
  'Realtime pipeline must use the injected transcript callback.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "audioSource: 'microphone'",
  'Realtime input transcripts must be tagged as microphone audio.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "case 'input-transcript':\n        this.emitRealtimeTranscript({\n          text: event.text,\n          speaker: 'user',\n          audioSource: 'microphone',\n          suppressHeartbeat: true,",
  'Realtime input transcript entries must not trigger Classic Companion heartbeat.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "case 'output-transcript':",
  'Realtime output transcripts must be handled.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "case 'text':",
  'Realtime text events must be handled.'
)

const realtimePipelineSource = read('src/main/pipelines/companion-realtime-pipeline.ts')
assert.doesNotMatch(
  realtimePipelineSource,
  /case 'output-transcript':[\s\S]{0,700}emitRealtimeTranscript/,
  'Realtime assistant output transcripts must not be emitted as transcript/chat rows; they belong in the Companion bubble stream.'
)
assert.doesNotMatch(
  realtimePipelineSource,
  /case 'text':[\s\S]{0,700}emitRealtimeTranscript/,
  'Realtime assistant text events must not be emitted as transcript/chat rows; they belong in the Companion bubble stream.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "this.handleTerminalRealtimeEvent('stopped')",
  'Unexpected realtime client stop must clean up capture and listeners.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  "this.handleTerminalRealtimeEvent('failed', event.error)",
  'Realtime client errors must clean up capture and listeners.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'client.off(\'event\', this.handleClientEvent)\n    try {\n      client.endAudioStream()',
  'Realtime client cleanup must detach event listeners before stopping the client.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'private handleTerminalRealtimeEvent(status: \'failed\' | \'stopped\', error?: Error): void',
  'Realtime pipeline must centralize terminal event cleanup.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'const shouldNotifyHeartbeat = !options.suppressHeartbeat && !transcriptIsAgentOutput',
  'Transcript heartbeat activity notification must respect realtime suppression.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'if (shouldNotifyHeartbeat) {\n      heartbeatService.notifyActivity()\n    }',
  'Suppressed realtime transcripts must not notify classic Companion heartbeat activity.'
)

assertIncludes(
  'src/main/services/session-state-service.ts',
  'companionRealtimeStatus',
  'Session state service must broadcast realtime status.'
)

assertIncludes(
  'src/main/services/session-state-service.ts',
  'companionEngine',
  'Session state service must broadcast Companion engine.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'companionRealtimeStatus: sessionRuntimeStore.companionRealtimeStatus',
  'ipc-handlers must include realtime status in session state.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'companionEngine: modeConfig.getCompanionModeConfig().engine',
  'ipc-handlers must include Companion engine in session state.'
)

assertIncludes(
  'src/renderer/overlay/App.tsx',
  'companionRealtimeStatus',
  'Overlay must receive realtime status.'
)

assertIncludes(
  'src/renderer/overlay/components/Controls.tsx',
  'companionRealtimeStatus',
  'Overlay controls must display realtime status.'
)

assertIncludes(
  'src/renderer/canvas/components/ControlBar.tsx',
  'companionRealtimeStatus',
  'Canvas control bar must display realtime status.'
)

assertNotIncludes(
  'src/main/ipc-handlers.ts',
  'startClassicCompanionFallbackAfterRealtimeStartFailure',
  'Realtime Beta startup failures must not silently switch to Classic.'
)

assertNotIncludes(
  'src/main/ipc-handlers.ts',
  'falling back to Classic Companion',
  'Realtime Beta must not log or perform an automatic Classic fallback.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  "typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'",
  'Realtime client must decode Blob messages whose arrayBuffer method is on the prototype.'
)

assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  "type: 'tool-call'",
  'Realtime client must emit parsed tool-call events to the pipeline.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'executeToolCall',
  'Realtime pipeline must execute Whisphry tools.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'sendToolResponses',
  'Realtime pipeline must return tool results to the realtime session.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'tools: getRealtimeCompanionToolDefinitions()',
  'Realtime builder must pass the filtered Companion tool set into the realtime client.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'executeToolCall: buildSharedToolExecutor',
  'Realtime builder must reuse the Classic Companion shared tool executor.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'getRealtimeCompanionToolDefinitions',
  'Realtime builder must use the same filtered Companion tool surface as Classic heartbeat.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'handleRealtimeCompanionTextToken',
  'Realtime text tokens must update the Companion bubble instead of only persisting/TTS.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'inputAudioTranscription: true',
  'Realtime Beta must keep Gemini input transcription enabled for transcript/tool observability.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'streaming: true',
  'Realtime Companion bubble must show streaming state while output text arrives.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  "responseModalities: ['AUDIO']",
  'Realtime Beta must keep Gemini Live in audio-compatible mode for microphone streaming.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'playRealtimeAudio: true',
  'Realtime Beta must play Gemini/FreeLLMAPI native realtime audio instead of delaying speech through Companion TTS.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'outputAudioTranscription: true',
  'Realtime Beta must keep output transcription enabled so the native realtime audio also updates the Companion bubble.'
)

const ipcHandlersSource = read('src/main/ipc-handlers.ts')
assert.doesNotMatch(
  ipcHandlersSource,
  /function handleRealtimeCompanionTextStart\(\): void \{[\s\S]{0,300}handleCompanionTextStart\(\)/,
  'Realtime Companion must not start the classic/Deepgram Companion TTS path when Gemini native audio owns speech.'
)
assert.doesNotMatch(
  ipcHandlersSource,
  /function handleRealtimeCompanionTextEnd\(fullText: string\): void \{[\s\S]{0,900}handleCompanionTextEnd\(trimmed\)/,
  'Realtime Companion must not speak final Gemini transcripts again through Companion TTS.'
)
assertIncludes(
  'src/main/ipc-handlers.ts',
  'persistCompanionBubbleAnswer(trimmed)',
  'Realtime Companion must still persist native-audio transcript text as the session answer.'
)
assertIncludes(
  'src/main/ipc-handlers.ts',
  'Realtime audio is the spoken output.',
  'Realtime instructions must tell Gemini that native realtime audio, not Deepgram TTS, owns the spoken reply.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'mergeAssistantTranscript',
  'Realtime pipeline must merge output transcripts into the Companion text/TTS path.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'sanitizeRealtimeAssistantOutput',
  'Realtime pipeline must sanitize Gemini Live output transcripts before persisting or speaking them.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'if (!cleanedText) return',
  'Realtime pipeline must drop private planning/meta output chunks instead of saving them.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'Never narrate planning, hidden reasoning, or status analysis.',
  'Realtime instructions must explicitly forbid narrated planning/status analysis.'
)

assertIncludes(
  'src/main/services/context-manager.ts',
  'getPersistedTranscriptSpeakerLabel',
  'Saved transcript.md must not label realtime assistant output as Interviewer.'
)

const realtimeClientSource = read('src/main/services/realtime/freellmapi-realtime-client.ts')
assertIncludes(
  'src/main/services/realtime/freellmapi-realtime-client.ts',
  'scheduleReconnectAfterLiveClose',
  'Unexpected live FreeLLMAPI socket closes must reconnect instead of silently stopping capture.'
)
assert.doesNotMatch(
  realtimeClientSource,
  /activeAtClose && !manualStop && this\.status === 'live'[\s\S]{0,180}this\.setStatus\('stopped'\)/,
  'Unexpected live FreeLLMAPI socket closes must not be reported as a normal stopped session.'
)

assertIncludes(
  'src/main/ipc-handlers.ts',
  'const sessionStopTelemetryCounts',
  'Session stop telemetry must snapshot persisted counts before saveCurrentSession clears buffers.'
)

assert.doesNotMatch(
  realtimePipelineSource,
  /shouldRouteRealtimeInputToDetail|routeDeterministicRequest|beginDeterministicToolRoute|queueDeterministic(?:Detail|Screen)Request|executeDeterministic(?:Detail|Screen)Request|handleSupervisorTranscript|supervisorSttService/,
  'Realtime Companion must rely on native Gemini tool calls instead of deterministic regex/supervisor routing.'
)

assert.doesNotMatch(
  ipcHandlersSource,
  /handleRealtimeCompanion(?:Detail|Screen)Request|handle(?:Detail|Screen)Request:|isScreenRequest: isExplicitScreenInspectionQuestion|createSupervisorSttService: createSelectedSttService/,
  'Realtime builder must not wire deterministic screen/detail fallback handlers after native tool calls are verified.'
)

const { sanitizeRealtimeAssistantOutput } = loadTsExports('src/main/pipelines/companion-realtime-output.ts')

assert.equal(
  sanitizeRealtimeAssistantOutput(
    '**Acknowledge and Inquire**\n\nOkay, I see "Hallo" and "some data." I\'ll assume they want to do something with that data. I\'ll need to know what they\'re trying to do with it.'
  ),
  null,
  'Realtime sanitizer must drop observed planning blocks before they reach answers.md or TTS.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput(
    '**Framing the Greeting** I\'ve registered the user\'s "Hallo" and the session details: Ali, IronHack student, quick-help for an assessment. I\'m focusing on crafting a response that\'s friendly, conversational, and subtly directive, embodying the "boss" persona appropriate for the context. I\'m ready to begin the interaction.'
  ),
  null,
  'Realtime sanitizer must drop single-line planning blocks like the observed Framing the Greeting leak.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput(
    '**Identifying User Name**\n\nI\'ve homed in on the core of the request. My current focus is zeroing in on the User name within the available context. I\'m aiming to provide a direct and straightforward response, extracting the name from the information at hand. Your name Ali.'
  ),
  'Your name is Ali.',
  'Realtime sanitizer must keep only the user-facing tail when planning and final answer share one paragraph.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput(
    '**Recalling Ali\'s Name**\n\nI\'ve successfully retrieved the user\'s name, "Ali", from the profile context. I\'m now formulating a direct response to the user\'s inquiry, ready to provide their name in a clear and concise manner. Your name Ali.'
  ),
  'Your name is Ali.',
  'Realtime sanitizer must drop generic internal narration headings, not only a fixed heading whitelist.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput(
    '**Answering The Request**\n\nI\'m thinking through the user\'s request and formulating a concise response. Sure, I can help with that.'
  ),
  'Sure, I can help with that.',
  'Realtime sanitizer must strip generic thinking preambles, not only name-related examples.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput(
    'I\'m now crafting a response to the user\'s request. The answer is yes.'
  ),
  'The answer is yes.',
  'Realtime sanitizer must remove thinking preambles even without a markdown heading.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput(
    '**Confirming Reception Clearly**\n\nI\'m confirming that I am indeed receiving the input.\n\nYes, I can hear you perfectly.'
  ),
  'Yes, I can hear you perfectly.',
  'Realtime sanitizer must preserve user-facing text when it follows a planning block.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput('Hello! What are you looking to work with?'),
  'Hello! What are you looking to work with?',
  'Realtime sanitizer must preserve ordinary assistant replies.'
)

assert.equal(
  sanitizeRealtimeAssistantOutput('**Important**\n\nShip the patch now.'),
  'Ship the patch now.',
  'Realtime sanitizer must strip markdown headings from realtime spoken bubbles.'
)

assertIncludes(
  'src/main/pipelines/companion-realtime-pipeline.ts',
  'realtime failure after connect does not auto-switch',
  'Post-connect realtime failure must not silently switch to Classic.'
)

console.log('check-companion-realtime-pipeline: ok')
