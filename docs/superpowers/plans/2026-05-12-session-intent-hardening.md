# Session Intent Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make interview, meeting, presentation, class, and quick-help sessions first-class runtime types, with transcript labels, trigger policy, prompt behavior, answer shape, and saved artifacts that match the selected session instead of treating every system-audio transcript as an interviewer.

**Architecture:** Add one shared session-intent taxonomy and behavior policy module, then move setup UI, transcript display, prompt routing, persistence titles, answer-trigger logic, and prompt posture to that module. Keep storage backward compatible by preserving existing transcript `speaker` values during this pass, but stop using `speaker === 'interviewer'` as a product meaning; use helpers like `isExternalAudioEntry()`, `getTranscriptSpeakerLabel()`, and `getSessionBehavior()` instead.

**Tech Stack:** Electron main process, React renderer, TypeScript shared modules, Node verification scripts using the repo's existing `typescript.transpileModule` loader pattern.

---

## Scope

This plan covers the live session family currently hidden under "Interview" mode:

| Intent | User meaning | System-audio transcript label | Agent posture | Trigger behavior |
| --- | --- | --- | --- | --- |
| `interview` | Job or technical interview support | `Interviewer` | Candidate coach; first-person ready-to-say answers; interview subtype matters | External/system audio questions drive answers; mic/chat are candidate/user context |
| `meeting` | Calls, reviews, stakeholder discussions | `Speaker` | Meeting copilot; diplomatic talk tracks, decisions, action phrasing | External/system audio prompts can open the answer window; mic/chat can refine or ask directly |
| `presentation` | Demos, talks, walkthroughs, Q&A | `Presenter` | Delivery coach; transitions, concise Q&A, slide/demo narration | External/system audio prompts can open the answer window; answer shape should be presentable aloud |
| `class` | Lessons, lectures, courses, workshops | `Instructor` | Learning assistant; notes, explanations, follow-up questions, study digest | External/system audio is lecture context, not an automatic answer request unless it looks like a real question or the user asks |
| `quick-help` | Companion-style direct help | `System audio` only if captured | Direct copilot; user-authored requests and concise bubbles | User chat/mic drives answers; system audio is passive context only |

The plan deliberately keeps `AgentMode = 'interview' | 'companion'` for now. "Interview" remains the pipeline name for speech-led live sessions, but the product-facing type becomes `SessionIntent`.

---

## Agent Behavior Contracts

Each session type must define these behavior fields in `src/shared/session-intent-policy.ts`, and prompts/runtime must read from them instead of scattering intent-specific branches:

| Field | Meaning |
| --- | --- |
| `agentRole` | One-line identity the prompt should use for the session |
| `primaryInput` | Which transcript source should drive proactive answers |
| `responseShape` | Default answer format and length |
| `autoTriggerStrategy` | How eager the app should be to answer without a manual click |
| `detailWindowPolicy` | Whether longer answers should prefer the detail window |
| `detailCapabilities` | Which detail-window controls and tabs should be available for the intent |
| `screenCodePolicy` | What to do when screenshots show code, tests, exercises, or coding prompts |
| `artifactPolicy` | What should be saved at session stop |
| `brainPolicy` | What the session brain should remember, summarize, and ignore |

Concrete contracts:

| Intent | `agentRole` | `primaryInput` | `responseShape` | `autoTriggerStrategy` | `detailWindowPolicy` | `detailCapabilities` | `screenCodePolicy` | `artifactPolicy` | `brainPolicy` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `interview` | Live interview coach | System audio questions | First-person teleprompter for spoken answers; structured code/design when needed | Answer only likely interviewer prompts; avoid reacting to filler | Use detail for code, diagrams, long structured answers | Detail, Queue, Teleprompter, Read aloud, Copy code, Sources | If screenshot shows a coding test/exercise, provide the solution code snippet first, then concise explanation and complexity | Save transcript and answers; no class digest | Remember role/company, asked questions, candidate stories, weak areas, coding prompts, and answer outcomes |
| `meeting` | Live meeting copilot | System audio prompts plus user chat/mic | Short diplomatic talk track, decision framing, action wording | Open answer window for likely requests/questions | Use detail for structured summaries or multi-step plans | Detail, Queue, Notes, Read aloud, Sources, Save memory | If code is visible, summarize risk/blocker unless the user asks for implementation | Save transcript, notes, answers | Remember decisions, action items, stakeholders, risks, deadlines, and open questions |
| `presentation` | Presentation delivery coach | Audience/system prompts plus user chat/mic | Speaker notes, transitions, concise Q&A responses | Open answer window for likely Q&A or delivery blockers | Use detail for slide-by-slide or longer narration | Detail, Queue, Teleprompter, Read aloud, Sources, Download images | If code/demo is visible, explain it as presenter narration, not as an interview solution | Save transcript, notes, answers | Remember deck/topic, audience objections, Q&A, demo issues, and follow-up commitments |
| `class` | Learning assistant | Instructor/system audio as context; user asks for help | Explanation, notes, examples, follow-up question; not candidate wording | Passive by default; do not pop answer window for every lecture segment | Use detail for summaries, study notes, code walkthroughs | Detail, Notes, Read aloud, Copy code, Sources, Save memory | If screenshot shows an exercise, failing test, or code task, provide a runnable answer/code snippet in detail, then explain the concept | Save transcript, notes, class digest | Remember topics, definitions, examples, exercises, mistakes, follow-up questions, and study tasks |
| `quick-help` | Direct local copilot | User chat/mic | Direct concise answer or tool action | User-authored only | Bubble first; detail for long/tool-heavy results | Detail, Read aloud, Copy code, Sources, Download images, Save memory | If user asks about visible code, provide the concrete edit/answer before explanation | Save transcript/answers only when session exists | Remember durable user preferences, project facts, and completed tasks; ignore throwaway chatter |

This is the product distinction the implementation must protect: the same audio channel can be system audio in all live sessions, but the agent's interpretation of that audio changes per `SessionIntent`.

---

## File Structure

Create:
- `src/shared/session-intent-policy.ts` - Canonical intent specs, behavior contracts, normalization, labels, transcript-entry predicates, and routing policy.
- `scripts/check-session-intent-policy.mjs` - Fast regression guard for taxonomy, labels, and routing helpers.

Modify:
- `src/shared/types.ts` - Add `class` to `SessionIntent`; add optional `audioSource` to `TranscriptEntry`; add `LiveSessionIntent` alias.
- `src/renderer/overlay/components/setup/InterviewSetup.tsx` - Rename product copy to live session setup and add a Class card.
- `src/renderer/overlay/components/setup/SessionSetup.tsx` - Rename setup tab label from Interview to Live; keep `agentMode: 'interview'` mapping.
- `src/renderer/overlay/App.tsx` - Pass current `SessionIntent` into transcript UI; replace local `speaker === 'interviewer'` meaning checks with shared helpers.
- `src/renderer/overlay/components/Transcript.tsx` - Use intent-aware speaker labels instead of hardcoded `Interviewer`.
- `src/renderer/overlay/components/AISuggestion.tsx` - Gate detail-window actions and labels by intent capabilities.
- `src/renderer/overlay/components/RichContent.tsx` - Ensure code/image/source affordances work consistently in detail output.
- `src/main/services/agent/tool-definitions.ts` - Make `open_answer_window` / detail tools describe intent-aware use.
- `src/main/services/stt-service.ts` - Tag STT transcript entries with `audioSource: 'system' | 'microphone'`.
- `src/main/services/local-ai/providers/whisper-cpp-stt-service.ts` - Same `audioSource` tagging for local Whisper entries.
- `src/main/services/answer-prep-service.ts` - Replace external/self prompt filtering with shared policy.
- `src/main/ipc-handlers.ts` - Replace meeting/presentation-only answer-window logic with policy helpers; update class stop/persistence behavior.
- `src/shared/prompts.ts` - Read behavior contracts where practical; add class-specific system prompt, question prompt, screenshot prompt, and intent descriptions.
- `src/main/services/session-persistence-service.ts` - Add class title behavior.
- `src/main/services/context-manager.ts` - Add class formatting and keep interview type display only for `interview`.
- `src/main/services/class-digest-service.ts` - Treat `class` as the primary digest intent instead of relying on meeting-like semantics.
- `src/shared/session-brain-types.ts` - Add intent-aware brain categories if the current brain schema needs them.
- `src/main/services/memory/recall-context.ts` - Include behavior/brain policy in recall context construction.
- `src/main/services/memory/extraction-service.ts` - Use intent-aware memory extraction hints instead of one generic transcript heuristic.
- `src/main/services/agent/heartbeat-service.ts` - Feed the behavior and brain policy into proactive reasoning so class/interview/meeting behavior diverges.
- `package.json` - Add `check:session-intents`.

