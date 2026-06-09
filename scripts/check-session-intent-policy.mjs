import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)
const moduleCache = new Map()

function loadTs(relativePath) {
  const sourcePath = path.resolve(process.cwd(), relativePath)
  if (moduleCache.has(sourcePath)) return moduleCache.get(sourcePath).exports

  const source = readFileSync(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const module = { exports: {} }
  moduleCache.set(sourcePath, module)
  const dirname = path.dirname(sourcePath)
  const localRequire = (specifier) => {
    if (specifier.startsWith('@shared/')) {
      return loadTs(`src/shared/${specifier.slice('@shared/'.length)}.ts`)
    }
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(dirname, specifier)
      return loadTs(`${resolved}.ts`)
    }
    return nodeRequire(specifier)
  }

  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: localRequire,
    __dirname: dirname,
    __filename: sourcePath,
  }, { filename: sourcePath })
  return module.exports
}

const {
  SESSION_INTENT_SPECS,
  getTranscriptSpeakerLabel,
  isExternalAudioEntry,
  shouldAutoOpenAnswerWindowForExternalPrompt,
  shouldTreatExternalTranscriptAsPrompt,
  shouldUseExternalAudioPrompts,
  getSessionBehavior,
  normalizeSessionIntent,
} = loadTs('src/shared/session-intent-policy.ts')

assert.equal(normalizeSessionIntent('class'), 'class')
assert.equal(normalizeSessionIntent('lecture'), 'class')
assert.equal(normalizeSessionIntent('unknown-value'), 'interview')

assert.equal(SESSION_INTENT_SPECS.interview.externalTranscriptLabel, 'Interviewer')
assert.equal(SESSION_INTENT_SPECS.meeting.externalTranscriptLabel, 'Speaker')
assert.equal(SESSION_INTENT_SPECS.presentation.externalTranscriptLabel, 'Presenter')
assert.equal(SESSION_INTENT_SPECS.class.externalTranscriptLabel, 'Instructor')
assert.equal(SESSION_INTENT_SPECS['quick-help'].externalTranscriptLabel, 'System audio')

assert.equal(getSessionBehavior('interview').agentRole, 'live interview coach')
assert.equal(getSessionBehavior('interview').responseShape, 'first-person teleprompter or structured technical answer')
assert.match(getSessionBehavior('interview').screenCodePolicy, /solution code snippet first/)
assert.deepEqual(getSessionBehavior('interview').detailCapabilities.includes('teleprompter'), true)
assert.match(getSessionBehavior('interview').brainPolicy, /asked questions/)
assert.equal(getSessionBehavior('meeting').agentRole, 'live meeting copilot')
assert.equal(getSessionBehavior('meeting').autoTriggerStrategy, 'answer likely external requests and questions')
assert.deepEqual(getSessionBehavior('meeting').detailCapabilities.includes('notes'), true)
assert.equal(getSessionBehavior('presentation').responseShape, 'speaker notes, transitions, and concise Q&A responses')
assert.deepEqual(getSessionBehavior('presentation').detailCapabilities.includes('download-images'), true)
assert.equal(getSessionBehavior('class').agentRole, 'learning assistant')
assert.equal(getSessionBehavior('class').autoTriggerStrategy, 'passive lecture context unless a clear question or user request appears')
assert.match(getSessionBehavior('class').screenCodePolicy, /runnable answer\/code snippet in detail/)
assert.deepEqual(getSessionBehavior('class').detailCapabilities.includes('queue'), true)
assert.deepEqual(getSessionBehavior('class').detailCapabilities.includes('copy-code'), true)
assert.match(getSessionBehavior('class').brainPolicy, /study tasks/)
assert.equal(getSessionBehavior('quick-help').primaryInput, 'user-authored chat or microphone request')

const externalEntry = {
  id: '1',
  text: 'Can you explain the last slide?',
  speaker: 'interviewer',
  timestamp: Date.now(),
  isFinal: true,
  source: 'stt',
  audioSource: 'system',
}
const userEntry = {
  ...externalEntry,
  id: '2',
  speaker: 'user',
  audioSource: 'microphone',
}
const chatEntry = {
  ...userEntry,
  id: '3',
  source: 'chat',
}

assert.equal(getTranscriptSpeakerLabel(externalEntry, 'meeting'), 'Speaker')
assert.equal(getTranscriptSpeakerLabel(externalEntry, 'class'), 'Instructor')
assert.equal(getTranscriptSpeakerLabel(externalEntry, 'quick-help'), 'System audio')
assert.equal(getTranscriptSpeakerLabel(userEntry, 'class'), 'You')
assert.equal(getTranscriptSpeakerLabel(chatEntry, 'meeting'), 'Chat')
assert.equal(isExternalAudioEntry(externalEntry), true)
assert.equal(isExternalAudioEntry(userEntry), false)
assert.equal(isExternalAudioEntry(chatEntry), false)

assert.equal(shouldUseExternalAudioPrompts('interview'), true)
assert.equal(shouldUseExternalAudioPrompts('meeting'), true)
assert.equal(shouldUseExternalAudioPrompts('presentation'), true)
assert.equal(shouldUseExternalAudioPrompts('class'), true)
assert.equal(shouldUseExternalAudioPrompts('quick-help'), false)

assert.equal(shouldAutoOpenAnswerWindowForExternalPrompt('meeting'), true)
assert.equal(shouldAutoOpenAnswerWindowForExternalPrompt('presentation'), true)
assert.equal(shouldAutoOpenAnswerWindowForExternalPrompt('class'), false)
assert.equal(shouldAutoOpenAnswerWindowForExternalPrompt('interview'), false)
assert.equal(shouldTreatExternalTranscriptAsPrompt('class', 'Today we are learning about closures and lexical scope.'), false)
assert.equal(shouldTreatExternalTranscriptAsPrompt('class', 'Can someone explain why this closure still has access to count?'), true)
assert.equal(shouldTreatExternalTranscriptAsPrompt('meeting', 'Can someone summarize the risk before we move on?'), true)
assert.equal(shouldTreatExternalTranscriptAsPrompt('quick-help', 'Can someone summarize the risk before we move on?'), false)

const transcriptSource = readFileSync('src/renderer/overlay/components/Transcript.tsx', 'utf8')
assert.doesNotMatch(
  transcriptSource,
  /return <span[^>]*>Interviewer<\/span>/,
  'Transcript must not hardcode Interviewer as the fallback speaker label'
)
assert.match(
  transcriptSource,
  /getTranscriptSpeakerLabel/,
  'Transcript must use intent-aware speaker labels'
)

const setupSource = readFileSync('src/renderer/overlay/components/setup/InterviewSetup.tsx', 'utf8')
const setupShellSource = readFileSync('src/renderer/overlay/components/setup/SessionSetup.tsx', 'utf8')
const sttSource = readFileSync('src/main/services/stt-service.ts', 'utf8')
const whisperSource = readFileSync('src/main/services/local-ai/providers/whisper-cpp-stt-service.ts', 'utf8')
const answerPrepSource = readFileSync('src/main/services/answer-prep-service.ts', 'utf8')
const answerRequestSource = readFileSync('src/main/services/answer-request-service.ts', 'utf8')
const ipcSource = readFileSync('src/main/ipc-handlers.ts', 'utf8')
const promptsSource = readFileSync('src/shared/prompts.ts', 'utf8')
const persistenceSource = readFileSync('src/main/services/session-persistence-service.ts', 'utf8')
const contextManagerSource = readFileSync('src/main/services/context-manager.ts', 'utf8')
const recallContextSource = readFileSync('src/main/services/memory/recall-context.ts', 'utf8')
const extractionSource = readFileSync('src/main/services/memory/extraction-service.ts', 'utf8')
const heartbeatSource = readFileSync('src/main/services/agent/heartbeat-service.ts', 'utf8')
const overlaySource = readFileSync('src/renderer/overlay/App.tsx', 'utf8')
const aiSuggestionSource = readFileSync('src/renderer/overlay/components/AISuggestion.tsx', 'utf8')
const richContentSource = readFileSync('src/renderer/overlay/components/RichContent.tsx', 'utf8')
const answerQueueSource = readFileSync('src/renderer/overlay/components/AnswerQueue.tsx', 'utf8')
const meetingNotesSource = readFileSync('src/renderer/overlay/components/MeetingNotes.tsx', 'utf8')
const controlsSource = readFileSync('src/renderer/overlay/components/Controls.tsx', 'utf8')
const sessionBrainServiceSource = readFileSync('src/main/services/agent/session-brain-service.ts', 'utf8')
const sessionBrainPromptsSource = readFileSync('src/main/services/agent/session-brain-prompts.ts', 'utf8')
const sessionBrainMergerSource = readFileSync('src/main/services/agent/session-brain-merger.ts', 'utf8')
const toolDefinitionsSource = readFileSync('src/main/services/agent/tool-definitions.ts', 'utf8')