---

### Task 1: Shared Session Intent Taxonomy

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/session-intent-policy.ts`
- Create: `scripts/check-session-intent-policy.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing policy check**

Create `scripts/check-session-intent-policy.mjs`:

```js
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

console.log('check-session-intent-policy: taxonomy and transcript labels OK')
```

- [ ] **Step 2: Run the failing check**

Run:

```bash
node scripts/check-session-intent-policy.mjs
```

Expected: FAIL with a missing module error for `src/shared/session-intent-policy.ts`.

- [ ] **Step 3: Add the shared types**

Modify `src/shared/types.ts`:

```ts
export type InterviewType = 'behavioral' | 'technical' | 'coding' | 'system-design' | 'general'
export type LiveSessionIntent = 'interview' | 'meeting' | 'presentation' | 'class'
export type SessionIntent = LiveSessionIntent | 'quick-help'
export type TranscriptAudioSource = 'system' | 'microphone' | 'chat'
```

Update `TranscriptEntry`:

```ts
export interface TranscriptEntry {
  id: string
  text: string
  speaker: 'interviewer' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  source?: 'stt' | 'chat'
  audioSource?: TranscriptAudioSource
}
```

- [ ] **Step 4: Add the policy module**

Create `src/shared/session-intent-policy.ts`:

```ts
import type { SessionIntent, TranscriptEntry } from './types'

export interface SessionIntentSpec {
  intent: SessionIntent
  label: string
  setupDescription: string
  externalTranscriptLabel: string
  subjectLabel: string
  organizationLabel: string
  roleLabel: string
  notesLabel: string
  answerStyleLabel: string
  usesInterviewType: boolean
  usesExternalAudioPrompts: boolean
  externalPromptMode: 'question-or-request' | 'question-only' | 'passive' | 'none'
  autoOpenAnswerWindowForExternalPrompt: boolean
  savesClassDigest: boolean
  behavior: SessionBehavior
}

export interface SessionBehavior {
  agentRole: string
  primaryInput: string
  responseShape: string
  autoTriggerStrategy: string
  detailWindowPolicy: string
  detailCapabilities: DetailCapability[]
  screenCodePolicy: string
  artifactPolicy: string
  brainPolicy: string
}

export type DetailCapability =
  | 'detail'
  | 'queue'
  | 'notes'
  | 'teleprompter'
  | 'read-aloud'
  | 'copy-code'
  | 'sources'
  | 'download-images'
  | 'save-memory'

export const SESSION_INTENT_SPECS = {
  interview: {
    intent: 'interview',
    label: 'Interview',
    setupDescription: 'Structured interview coaching with ready-to-say answers.',
    externalTranscriptLabel: 'Interviewer',
    subjectLabel: 'Subject',
    organizationLabel: 'Company',
    roleLabel: 'Role',
    notesLabel: 'Session Notes',
    answerStyleLabel: 'Ready-to-say interview coaching',
    usesInterviewType: true,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-or-request',
    autoOpenAnswerWindowForExternalPrompt: false,
    savesClassDigest: false,
    behavior: {
      agentRole: 'live interview coach',
      primaryInput: 'system audio questions from the interviewer',
      responseShape: 'first-person teleprompter or structured technical answer',
      autoTriggerStrategy: 'answer likely interviewer prompts; ignore filler and candidate mic context',
      detailWindowPolicy: 'use detail window for code, diagrams, long technical breakdowns, or sourced research',
      detailCapabilities: ['detail', 'queue', 'teleprompter', 'read-aloud', 'copy-code', 'sources'],
      screenCodePolicy: 'if the screenshot shows a coding test or exercise, provide the solution code snippet first, then concise explanation and complexity',
      artifactPolicy: 'save transcript and answers; do not create a class digest',
      brainPolicy: 'remember role/company, asked questions, candidate stories, weak areas, coding prompts, and answer outcomes',
    },
  },
  meeting: {
    intent: 'meeting',
    label: 'Meeting',
    setupDescription: 'Live support for meetings, reviews, and stakeholder calls.',
    externalTranscriptLabel: 'Speaker',
    subjectLabel: 'Subject',
    organizationLabel: 'Organization',
    roleLabel: 'Your Role',
    notesLabel: 'Guidance Notes',
    answerStyleLabel: 'Meeting-safe live response support',
    usesInterviewType: false,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-or-request',
    autoOpenAnswerWindowForExternalPrompt: true,
    savesClassDigest: false,
    behavior: {
      agentRole: 'live meeting copilot',
      primaryInput: 'system audio prompts plus explicit user chat or microphone requests',
      responseShape: 'short diplomatic talk track, decision framing, or action wording',
      autoTriggerStrategy: 'answer likely external requests and questions',
      detailWindowPolicy: 'use detail window for structured summaries, action plans, and multi-step responses',
      detailCapabilities: ['detail', 'queue', 'notes', 'read-aloud', 'sources', 'save-memory'],
      screenCodePolicy: 'if code is visible, summarize the blocker or risk unless the user explicitly asks for implementation',
      artifactPolicy: 'save transcript, notes, and answers',
      brainPolicy: 'remember decisions, action items, stakeholders, risks, deadlines, and open questions',
    },
  },
  presentation: {
    intent: 'presentation',
    label: 'Presentation',
    setupDescription: 'Delivery help for demos, talks, walkthroughs, and Q&A.',
    externalTranscriptLabel: 'Presenter',
    subjectLabel: 'Topic',
    organizationLabel: 'Audience / Company',
    roleLabel: 'Presentation Role',
    notesLabel: 'Guidance Notes',
    answerStyleLabel: 'Concise delivery and Q&A support',
    usesInterviewType: false,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-or-request',
    autoOpenAnswerWindowForExternalPrompt: true,
    savesClassDigest: false,
    behavior: {
      agentRole: 'presentation delivery coach',
      primaryInput: 'audience or presenter system audio plus explicit user chat or microphone requests',
      responseShape: 'speaker notes, transitions, and concise Q&A responses',
      autoTriggerStrategy: 'answer likely Q&A prompts or delivery blockers',
      detailWindowPolicy: 'use detail window for slide-by-slide notes or longer narration',
      detailCapabilities: ['detail', 'queue', 'teleprompter', 'read-aloud', 'sources', 'download-images'],
      screenCodePolicy: 'if code or a demo is visible, explain it as presenter narration rather than an interview solution',
      artifactPolicy: 'save transcript, notes, and answers',
      brainPolicy: 'remember deck/topic, audience objections, Q&A, demo issues, and follow-up commitments',
    },
  },
  class: {
    intent: 'class',
    label: 'Class',
    setupDescription: 'Capture lectures, lessons, courses, and workshops with study-oriented help.',
    externalTranscriptLabel: 'Instructor',
    subjectLabel: 'Course / Topic',
    organizationLabel: 'School / Provider',
    roleLabel: 'Student Role',
    notesLabel: 'Learning Notes',
    answerStyleLabel: 'Study notes, explanations, and follow-up questions',
    usesInterviewType: false,
    usesExternalAudioPrompts: true,
    externalPromptMode: 'question-only',
    autoOpenAnswerWindowForExternalPrompt: false,
    savesClassDigest: true,
    behavior: {
      agentRole: 'learning assistant',
      primaryInput: 'instructor/system audio as context plus explicit user questions',
      responseShape: 'clear explanation, study notes, examples, and follow-up questions',
      autoTriggerStrategy: 'passive lecture context unless a clear question or user request appears',
      detailWindowPolicy: 'use detail window for lecture summaries, study notes, code walkthroughs, and digests',
      detailCapabilities: ['detail', 'notes', 'read-aloud', 'copy-code', 'sources', 'save-memory'],
      screenCodePolicy: 'if the screenshot shows an exercise, failing test, or code task, provide a runnable answer/code snippet in detail, then explain the concept',
      artifactPolicy: 'save transcript, notes, answers, and class digest',
      brainPolicy: 'remember topics, definitions, examples, exercises, mistakes, follow-up questions, and study tasks',
    },
  },
  'quick-help': {
    intent: 'quick-help',
    label: 'Quick Help',
    setupDescription: 'Direct local companion help from chat or microphone input.',
    externalTranscriptLabel: 'System audio',
    subjectLabel: 'Subject',
    organizationLabel: 'Context',
    roleLabel: 'Role',
    notesLabel: 'Notes',
    answerStyleLabel: 'Direct practical help',
    usesInterviewType: false,
    usesExternalAudioPrompts: false,
    externalPromptMode: 'none',
    autoOpenAnswerWindowForExternalPrompt: false,
    savesClassDigest: false,
    behavior: {
      agentRole: 'direct local copilot',
      primaryInput: 'user-authored chat or microphone request',
      responseShape: 'direct concise answer or tool action',
      autoTriggerStrategy: 'respond only to user-authored prompts',
      detailWindowPolicy: 'bubble first; use detail window for long or tool-heavy results',
      detailCapabilities: ['detail', 'read-aloud', 'copy-code', 'sources', 'download-images', 'save-memory'],
      screenCodePolicy: 'if the user asks about visible code, provide the concrete edit or answer before explanation',
      artifactPolicy: 'save transcript and answers only when a session is active',
      brainPolicy: 'remember durable user preferences, project facts, and completed tasks; ignore throwaway chatter',
    },
  },
} as const satisfies Record<SessionIntent, SessionIntentSpec>

export function normalizeSessionIntent(value: unknown): SessionIntent {
  if (value === 'lecture' || value === 'course' || value === 'lesson') return 'class'
  if (
    value === 'interview' ||
    value === 'meeting' ||
    value === 'presentation' ||
    value === 'class' ||
    value === 'quick-help'
  ) {
    return value
  }
  return 'interview'
}

export function getSessionIntentSpec(intent: unknown): SessionIntentSpec {
  return SESSION_INTENT_SPECS[normalizeSessionIntent(intent)]
}

export function getSessionBehavior(intent: unknown): SessionBehavior {
  return getSessionIntentSpec(intent).behavior
}

export function getTranscriptSpeakerLabel(entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>, intent: unknown): string {
  if (entry.source === 'chat' || entry.audioSource === 'chat') return 'Chat'
  if (entry.speaker === 'user' || entry.audioSource === 'microphone') return 'You'
  if (entry.speaker === 'unknown') return 'Unknown'
  return getSessionIntentSpec(intent).externalTranscriptLabel
}

export function isExternalAudioEntry(entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>): boolean {
  if (entry.source === 'chat' || entry.audioSource === 'chat') return false
  if (entry.speaker === 'user' || entry.audioSource === 'microphone') return false
  return true
}

export function isSelfAuthoredEntry(entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>): boolean {
  return entry.source === 'chat' || entry.audioSource === 'chat' || entry.speaker === 'user' || entry.audioSource === 'microphone'
}

export function shouldUseExternalAudioPrompts(intent: unknown): boolean {
  return getSessionIntentSpec(intent).usesExternalAudioPrompts
}

export function shouldAutoOpenAnswerWindowForExternalPrompt(intent: unknown): boolean {
  return getSessionIntentSpec(intent).autoOpenAnswerWindowForExternalPrompt
}

export function shouldTreatExternalTranscriptAsPrompt(intent: unknown, text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  const spec = getSessionIntentSpec(intent)
  if (spec.externalPromptMode === 'none' || spec.externalPromptMode === 'passive') return false
  const words = normalized.split(/\s+/).filter(Boolean)
  const looksQuestionLike =
    normalized.endsWith('?') ||
    /^(what|why|how|when|where|which|can you|could you|would you|do you|does|did|is|are|explain|describe|tell me|walk me)\b/.test(normalized)
  if (spec.externalPromptMode === 'question-only') {
    return looksQuestionLike && words.length >= 4
  }
  const looksRequestLike =
    looksQuestionLike ||
    /^(please|let's|lets|can someone|could someone|we need to|i need you to|summarize|compare|decide|recommend|help me)\b/.test(normalized)
  return looksRequestLike && words.length >= 4
}

export function shouldSaveClassDigest(intent: unknown): boolean {
  return getSessionIntentSpec(intent).savesClassDigest
}
```