assert.match(setupSource, /value: 'class'/, 'Live setup must expose a dedicated class intent')
assert.match(setupSource, /getSessionIntentSpec/, 'Live setup must read labels from session intent policy')
assert.doesNotMatch(setupShellSource, /Speech-led answers for interviews, meetings, presentations\./)
assert.match(setupShellSource, /Live Session/)
assert.match(sttSource, /audioSource/, 'Deepgram STT entries must include audioSource')
assert.match(whisperSource, /audioSource/, 'Whisper STT entries must include audioSource')
assert.match(answerPrepSource, /isExternalAudioEntry/, 'answer-prep must use shared external audio predicate')
assert.match(answerPrepSource, /shouldUseExternalAudioPrompts/, 'answer-prep must route prompts by session intent policy')
assert.match(answerPrepSource, /shouldTreatExternalTranscriptAsPrompt/, 'answer-prep must use intent-specific prompt trigger policy')
assert.match(answerRequestSource, /shouldGenerateForAutoPrompt/, 'auto-answer requests must use intent-specific trigger policy')
assert.doesNotMatch(answerPrepSource, /entry\.speaker === 'interviewer'/, 'answer-prep must not hardcode interviewer as semantic external speaker')
assert.match(ipcSource, /shouldAutoOpenAnswerWindowForExternalPrompt/, 'answer window routing must use session intent policy')
assert.doesNotMatch(ipcSource, /intent !== 'meeting' && intent !== 'presentation'/, 'answer window routing must not special-case only meeting and presentation')
assert.match(promptsSource, /getSessionBehavior/, 'prompts must read the shared behavior contract')
assert.match(promptsSource, /case 'class':/, 'prompts must define class-specific guidance')
assert.match(promptsSource, /Class Guidance/, 'class prompt must be study-oriented')
assert.match(persistenceSource, /case 'class':/, 'session titles must handle class sessions')
assert.match(contextManagerSource, /case 'class':/, 'context formatting must handle class sessions')
assert.match(recallContextSource, /getSessionBehavior/, 'recall context must include the session behavior contract')
assert.match(recallContextSource, /brainPolicy/, 'recall context must expose intent-aware brain policy')
assert.match(extractionSource, /brainPolicy|SESSION_INTENT_SPECS|getSessionBehavior/, 'memory extraction must account for intent-specific remembering')
assert.match(heartbeatSource, /getSessionBehavior/, 'heartbeat must receive behavior policy for proactive reasoning')
assert.match(overlaySource, /detailCapabilities/, 'answer view tabs must be driven by intent detail capabilities')
assert.match(aiSuggestionSource, /detailCapabilities/, 'detail window controls must be driven by intent detail capabilities')
assert.match(richContentSource, /copy-code|download-images|downloadImage/, 'rich content must expose code/image affordances for detail output')
assert.match(toolDefinitionsSource, /detail window.*session intent|session intent.*detail window/i, 'detail tools must describe intent-aware use')
assert.match(overlaySource, /value === 'class'/, 'overlay session-intent validator must accept class sessions')
assert.match(ipcSource, /sendToAnswer\(IPC\.SESSION_STATE/, 'answer window must receive session state broadcasts')
assert.match(ipcSource, /sendToAnswer\(IPC\.TRANSCRIPT_UPDATE/, 'answer window must receive transcript updates for queue and notes')
assert.match(answerQueueSource, /getTranscriptSpeakerLabel/, 'answer queue cards must render intent-aware speaker labels')
assert.match(meetingNotesSource, /getTranscriptSpeakerLabel/, 'notes cards must render intent-aware speaker labels')
assert.match(meetingNotesSource, /StudyNotesSnapshot/, 'class study notes must render brain-powered snapshots')
assert.match(ipcSource, /STUDY_NOTES_UPDATE/, 'main process must broadcast live study note snapshots')
assert.match(sessionBrainServiceSource, /recordUsage/, 'session brain LLM calls must feed the session token meter')
assert.match(controlsSource, /isSessionActive \|\| totalTokens > 0/, 'control bar token meter must remain visible during live sessions')
assert.match(sessionBrainPromptsSource, /Add at most 3 bullets total/, 'brain prompt must prevent note spam')
assert.match(sessionBrainPromptsSource, /2-4 concise sentences/, 'brain prompt must ask for explanatory study notes')
assert.match(sessionBrainServiceSource, /STUDY_NOTE_LIMITS/, 'study notes snapshot must be curated for the UI')
assert.match(sessionBrainMergerSource, /SECTION_LIMITS/, 'session brain summary must cap accumulated bullets')
assert.match(ipcSource, /finalStudyNotes/, 'session stop must capture final brain study notes before saving')
assert.match(contextManagerSource, /buildStudyNotesMd/, 'notes.md must render brain-powered class study notes')
assert.match(contextManagerSource, /## Resources/, 'saved study notes must include resource URLs')

const semanticFiles = [
  'src/main/services/answer-prep-service.ts',
  'src/main/services/llm-service.ts',
  'src/renderer/overlay/App.tsx',
  'src/renderer/overlay/components/Transcript.tsx',
  'src/renderer/canvas/components/ControlBar.tsx',
]

for (const file of semanticFiles) {
  const source = readFileSync(file, 'utf8')
  assert.doesNotMatch(
    source,
    /speaker\s*={3}\s*['"]interviewer['"]|speaker\s*!==\s*['"]user['"]/,
    `${file} must use session-intent transcript helpers instead of semantic interviewer checks`
  )
}

console.log('check-session-intent-policy: taxonomy and transcript labels OK')