- [ ] **Step 5: Add the npm guard**

Modify `package.json`:

```json
"check:session-intents": "node scripts/check-session-intent-policy.mjs"
```

- [ ] **Step 6: Run the check**

Run:

```bash
npm run check:session-intents
```

Expected: PASS with `check-session-intent-policy: taxonomy and transcript labels OK`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/session-intent-policy.ts scripts/check-session-intent-policy.mjs package.json
git commit -m "feat(session): add intent taxonomy policy"
```

---

### Task 2: Transcript Labels Stop Saying Interviewer Everywhere

**Files:**
- Modify: `src/renderer/overlay/components/Transcript.tsx`
- Modify: `src/renderer/overlay/App.tsx`
- Modify: `src/renderer/canvas/components/ControlBar.tsx` if it renders transcript speaker text
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Extend the failing check for hardcoded labels**

Add this to `scripts/check-session-intent-policy.mjs`:

```js
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
```

- [ ] **Step 2: Run the failing check**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL because `Transcript.tsx` still hardcodes `Interviewer`.

- [ ] **Step 3: Update Transcript props and label helper**

Modify `src/renderer/overlay/components/Transcript.tsx`:

```ts
import type { SessionIntent } from '@shared/types'
import { getTranscriptSpeakerLabel } from '@shared/session-intent-policy'
```

Update local `TranscriptEntry`:

```ts
interface TranscriptEntry {
  id: string
  text: string
  speaker: 'interviewer' | 'user' | 'unknown'
  timestamp: number
  isFinal: boolean
  source?: 'stt' | 'chat'
  audioSource?: 'system' | 'microphone' | 'chat'
}
```

Update props:

```ts
interface TranscriptProps {
  entries: TranscriptEntry[]
  detectedQuestion?: string
  sessionIntent: SessionIntent
  interviewerInterimText: string
  userInterimText: string
  onAnswerThis: () => void
  onClear: () => void
  onHide: () => void
}
```

Update interim system-audio row:

```ts
audioSource: 'system' as const,
```

Update interim user row:

```ts
audioSource: 'microphone' as const,
```

Replace `SpeakerTag` with:

```tsx
function SpeakerTag({
  entry,
  sessionIntent,
  isQuestion,
}: {
  entry: Pick<TranscriptEntry, 'speaker' | 'source' | 'audioSource'>
  sessionIntent: SessionIntent
  isQuestion: boolean
}) {
  if (isQuestion) {
    return <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">Question</span>
  }
  const label = getTranscriptSpeakerLabel(entry, sessionIntent)
  const color = label === 'You'
    ? 'text-cyan-400/70'
    : label === 'Chat'
      ? 'text-cyan-300/80'
      : 'text-white/40'
  return <span className={`text-[10px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
}
```

Update each call site from:

```tsx
<SpeakerTag speaker={latestText.speaker} isQuestion={latestText.isQuestion} />
```

to:

```tsx
<SpeakerTag entry={latestText} sessionIntent={sessionIntent} isQuestion={latestText.isQuestion} />
```

- [ ] **Step 4: Pass session intent from overlay**

Modify `src/renderer/overlay/App.tsx` where `Transcript` is rendered:

```tsx
<Transcript
  entries={transcript}
  detectedQuestion={detectedQuestion}
  sessionIntent={currentSessionIntent || 'interview'}
  interviewerInterimText={interimTranscript.interviewer}
  userInterimText={interimTranscript.user}
  onAnswerThis={handleAnswerThis}
  onClear={handleClearTranscript}
  onHide={() => setShowTranscript(false)}
/>
```

- [ ] **Step 5: Replace local fallback speaker labels in overlay helpers**

In `src/renderer/overlay/App.tsx`, replace helper code that assumes every non-user row is `interviewer` for display. The helper around the current `speaker === 'unknown' ? 'unknown' : 'interviewer'` should call `getTranscriptSpeakerLabel(entry, currentSessionIntent || 'interview')` or return a semantic label object from the policy module.

Use this shape:

```ts
const label = getTranscriptSpeakerLabel(entry, currentSessionIntent || 'interview')
```

- [ ] **Step 6: Run checks**

Run:

```bash
npm run check:session-intents
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/overlay/components/Transcript.tsx src/renderer/overlay/App.tsx src/renderer/canvas/components/ControlBar.tsx scripts/check-session-intent-policy.mjs
git commit -m "fix(transcript): use intent-aware speaker labels"
```

---

### Task 3: Add Dedicated Class Session Type in Setup UI

**Files:**
- Modify: `src/renderer/overlay/components/setup/InterviewSetup.tsx`
- Modify: `src/renderer/overlay/components/setup/SessionSetup.tsx`
- Modify: `src/renderer/overlay/components/setup\SessionPresetBar.tsx` only if it filters intents
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add failing setup guards**

Add this to `scripts/check-session-intent-policy.mjs`:

```js
const setupSource = readFileSync('src/renderer/overlay/components/setup/InterviewSetup.tsx', 'utf8')
const setupShellSource = readFileSync('src/renderer/overlay/components/setup/SessionSetup.tsx', 'utf8')

assert.match(setupSource, /value: 'class'/, 'Live setup must expose a dedicated class intent')
assert.match(setupSource, /getSessionIntentSpec/, 'Live setup must read labels from session intent policy')
assert.doesNotMatch(setupShellSource, /Speech-led answers for interviews, meetings, presentations\./)
assert.match(setupShellSource, /Live Session/)
```

- [ ] **Step 2: Run the failing check**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL because setup does not expose `class` yet and tab copy still says Interview.

- [ ] **Step 3: Update live intent list**

In `src/renderer/overlay/components/setup/InterviewSetup.tsx`, import:

```ts
import { getSessionIntentSpec, SESSION_INTENT_SPECS } from '@shared/session-intent-policy'
```

Change intent type:

```ts
type LiveSetupIntent = Extract<SessionIntent, 'interview' | 'meeting' | 'presentation' | 'class'>
```

Change `INTERVIEW_INTENTS` to:

```ts
const LIVE_SESSION_INTENTS: Array<{
  value: LiveSetupIntent
  icon: typeof MessageSquareMore
}> = [
  { value: 'interview', icon: MessageSquareMore },
  { value: 'meeting', icon: Layers3 },
  { value: 'presentation', icon: Presentation },
  { value: 'class', icon: BookOpen },
]
```

Change state:

```ts
const [sessionIntent, setSessionIntent] = useState<LiveSetupIntent>('interview')
```

Update seed logic:

```ts
if (intent === 'interview' || intent === 'meeting' || intent === 'presentation' || intent === 'class') {
  setSessionIntent(intent)
}
```

Replace per-intent label branches with:

```ts
const selectedIntent = getSessionIntentSpec(sessionIntent)
const isInterview = selectedIntent.usesInterviewType
const companyLabel = selectedIntent.organizationLabel
const roleLabel = selectedIntent.roleLabel
const subjectLabel = selectedIntent.subjectLabel
const notesLabel = selectedIntent.notesLabel
const notesPlaceholder = isInterview
  ? 'Anything specific to this interview...'
  : sessionIntent === 'class'
    ? 'Course goals, current topic, or what you want explained...'
    : 'Anything important about this session...'
```

Render cards from `LIVE_SESSION_INTENTS`:

```tsx
{LIVE_SESSION_INTENTS.map((intentOption) => {
  const Icon = intentOption.icon
  const spec = getSessionIntentSpec(intentOption.value)
  const selected = intentOption.value === sessionIntent
  return (
    <button key={intentOption.value} type="button" onClick={() => setSessionIntent(intentOption.value)} className={...}>
      <div className="flex items-start gap-3">
        <div className={...}>
          <Icon size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-white/82">{spec.label}</div>
          <div className="mt-1 text-[10.5px] leading-relaxed text-white/32">{spec.setupDescription}</div>
        </div>
      </div>
    </button>
  )
})}
```

Update summary answer style:

```tsx
<p className="text-[10.5px] text-white/28">Answer style: {selectedIntent.answerStyleLabel}</p>
```

- [ ] **Step 4: Rename the setup shell copy**

Modify `src/renderer/overlay/components/setup/SessionSetup.tsx`:

```ts
const SETUP_MODES = [
  { value: 'interview', label: 'Live Session', description: 'Speech-led support for interviews, meetings, presentations, and classes.', icon: MessageSquareMore },
  { value: 'companion', label: 'Companion', description: 'Quick chat overlay with bubble replies.', icon: Sparkles },
] satisfies Array<{
  value: SetupMode
  label: string
  description: string
  icon: typeof MessageSquareMore
}>
```

Keep `setupModeToAgentMode()` returning `'interview'` for the live session tab.

- [ ] **Step 5: Run checks**

Run:

```bash
npm run check:session-intents
npm run build
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/overlay/components/setup/InterviewSetup.tsx src/renderer/overlay/components/setup/SessionSetup.tsx scripts/check-session-intent-policy.mjs
git commit -m "feat(session): add class live session setup"
```

---

### Task 4: Tag STT Entries With Audio Source

**Files:**
- Modify: `src/main/services/stt-service.ts`
- Modify: `src/main/services/local-ai/providers/whisper-cpp-stt-service.ts`
- Modify: `src/main/services/local-ai/local-ai-manager.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/pipelines/interview-pipeline.ts`
- Modify: `src/main/pipelines/companion-pipeline.ts`
- Modify: `scripts/check-whisper-runtime.mjs`
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add failing runtime/source assertions**

In `scripts/check-session-intent-policy.mjs`, add:

```js
const sttSource = readFileSync('src/main/services/stt-service.ts', 'utf8')
const whisperSource = readFileSync('src/main/services/local-ai/providers/whisper-cpp-stt-service.ts', 'utf8')
assert.match(sttSource, /audioSource/, 'Deepgram STT entries must include audioSource')
assert.match(whisperSource, /audioSource/, 'Whisper STT entries must include audioSource')
```

In `scripts/check-whisper-runtime.mjs`, add after the current speaker assertion:

```js
assert.equal(entry.audioSource, 'microphone')
```

- [ ] **Step 2: Run failing checks**

Run:

```bash
npm run check:session-intents
npm run check:local-ai
```

Expected: session-intent check FAILS until `audioSource` is added; local-ai may fail after adding the assertion until Whisper is updated.

- [ ] **Step 3: Add input source mapping**

In `src/shared/types.ts`, use the `TranscriptAudioSource` type from Task 1.

In `src/main/services/stt-service.ts`, add:

```ts
import { TranscriptAudioSource, TranscriptEntry } from '@shared/types'
```

Change fields:

```ts
private speaker: 'interviewer' | 'user'
private audioSource: TranscriptAudioSource
```

Change constructor:

```ts
constructor(apiKey: string, speaker: 'interviewer' | 'user', language: string = 'en', keyterms: string[] = []) {
  super()
  this.apiKey = apiKey
  this.speaker = speaker
  this.audioSource = speaker === 'user' ? 'microphone' : 'system'
  this.language = language
  this.keyterms = keyterms
}
```

Add to emitted entry:

```ts
audioSource: this.audioSource,
```

- [ ] **Step 4: Update Whisper STT**

In `src/main/services/local-ai/providers/whisper-cpp-stt-service.ts`, add the same mapping:

```ts
private readonly audioSource: TranscriptAudioSource
```

Set it in the constructor:

```ts
this.audioSource = speaker === 'user' ? 'microphone' : 'system'
```

Add to emitted entries:

```ts
audioSource: this.audioSource,
```

- [ ] **Step 5: Run checks**

Run:

```bash
npm run check:session-intents
npm run check:local-ai
npm run build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/stt-service.ts src/main/services/local-ai/providers/whisper-cpp-stt-service.ts scripts/check-whisper-runtime.mjs scripts/check-session-intent-policy.mjs
git commit -m "feat(transcript): tag stt entries with audio source"
```

---

### Task 5: Harden Answer Routing by Intent

**Files:**
- Modify: `src/main/services/answer-prep-service.ts`
- Modify: `src/main/services/answer-request-service.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/services/llm-service.ts`
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add policy regression checks**

Add to `scripts/check-session-intent-policy.mjs`:

```js
const answerPrepSource = readFileSync('src/main/services/answer-prep-service.ts', 'utf8')
const answerRequestSource = readFileSync('src/main/services/answer-request-service.ts', 'utf8')
const ipcSource = readFileSync('src/main/ipc-handlers.ts', 'utf8')

assert.match(answerPrepSource, /isExternalAudioEntry/, 'answer-prep must use shared external audio predicate')
assert.match(answerPrepSource, /shouldUseExternalAudioPrompts/, 'answer-prep must route prompts by session intent policy')
assert.match(answerPrepSource, /shouldTreatExternalTranscriptAsPrompt/, 'answer-prep must use intent-specific prompt trigger policy')
assert.match(answerRequestSource, /shouldGenerateForAutoPrompt/, 'auto-answer requests must use intent-specific trigger policy')
assert.doesNotMatch(answerPrepSource, /entry\.speaker === 'interviewer'/, 'answer-prep must not hardcode interviewer as semantic external speaker')
assert.match(ipcSource, /shouldAutoOpenAnswerWindowForExternalPrompt/, 'answer window routing must use session intent policy')
assert.doesNotMatch(ipcSource, /intent !== 'meeting' && intent !== 'presentation'/, 'answer window routing must not special-case only meeting and presentation')
```

- [ ] **Step 2: Run failing check**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL because answer prep and IPC still hardcode interviewer/meeting/presentation behavior.

- [ ] **Step 3: Update answer-prep filters**

In `src/main/services/answer-prep-service.ts`, import:

```ts
import {
  isExternalAudioEntry,
  isSelfAuthoredEntry,
  shouldTreatExternalTranscriptAsPrompt,
  shouldUseExternalAudioPrompts,
} from '@shared/session-intent-policy'
```

Replace the bottom helpers with:

```ts
function getRelevantPromptEntries(
  sessionTranscript: TranscriptEntry[],
  sessionIntent: SessionIntent
): TranscriptEntry[] {
  return sessionTranscript.filter((entry) => {
    if (!entry.isFinal) return false
    if (shouldUseExternalAudioPrompts(sessionIntent)) {
      return isExternalAudioEntry(entry)
    }
    return isSelfAuthoredEntry(entry)
  })
}
```

Remove local `usesSelfAuthoredPrompts`, `isSelfAuthoredEntry`, and `isExternalEntry`.

- [ ] **Step 4: Make auto-answer generation intent-aware**

In `src/main/services/answer-prep-service.ts`, keep `shouldGenerateForQuestion(question)` as the generic lexical guard for manual requests. Add a separate auto-trigger helper:

```ts
export function shouldGenerateForAutoPrompt(
  question: string,
  sessionIntent: SessionIntent = 'interview'
): boolean {
  if (!shouldTreatExternalTranscriptAsPrompt(sessionIntent, question)) {
    return false
  }
  return shouldGenerateForQuestion(question)
}
```

In `src/main/services/answer-request-service.ts`, import the new helper:

```ts
shouldGenerateForAutoPrompt,
```

Change only `buildAutoAnswerRequest()` checks from:

```ts
shouldGenerateForQuestion(preparedQuestion)
```

to:

```ts
shouldGenerateForAutoPrompt(preparedQuestion, options.sessionContext?.sessionIntent || 'interview')
```

Do the same for `rawQuestion`. Leave `buildManualAnswerRequest()` alone so user-clicked or typed requests still work in every mode.

This is the core behavior hardening: class lecture segments become context unless they look like a real question, while meetings and presentations still respond to clear requests.

- [ ] **Step 5: Update answer window open policy**

In `src/main/ipc-handlers.ts`, import:

```ts
import {
  isExternalAudioEntry,
  shouldAutoOpenAnswerWindowForExternalPrompt,
  shouldTreatExternalTranscriptAsPrompt,
  shouldSaveClassDigest,
} from '@shared/session-intent-policy'
```

Replace `shouldOpenAnswerQueueForEntry()` with:

```ts
function shouldOpenAnswerQueueForEntry(entry: TranscriptEntry): boolean {
  if (currentAgentMode() !== 'interview') return false
  if (!isExternalAudioEntry(entry)) return false
  const intent = contextManager.getSessionContext().sessionIntent || 'interview'
  if (!shouldAutoOpenAnswerWindowForExternalPrompt(intent)) return false
  return isAnswerCandidateText(entry.text) && shouldTreatExternalTranscriptAsPrompt(intent, entry.text)
}
```

- [ ] **Step 6: Update any LLM transcript filters**

In `src/main/services/llm-service.ts`, replace helper logic equivalent to:

```ts
return entry.source !== 'chat' && (entry.speaker === 'interviewer' || entry.speaker === 'unknown')
```

with:

```ts
return isExternalAudioEntry(entry)
```

For quick-help/user-authored flows, use:

```ts
return isSelfAuthoredEntry(entry)
```

- [ ] **Step 7: Run checks**

Run:

```bash
npm run check:session-intents
npm run check:mode-isolation
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/answer-prep-service.ts src/main/services/answer-request-service.ts src/main/services/llm-service.ts src/main/ipc-handlers.ts scripts/check-session-intent-policy.mjs
git commit -m "fix(session): route prompts by session intent"
```

---

### Task 6: Prompt, Title, and Artifact Behavior by Intent

**Files:**
- Modify: `src/shared/prompts.ts`
- Modify: `src/main/services/session-persistence-service.ts`
- Modify: `src/main/services/context-manager.ts`
- Modify: `src/main/services/class-digest-service.ts`
- Modify: `src/main/services/memory/entity-extraction-service.ts`
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add failing class behavior guards**

Add to `scripts/check-session-intent-policy.mjs`:

```js
const promptsSource = readFileSync('src/shared/prompts.ts', 'utf8')
const persistenceSource = readFileSync('src/main/services/session-persistence-service.ts', 'utf8')
const contextManagerSource = readFileSync('src/main/services/context-manager.ts', 'utf8')

assert.match(promptsSource, /getSessionBehavior/, 'prompts must read the shared behavior contract')
assert.match(promptsSource, /case 'class':/, 'prompts must define class-specific guidance')
assert.match(promptsSource, /Class Guidance/, 'class prompt must be study-oriented')
assert.match(persistenceSource, /case 'class':/, 'session titles must handle class sessions')
assert.match(contextManagerSource, /case 'class':/, 'context formatting must handle class sessions')
```

- [ ] **Step 2: Run failing check**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL until prompts read the behavior contract and class prompt/title formatting exists.

- [ ] **Step 3: Import and apply the behavior contract**

In `src/shared/prompts.ts`, update `describeSessionIntent()`:

```ts
import { getSessionBehavior } from './session-intent-policy'
```

Inside `buildSystemPrompt()`, after `sessionIntent` is known, add:

```ts
const behavior = getSessionBehavior(sessionIntent)
```

In the interview branch, add the same behavior contract after the opening job sentence and before `# How to Write Answers`:

```ts
# Session Behavior Contract

- Role: ${behavior.agentRole}
- Primary input: ${behavior.primaryInput}
- Default response shape: ${behavior.responseShape}
- Trigger posture: ${behavior.autoTriggerStrategy}
- Detail window policy: ${behavior.detailWindowPolicy}
- Artifact policy: ${behavior.artifactPolicy}
```

For the non-interview branch, replace the generic identity line:

```ts
return `You are Whisphry, a local memory-native desktop companion helping ${candidateName} during a live ${scenario}.
```

with:

```ts
return `You are Whisphry acting as a ${behavior.agentRole} for ${candidateName} during a live ${scenario}.
```

Add this section before `# How to Write Answers`:

```ts
# Session Behavior Contract

- Primary input: ${behavior.primaryInput}
- Default response shape: ${behavior.responseShape}
- Trigger posture: ${behavior.autoTriggerStrategy}
- Detail window policy: ${behavior.detailWindowPolicy}
- Artifact policy: ${behavior.artifactPolicy}
```

- [ ] **Step 4: Add class-specific prompt behavior**

```ts
case 'class':
  return 'class or learning session'
```

Update `getSessionIntentGuidance()`:

```ts
case 'class':
  return `# Class Guidance

- Treat system audio as the instructor or lesson source, not an interviewer
- Optimize for understanding, concise notes, definitions, and follow-up questions
- If the transcript is a lecture segment, summarize the key concept before suggesting what to ask or review
- If the user asks for help, explain step by step and connect it to the course/topic context`
```

Update the ready-to-say branch:

```ts
const outputMode = sessionIntent === 'meeting' || sessionIntent === 'presentation'
  ? `Your single job: write exactly what ${candidateName} should say out loud, right now, in first person.`
  : sessionIntent === 'class'
    ? `Your single job: help ${candidateName} understand, summarize, or respond during the class without pretending this is an interview.`
    : `Your single job: produce the most directly useful response for the user's current request. Write like a sharp local copilot, not an essay.`
```

Update `buildQuestionPrompt()`:

```ts
const intro = sessionIntent === 'interview'
  ? 'The interviewer just asked:'
  : sessionIntent === 'meeting'
    ? 'The user needs a ready-to-say response to this live meeting prompt:'
    : sessionIntent === 'presentation'
      ? 'The user needs help responding during this presentation or Q&A prompt:'
      : sessionIntent === 'class'
        ? 'The class or instructor transcript says:'
        : 'Help with this request:'
```

```ts
const outro = sessionIntent === 'interview'
  ? 'Write what the candidate should say in response. First person, natural, ready to speak out loud. If this is a spoken interview answer, use the teleprompter format: anchor words, short lines, pause markers, and useful demo cues.'
  : sessionIntent === 'meeting'
    ? 'Write exactly what the user should say out loud. Keep it natural, direct, and meeting-safe.'
    : sessionIntent === 'presentation'
      ? 'Write a concise presentation-safe response or transition the user can deliver.'
      : sessionIntent === 'class'
        ? 'Explain the concept clearly, extract the useful notes, and suggest a concise follow-up question if one would help.'
        : 'Write the most useful response for the user right now. Be direct, concrete, and practical.'
```

Update `buildScreenCapturePrompt()` non-interview branch with a class-specific branch before the generic branch:

```ts
if (sessionIntent === 'class') {
  return `Analyze this screenshot from a class or learning session.

Look at what is actually visible and respond appropriately:

If it's lecture material, slides, code, or notes:
1. Identify the topic shown
2. Explain the key concept in plain language
3. Pull out study notes or likely exam/action points

If it's an exercise or error:
1. Identify the task or blocker
2. Explain the next step
3. Keep the answer grounded in visible evidence

Only describe what is actually visible. Do not invent hidden tabs, files, or text.`
}
```

- [ ] **Step 5: Update meeting and presentation prompt wording**

Keep meeting and presentation separate instead of sharing one generic "ready-to-say" branch. In `buildSystemPrompt()`, replace the existing `sessionIntent === 'meeting' || sessionIntent === 'presentation'` ternaries with:

```ts
const outputMode = sessionIntent === 'meeting'
  ? `Your single job: help ${candidateName} respond clearly in this meeting, with wording they can say out loud when needed.`
  : sessionIntent === 'presentation'
    ? `Your single job: help ${candidateName} deliver, transition, or answer Q&A during this presentation.`
    : sessionIntent === 'class'
      ? `Your single job: help ${candidateName} understand, summarize, or respond during the class without pretending this is an interview.`
      : `Your single job: produce the most directly useful response for the user's current request. Write like a sharp local copilot, not an essay.`
```

Replace `communicationRules` with:

```ts
const communicationRules = sessionIntent === 'meeting'
  ? [
      '- Use meeting-safe wording: clear, diplomatic, and concise',
      '- Prefer a short opener, main point, and closing/action line',
      '- Do not sound like an interview coach or a classroom tutor',
      '- If the answer is for the user to say aloud, write in first person',
    ]
  : sessionIntent === 'presentation'
    ? [
        '- Optimize for spoken delivery, transitions, and audience clarity',
        '- Keep Q&A responses concise and confident',
        '- Use speaker-note phrasing when the user needs to present',
        '- Do not turn the response into meeting minutes or interview coaching',
      ]
    : sessionIntent === 'class'
      ? [
          '- Treat system audio as instructor or lesson context',
          '- Explain concepts plainly before giving next steps',
          '- Prefer notes, examples, definitions, and follow-up questions',
          '- Do not write candidate/interview wording unless the user explicitly asks for a script',
        ]
      : [
          '- Answer directly instead of narrating your process',
          '- Use concise structure only when it genuinely helps',
          '- Prefer concrete next steps, examples, or decisions over generic advice',
          '- If the workspace or notes contain specifics, use them explicitly',
          '- Do not frame the answer as interview coaching',
        ]
```

- [ ] **Step 6: Update session titles**

In `src/main/services/session-persistence-service.ts`, add:

```ts
case 'class':
  if (subject && company) return `${subject} - ${company}`
  if (subject) return subject
  if (company) return `Class - ${company}`
  return `Class ${new Date(startedAt).toLocaleString()}`
```

- [ ] **Step 7: Update context formatting**

In `src/main/services/context-manager.ts`, update `formatSessionIntent()` with:

```ts
case 'class':
  return 'Class'
```

Where session markdown currently prints interview type, keep it conditional:

```ts
record.sessionIntent === 'interview'
  ? `**Type:** ${record.interviewType || 'general'}`
  : ''
```

- [ ] **Step 8: Make class digest explicit**

In `src/main/ipc-handlers.ts`, where the app builds `classDigest` on stop, use:

```ts
const shouldBuildDigest = shouldSaveClassDigest(contextManager.getSessionContext().sessionIntent)
const classDigest = shouldBuildDigest
  ? classDigestService.buildDigest({
      transcript: sessionRuntimeStore.sessionTranscript,
      answers: sessionRuntimeStore.currentAnswers,
      meetingNotes: sessionRuntimeStore.currentSessionNotes,
      screenshots: sessionRuntimeStore.currentScreenshots,
      sessionContext: contextManager.getSessionContext(),
    })
  : undefined
```

Do not build a class digest for ordinary meetings unless a later product decision adds a separate meeting-summary artifact.

- [ ] **Step 9: Run checks**

Run:

```bash
npm run check:session-intents
npm run build
```

Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared/prompts.ts src/main/services/session-persistence-service.ts src/main/services/context-manager.ts src/main/services/class-digest-service.ts src/main/services/memory/entity-extraction-service.ts src/main/ipc-handlers.ts scripts/check-session-intent-policy.mjs
git commit -m "feat(session): add class prompt and artifact behavior"
```

---

### Task 7: Remove New Semantic Uses of `interviewer`

**Files:**
- Modify: `src/main/services/answer-prep-service.ts`
- Modify: `src/main/services/llm-service.ts`
- Modify: `src/renderer/overlay/App.tsx`
- Modify: `src/renderer/overlay/components/Transcript.tsx`
- Modify: `src/renderer/canvas/components/ControlBar.tsx`
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add a source guard**

Add to `scripts/check-session-intent-policy.mjs`:

```js
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
```

- [ ] **Step 2: Run failing guard**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL until remaining semantic uses are migrated.

- [ ] **Step 3: Replace remaining display/routing checks**

Use these replacements:

```ts
isExternalAudioEntry(entry)
```

for any external/system audio predicate, and:

```ts
getTranscriptSpeakerLabel(entry, currentSessionIntent || 'interview')
```

for any visible label.

Keep allowed legacy uses only in low-level audio source plumbing where the capture service still emits `'interviewer' | 'user'`.

- [ ] **Step 4: Run checks**

Run:

```bash
npm run check:session-intents
npm run check:mode-isolation
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/answer-prep-service.ts src/main/services/llm-service.ts src/renderer/overlay/App.tsx src/renderer/overlay/components/Transcript.tsx src/renderer/canvas/components/ControlBar.tsx scripts/check-session-intent-policy.mjs
git commit -m "refactor(transcript): remove semantic interviewer checks"
```

---

### Task 8: Intent-Aware Session Brain and Memory

**Files:**
- Modify: `src/shared/session-brain-types.ts`
- Modify: `src/main/services/memory/recall-context.ts`
- Modify: `src/main/services/memory/extraction-service.ts`
- Modify: `src/main/services/agent/heartbeat-service.ts`
- Modify: `src/main/services/agent/profile-update-service.ts`
- Modify: `src/main/services/agent/voice-update-service.ts`
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add brain policy guards**

Add to `scripts/check-session-intent-policy.mjs`:

```js
const recallContextSource = readFileSync('src/main/services/memory/recall-context.ts', 'utf8')
const extractionSource = readFileSync('src/main/services/memory/extraction-service.ts', 'utf8')
const heartbeatSource = readFileSync('src/main/services/agent/heartbeat-service.ts', 'utf8')

assert.match(recallContextSource, /getSessionBehavior/, 'recall context must include the session behavior contract')
assert.match(recallContextSource, /brainPolicy/, 'recall context must expose intent-aware brain policy')
assert.match(extractionSource, /brainPolicy|SESSION_INTENT_SPECS|getSessionBehavior/, 'memory extraction must account for intent-specific remembering')
assert.match(heartbeatSource, /getSessionBehavior/, 'heartbeat must receive behavior policy for proactive reasoning')
```

- [ ] **Step 2: Run the failing check**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL because the brain/recall services do not read the behavior contract yet.

- [ ] **Step 3: Add behavior contract to recall context**

In `src/main/services/memory/recall-context.ts`, import:

```ts
import { getSessionBehavior } from '@shared/session-intent-policy'
```

Where the session context lines are built, add:

```ts
const behavior = getSessionBehavior(sessionCtx.sessionIntent || 'interview')
```

Append:

```ts
`Behavior role: ${behavior.agentRole}`,
`Primary input: ${behavior.primaryInput}`,
`Remembering policy: ${behavior.brainPolicy}`,
```

This makes recalled context and downstream prompts aware that a class should preserve study facts while a meeting should preserve decisions/action items.

- [ ] **Step 4: Add intent-aware extraction hints**

In `src/main/services/memory/extraction-service.ts`, import:

```ts
import { getSessionBehavior } from '@shared/session-intent-policy'
```

Where transcript metadata is built, add:

```ts
const behavior = getSessionBehavior(sessionContext?.sessionIntent || 'interview')
```

Include `brainPolicy` in metadata:

```ts
brainPolicy: behavior.brainPolicy,
```

For draft-memory titles/tags, branch by intent:

```ts
const intent = sessionContext?.sessionIntent || 'interview'
const transcriptTags = intent === 'class'
  ? ['transcript', 'class', 'study-note', 'draft-note']
  : intent === 'meeting'
    ? ['transcript', 'meeting', 'action-context', 'draft-note']
    : intent === 'presentation'
      ? ['transcript', 'presentation', 'q-and-a', 'draft-note']
      : ['transcript', 'user', 'draft-note']
```

Use these tags when creating draft notes from transcript entries so class memories are searchable as study material instead of generic interview transcript.

- [ ] **Step 5: Feed behavior policy to heartbeat reasoning**

In `src/main/services/agent/heartbeat-service.ts`, import:

```ts
import { getSessionBehavior } from '@shared/session-intent-policy'
```

Where heartbeat builds session context lines, add:

```ts
const behavior = getSessionBehavior(sessionContext.sessionIntent || 'interview')
```

Append:

```ts
`Behavior role: ${behavior.agentRole}`,
`Auto-trigger posture: ${behavior.autoTriggerStrategy}`,
`Detail policy: ${behavior.detailWindowPolicy}`,
`Screen/code policy: ${behavior.screenCodePolicy}`,
`Brain policy: ${behavior.brainPolicy}`,
```

This prevents the proactive agent from treating class lecture audio like an interview question and helps it remember the right facts.

- [ ] **Step 6: Update profile/voice update services**

In `src/main/services/agent/profile-update-service.ts` and `src/main/services/agent/voice-update-service.ts`, import `getSessionBehavior()` and add `Brain policy: ...` to their session context blocks. Keep the wording concise:

```ts
const behavior = getSessionBehavior(s.sessionIntent || 'interview')
lines.push(`Brain policy: ${behavior.brainPolicy}`)
```

This steers long-term profile updates toward useful durable facts per mode.

- [ ] **Step 7: Run checks**

Run:

```bash
npm run check:session-intents
npm run build
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/session-brain-types.ts src/main/services/memory/recall-context.ts src/main/services/memory/extraction-service.ts src/main/services/agent/heartbeat-service.ts src/main/services/agent/profile-update-service.ts src/main/services/agent/voice-update-service.ts scripts/check-session-intent-policy.mjs
git commit -m "feat(brain): apply session intent behavior policy"
```

---

### Task 9: Intent-Aware Detail Window Capabilities

**Files:**
- Modify: `src/renderer/overlay/App.tsx`
- Modify: `src/renderer/overlay/components/AISuggestion.tsx`
- Modify: `src/renderer/overlay/components/RichContent.tsx`
- Modify: `src/main/services/agent/heartbeat-service.ts`
- Modify: `src/main/services/agent/tool-definitions.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `scripts/check-session-intent-policy.mjs`

- [ ] **Step 1: Add detail-window capability guards**

Add to `scripts/check-session-intent-policy.mjs`:

```js
const overlaySource = readFileSync('src/renderer/overlay/App.tsx', 'utf8')
const aiSuggestionSource = readFileSync('src/renderer/overlay/components/AISuggestion.tsx', 'utf8')
const richContentSource = readFileSync('src/renderer/overlay/components/RichContent.tsx', 'utf8')
const toolDefinitionsSource = readFileSync('src/main/services/agent/tool-definitions.ts', 'utf8')

assert.match(overlaySource, /detailCapabilities/, 'answer view tabs must be driven by intent detail capabilities')
assert.match(aiSuggestionSource, /detailCapabilities/, 'detail window controls must be driven by intent detail capabilities')
assert.match(richContentSource, /copy-code|download-images|downloadImage/, 'rich content must expose code/image affordances for detail output')
assert.match(toolDefinitionsSource, /detail window.*session intent|session intent.*detail window/i, 'detail tools must describe intent-aware use')
```

- [ ] **Step 2: Run the failing check**

Run:

```bash
npm run check:session-intents
```

Expected: FAIL because the detail window still shows the same tabs/actions for most non-companion modes.

- [ ] **Step 3: Pass intent capabilities into the answer view**

In `src/renderer/overlay/App.tsx`, import:

```ts
import { getSessionBehavior } from '@shared/session-intent-policy'
```

Create:

```ts
const detailCapabilities = getSessionBehavior(currentSessionIntent || 'interview').detailCapabilities
const hasDetailCapability = (capability: string): boolean => detailCapabilities.includes(capability as any)
```

Replace the current answer-window tab list with:

```ts
const answerTabs = [
  hasDetailCapability('detail') ? { value: 'answer' as const, label: 'Detail', count: 0 } : null,
  hasDetailCapability('queue') ? {
    value: 'queue' as const,
    label: 'Queue',
    count: answerCandidates.filter((item) => item.status === 'new').length,
  } : null,
  hasDetailCapability('notes') ? { value: 'notes' as const, label: 'Notes', count: meetingNotes.length } : null,
].filter(Boolean)
```

Use `answerTabs` in the tab renderer. If the selected tab is no longer available for the active intent, fall back to `answer`.

- [ ] **Step 4: Pass capabilities to `AISuggestion`**

In `src/renderer/overlay/components/AISuggestion.tsx`, add prop:

```ts
detailCapabilities: string[]
```

Add helper:

```ts
const hasCapability = (capability: string): boolean => detailCapabilities.includes(capability)
```

Gate controls:

```tsx
{hasCapability('read-aloud') && (
  <button ... title={speaking ? 'Stop' : 'Read aloud'} />
)}

{hasCapability('teleprompter') && onOpenTeleprompter && (
  <button ... title="Open teleprompter" />
)}
```

Pass capabilities from `App.tsx`:

```tsx
<AISuggestion
  ...
  detailCapabilities={detailCapabilities}
/>
```

- [ ] **Step 5: Ensure code/image affordances work in rich detail**

In `src/renderer/overlay/components/RichContent.tsx`, ensure fenced code blocks expose a copy button when `copy-code` is enabled. If `RichContent` already renders copy affordances, route `detailCapabilities` into it and hide/show:

```tsx
<RichContent
  content={visibleAnswer}
  fontSize={fontSize}
  attachments={attachments}
  detailCapabilities={detailCapabilities}
/>
```

For generated images in attachments, ensure a Download button is shown when `download-images` is enabled. The button should call the existing image download IPC if present; otherwise it should create a browser download from the data URL/blob that is already rendered. The user-facing behavior must be:
- presentation and quick-help: download generated images is visible
- interview/class: generated images can render, but download is not a primary control unless later enabled

- [ ] **Step 6: Make detail routing use behavior policy**

In `src/main/services/agent/heartbeat-service.ts`, replace generic route-to-detail wording with behavior-driven wording:

```ts
const behavior = getSessionBehavior(sessionContext.sessionIntent || 'quick-help')
```

When `shouldRouteToDetail()` is true, use:

```ts
message: behavior.detailWindowPolicy.includes('code')
  ? 'I’m putting the code/details in Detail.'
  : 'I’m putting the detailed answer in Detail.',
```

In `src/main/services/agent/tool-definitions.ts`, update `open_answer_window` description:

```ts
'Open the main detail window with a substantial response. Use according to the active session intent: interview/class code or study detail, meeting decisions/actions, presentation notes/Q&A, and quick-help long/tool-heavy results.'
```

- [ ] **Step 7: Add code/test screenshot detail requirement**

In `src/main/ipc-handlers.ts` or wherever screenshot-triggered answers are routed, ensure that when the prompt or screenshot context looks like code/test/exercise and the current intent is `interview` or `class`, the answer window is shown and the answer prompt includes the `screenCodePolicy` line from `getSessionBehavior(intent)`.

Concrete prompt line to append:

```ts
`Screen/code policy: ${getSessionBehavior(sessionIntent).screenCodePolicy}`
```

This prevents the model from merely discussing visible code when it should provide a code snippet.

- [ ] **Step 8: Run checks**

Run:

```bash
npm run check:session-intents
npm run build
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/overlay/App.tsx src/renderer/overlay/components/AISuggestion.tsx src/renderer/overlay/components/RichContent.tsx src/main/services/agent/heartbeat-service.ts src/main/services/agent/tool-definitions.ts src/main/ipc-handlers.ts scripts/check-session-intent-policy.mjs
git commit -m "feat(detail): apply session intent capabilities"
```

---

### Task 10: Final Verification and Checkpoint

**Files:**
- Modify only if verification exposes issues.

- [ ] **Step 1: Run full focused verification**

Run:

```bash
npm run check:session-intents
npm run check:mode-isolation
npm run check:local-ai
npm run check:package
npm run build
git diff --check
```

Expected: all PASS.

- [ ] **Step 2: Manual smoke test in dev**

Run:

```bash
npm run dev
```

Manual checks:
- Start Live Session > Interview. System audio transcript label is `Interviewer`.
- In Interview, capture a coding-test/code screenshot. Detail opens with a concrete code snippet first, plus concise explanation and complexity.
- Start Live Session > Meeting. System audio transcript label is `Speaker`.
- In Meeting, Detail exposes Queue/Notes and produces decisions/actions instead of candidate-style answers.
- Start Live Session > Presentation. System audio transcript label is `Presenter`.
- In Presentation, Detail exposes teleprompter/read-aloud and generated-image download when images are present.
- Start Live Session > Class. System audio transcript label is `Instructor`; saved session title starts with class/course context; digest is generated only for class.
- In Class, lecture segments become context; an exercise/failing-test/code screenshot opens Detail with runnable code or a direct answer before explanation.
- Start Companion / Quick Help. User chat and mic remain `You`/`Chat`; external/system audio does not appear as `Interviewer`.
- Verify recall/brain context reflects the selected intent: interview remembers asked questions/stories, meeting remembers decisions/actions, presentation remembers Q&A/demo issues, class remembers topics/exercises/study tasks.

- [ ] **Step 3: Commit any verification fixes**

If manual fixes were required:

```bash
git add <changed-files>
git commit -m "fix(session): polish intent hardening"
```

- [ ] **Step 4: Push checkpoint**

```bash
git push
```

---

## Self-Review

Spec coverage:
- Dedicated class type: Task 1 adds `class` to `SessionIntent`; Task 3 exposes it in setup; Task 6 adds class prompts/title/digest behavior.
- Transcript no longer says interviewer for every system-audio source: Task 2 adds intent-aware labels; Task 7 guards against semantic fallback checks.
- Each type has hardened logic: Task 1 centralizes policy; Task 5 routes prompt selection by intent; Task 6 gives prompt/artifact differences; Task 8 applies brain/recall policy; Task 9 applies detail-window capabilities.
- Screenshot/code behavior: Task 1 defines `screenCodePolicy`; Task 6 injects it into prompts; Task 9 requires code/test screenshots in interview/class to produce detail-window code snippets instead of vague discussion.
- Detail window capabilities across intents: Task 1 defines `detailCapabilities`; Task 9 wires tabs/actions/rich-content affordances by intent.

Placeholder scan:
- No task depends on "TBD" behavior.
- Every changed area has a concrete file path, code shape, command, and expected result.

Type consistency:
- `SessionIntent` includes `class`.
- `TranscriptEntry.audioSource` uses `TranscriptAudioSource`.
- UI label code uses `getTranscriptSpeakerLabel()`.
- routing code uses `isExternalAudioEntry()`, `isSelfAuthoredEntry()`, `shouldUseExternalAudioPrompts()`, `shouldTreatExternalTranscriptAsPrompt()`, and `shouldAutoOpenAnswerWindowForExternalPrompt()`.
- behavior code uses `getSessionBehavior()` for prompts, brain policy, detail capabilities, and screenshot/code policy.
