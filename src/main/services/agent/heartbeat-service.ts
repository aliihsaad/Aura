import {
  AgentPresenceState,
  HeartbeatState,
  InterruptionPolicy,
  MemoryRecord,
  PersonalityPreset,
  ProfileContext,
  SessionContext,
  TranscriptEntry,
  ToolDefinition,
  ToolExecutorFn,
} from '@shared/types'
import { HEARTBEAT_COOLDOWNS, HEARTBEAT_DEFAULTS } from '@shared/constants'
import { resolvePersonality, PersonalityConfig } from '@shared/personalities'
import { getSessionBehavior } from '@shared/session-intent-policy'
import { formatCurrentDateTime } from '@shared/prompts'
import { MemoryStore } from '../memory/memory-store'
import { EventStore } from '../memory/event-store'
import { LLMService } from '../llm-service'
import { WidgetManager } from '../canvas/widget-manager'
import { ConversationLogService } from '../conversation-log-service'
import {
  formatVisionCortexContext,
  type VisionCortexResult,
} from '../local-ai/providers/vision-provider'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Tools the heartbeat is NOT allowed to call. Any non-empty text output is
// rendered as a live bubble automatically, so the model never needs widget tools.
// solve_with_openrouter stays callable for hard delegated answers; Detail is
// the overflow surface for long/structured content that should not live in a bubble.
const HEARTBEAT_BLOCKED_TOOLS = new Set([
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
  'generate_image',
  'analyze_workspace_code',
])

// Spoken while a tool call is running so the user sees *something* instead of
// a silent pause. Replaced by the real follow-up text as it streams in.
const THINKING_PHRASES = [
  'let me check…',
  'give me a sec…',
  'one moment…',
  'hold on, looking…',
  'checking…',
]

interface HeartbeatDeps {
  getLLMService: () => LLMService | null
  eventStore: EventStore
  memoryStore: MemoryStore
  widgetManager: WidgetManager
  /** Optional telemetry sink — heartbeat records tick boundaries, dedup hits,
   * cooldown skips, and tool-call counts. No-ops when not wired. */
  recordTelemetry?: (type: string, payload?: Record<string, unknown>) => void
  /** Optional cost-tracker sink — heartbeat forwards every LLM token-usage
   * report so the session-level meter stays accurate. */
  recordUsage?: (model: string, promptTokens: number, completionTokens: number) => void
  /** Returns a current-state summary of what Aura actually does behind
   * the scenes — used so the agent doesn't deny features (like the
   * session-brain screenshot loop) that are actively running. */
  getCapabilitiesSummary?: () => string
  getSessionContext: () => SessionContext | undefined
  /** Cross-session memories recalled from Vault at session start. Injected
   * into the system prompt directly after soul.md, before everything else. */
  getVaultRecallContext?: () => string
  /** Usage guidance for the bridged vault_memory_* and vault_collab_* tools.
   * Empty when no Vault tools are bridged (servers offline or disabled). */
  getVaultToolGuidance?: () => string
  getProfile: () => ProfileContext | undefined
  getProfileMd: () => string
  getVoiceMd: () => string
  getFileContext: () => string
  /** Returns the shared dialog log so the heartbeat can build a real
   *  multi-turn messages array instead of a one-shot snapshot. */
  getConversationLog: () => ConversationLogService
  getSessionTranscript: () => TranscriptEntry[]
  getLatestScreenSummary: () => string | undefined
  getLocalVisionContext?: () => Promise<VisionCortexResult | null>
  getSessionFolderName: () => string | undefined
  getModel: () => string
  getToolDefinitions: () => ToolDefinition[]
  getToolExecutor: () => ToolExecutorFn
  getOverlayWindow: () => BrowserWindow | null
  getCanvasWindow: () => BrowserWindow | null
  isAnswerWindowVisible?: () => boolean
  openDetailWindow?: (title: string, content: string) => void
  shouldPause?: () => boolean
  onCompanionTextStart?: () => void
  onCompanionTextToken?: (fullText: string, delta: string) => void
  onCompanionTextEnd?: (fullText: string) => void
}

let soulPrompt: string | null = null

function loadSoulPrompt(): string {
  if (soulPrompt !== null) return soulPrompt
  try {
    const soulPath = path.join(__dirname, '../../shared/soul.md')
    soulPrompt = fs.readFileSync(soulPath, 'utf-8')
  } catch {
    soulPrompt = 'You are Aura, a local memory-native desktop companion.'
  }
  return soulPrompt
}

export class HeartbeatService {
  // True between start() and stop(). Replaces the old `timer != null` check —
  // the heartbeat no longer runs on a metronome, so triggered ticks gate on
  // this instead of "is the interval running".
  private running: boolean = false
  // One-shot timer armed after each real user turn. If it fires before the
  // user comes back, the agent gets ONE chance to chime in unprompted. New
  // user activity cancels it. This replaces the old setInterval poll.
  private proactiveTimer: NodeJS.Timeout | null = null
  private enabled: boolean = HEARTBEAT_DEFAULTS.enabled
  private intervalMs: number = HEARTBEAT_DEFAULTS.intervalMs
  private personality: PersonalityPreset = 'auto'
  private interruptionPolicy: InterruptionPolicy = 'ask-first'
  private presenceState: AgentPresenceState = 'sleeping'
  private lastTickAt: number | null = null
  private lastLLMCallAt: number | null = null
  private lastEventCountAtTick: number = 0
  private cooldowns: Record<string, number> = {}
  private tickInFlight: boolean = false
  // Whether the most recently-run tick was a real user-triggered one (vs a
  // proactive nudge). Used by tick()'s finally to decide whether to re-arm
  // the proactive timer — only triggered ticks re-arm, so a proactive nudge
  // doesn't loop into another nudge.
  private lastTickWasTriggered: boolean = false
  // Cached across ticks so the next turn reuses the same widget instead of
  // registering a new one at the default anchor (preserves user drag position).
  // Keeps a cached companion bubble id in sync with the widget manager.
  private agentBubbleId: string | null = null
  private lastEmittedText: string = ''
  private lastDetailAnswerText: string = ''
  // Rolling window of recent bubble outputs for semantic-similarity dedup.
  // Catches the "rephrase the same thought 5 times" failure mode where each
  // bubble is technically novel text but conveys the same idea.
  private recentEmittedTexts: string[] = []
  // When false, the service still responds to triggerTick() calls (e.g.
  // transcript finalization) but never arms the proactive timer. Transcript-
  // triggered answers still work; autonomous "chime in during silence"
  // behavior is suppressed.
  private proactiveEnabled: boolean = true
  private pendingTriggerTicks: number = 0
  private lastProcessedTranscriptKey: string = ''

  constructor(private readonly deps: HeartbeatDeps) {}

  // The cached id can become stale if the user manually dismisses the bubble
  // via the X button. Sync the cache with the widget manager so callers don't
  // .update() a dead widget id.
  private activeAgentBubbleId(): string | null {
    if (!this.agentBubbleId) return null
    if (!this.deps.widgetManager.get(this.agentBubbleId)) {
      this.agentBubbleId = null
      return null
    }
    return this.agentBubbleId
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.setPresenceState('idle')
    this.lastEventCountAtTick = this.deps.eventStore.count()
    // No metronome — the agent only acts on a real user turn (triggerTick)
    // or on the one-shot proactive timer armed after a turn.
  }

  stop(): void {
    this.running = false
    this.clearProactiveTimer()
    const llmService = this.deps.getLLMService()
    llmService?.abortHeartbeat?.()
    this.setPresenceState('sleeping')
    this.lastTickAt = null
    this.lastEventCountAtTick = 0
    this.agentBubbleId = null
    this.lastDetailAnswerText = ''
    this.pendingTriggerTicks = 0
    this.lastProcessedTranscriptKey = ''
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.stop()
  }

  setIntervalMs(ms: number): void {
    // Now interpreted as "how long after the conversation goes quiet before
    // the agent may chime in unprompted". No live timer to reset — the next
    // armed proactive timer picks up the new value.
    this.intervalMs = Math.max(
      HEARTBEAT_DEFAULTS.minIntervalMs,
      Math.min(HEARTBEAT_DEFAULTS.maxIntervalMs, ms)
    )
  }

  setPersonality(preset: PersonalityPreset): void { this.personality = preset }
  setInterruptionPolicy(policy: InterruptionPolicy): void { this.interruptionPolicy = policy }
  getPersonality(): PersonalityPreset { return this.personality }
  getInterruptionPolicy(): InterruptionPolicy { return this.interruptionPolicy }
  getPresenceState(): AgentPresenceState { return this.presenceState }
  setProactiveEnabled(enabled: boolean): void {
    this.proactiveEnabled = enabled
    if (!enabled) this.clearProactiveTimer()
  }
  getProactiveEnabled(): boolean { return this.proactiveEnabled }
  isTickInFlight(): boolean { return this.tickInFlight }

  private clearProactiveTimer(): void {
    if (this.proactiveTimer) {
      clearTimeout(this.proactiveTimer)
      this.proactiveTimer = null
    }
  }

  /**
   * Run a heartbeat tick immediately. Called when a new event (finalized
   * transcript line, chat input, screenshot) is worth reacting to. Safe to
   * call frequently — the tickInFlight guard + cooldown coalesce bursts.
   */
  triggerTick(): void {
    if (!this.enabled || !this.running) return
    // The conversation is active — cancel any pending "chime in unprompted"
    // timer; it'll be re-armed after this tick completes.
    this.clearProactiveTimer()
    this.pendingTriggerTicks++
    void this.tick()
  }

  /**
   * Abort whatever the agent is currently saying. Called when the user barges
   * in mid-reply — drop the now-stale answer rather than finish narrating it.
   * The debounced re-trigger from the new user turn will produce a fresh reply.
   */
  abortInFlightTick(): void {
    if (!this.tickInFlight) return
    this.deps.getLLMService()?.abortHeartbeat?.()
  }

  /**
   * Call on any user-side activity (a finalized transcript line, chat input)
   * regardless of mode. Pushes the one-shot "chime in unprompted" timer out
   * to intervalMs-from-now. In Companion mode triggerTick() also runs and its
   * post-tick finally re-arms — calling both is harmless (last arm wins). In
   * Session mode no triggered tick runs (the answer pipeline handles
   * replies), so this is the only thing that keeps proactive nudges alive.
   */
  notifyActivity(): void {
    if (!this.running || !this.proactiveEnabled) return
    this.clearProactiveTimer()
    this.proactiveTimer = setTimeout(() => {
      this.proactiveTimer = null
      void this.tick()
    }, this.intervalMs)
  }

  getSoulPrompt(): string {
    return loadSoulPrompt()
  }

  getResolvedPersonality(): PersonalityConfig {
    return resolvePersonality(
      this.personality,
      this.deps.getSessionContext(),
      this.deps.eventStore.count(),
      this.deps.memoryStore.listRecent({ limit: 5, statuses: ['active'] }).length
    )
  }

  getState(): HeartbeatState {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastTickAt: this.lastTickAt,
      lastLLMCallAt: this.lastLLMCallAt,
      presenceState: this.presenceState,
      personality: this.personality,
      interruptionPolicy: this.interruptionPolicy,
    }
  }

  setPresenceState(state: AgentPresenceState): void {
    this.presenceState = state
    const overlayWindow = this.deps.getOverlayWindow()
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('agent:presence-state', state)
    }
    const canvasWindow = this.deps.getCanvasWindow()
    if (canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.webContents.send('agent:presence-state', state)
    }
  }

  private async tick(): Promise<void> {
    if (!this.enabled) return
    if (this.tickInFlight) return
    this.tickInFlight = true
    try {
      await this.tickInner()
    } finally {
      this.tickInFlight = false
      // Drain any triggers that arrived while we were busy. Without this, a
      // trigger that fires mid-LLM-stream is lost — the agent waits for the
      // next user turn instead of replying as soon as it can.
      if (this.pendingTriggerTicks > 0) {
        const cooldownLeft = this.cooldownRemainingMs('global')
        if (cooldownLeft > 0) {
          // Cooldown still ticking — wait it out, then re-fire once.
          setTimeout(() => void this.tick(), cooldownLeft + 50)
        } else {
          // Fire immediately on the next microtask so we don't recurse the stack.
          setTimeout(() => void this.tick(), 0)
        }
      } else if (
        this.running &&
        this.proactiveEnabled &&
        this.lastTickWasTriggered &&
        !this.proactiveTimer
      ) {
        // The conversation just went quiet after a real user turn. Arm ONE
        // proactive-check timer — if the user doesn't come back, the agent
        // gets a single chance to chime in unprompted (~intervalMs later).
        // A proactive tick does NOT re-arm, so this fires at most once per
        // quiet period.
        this.proactiveTimer = setTimeout(() => {
          this.proactiveTimer = null
          void this.tick()
        }, this.intervalMs)
      }
    }
  }

  private async tickInner(): Promise<void> {
    this.lastTickAt = Date.now()

    if (this.deps.shouldPause?.()) {
      if (this.presenceState === 'thinking') this.setPresenceState('idle')
      return
    }

    // Cooldown is checked BEFORE decrementing pendingTriggerTicks so the
    // tick() drainer can re-fire as soon as the cooldown expires. If we
    // decremented first, a cooldown-blocked trigger would be lost forever
    // and the user would have to wait for the next polling interval.
    if (!this.checkCooldown('global')) {
      this.deps.recordTelemetry?.('heartbeat.skip', {
        reason: 'cooldown',
        cooldownRemainingMs: this.cooldownRemainingMs('global'),
        pending: this.pendingTriggerTicks,
      })
      return
    }

    const wasEventTriggered = this.pendingTriggerTicks > 0
    if (wasEventTriggered) this.pendingTriggerTicks--
    this.lastTickWasTriggered = wasEventTriggered

    if (!this.proactiveEnabled && !wasEventTriggered) {
      // Proactive nudge timer fired but proactive is disabled — skip silently.
      if (this.presenceState === 'thinking') this.setPresenceState('idle')
      return
    }

    const currentEventCount = this.deps.eventStore.count()
    if (currentEventCount <= this.lastEventCountAtTick) {
      if (this.presenceState === 'thinking') this.setPresenceState('idle')
      return
    }
    this.lastEventCountAtTick = currentEventCount

    const sessionContext = this.deps.getSessionContext()
    const transcript = this.deps.getSessionTranscript()
    const recentTranscript = transcript.slice(-10)
    if (recentTranscript.length === 0) return

    const transcriptKey = buildTranscriptKey(recentTranscript)
    if (transcriptKey && transcriptKey === this.lastProcessedTranscriptKey) {
      if (this.presenceState === 'thinking') this.setPresenceState('idle')
      return
    }
    this.lastProcessedTranscriptKey = transcriptKey

    const recentMemories = this.deps.memoryStore.listRecent({ limit: 5, statuses: ['active'] })
    const personalityConfig = resolvePersonality(
      this.personality,
      sessionContext,
      currentEventCount,
      recentMemories.length
    )

    const soulText = loadSoulPrompt()
    const profile = this.deps.getProfile()
    const profileMd = this.deps.getProfileMd()
    const voiceMd = this.deps.getVoiceMd()
    const fileContext = this.deps.getFileContext()
    const localVisionContext = await this.readLocalVisionContext()
    const snapshot = this.buildContextSnapshot(
      sessionContext,
      profile,
      profileMd,
      voiceMd,
      fileContext,
      localVisionContext,
      recentMemories,
      personalityConfig
    )

    this.setPresenceState('thinking')

    try {
      const llmService = this.deps.getLLMService()
      if (!llmService) {
        this.setPresenceState('idle')
        return
      }
      this.lastLLMCallAt = Date.now()

      const vaultRecallContext = this.deps.getVaultRecallContext?.() ?? ''
      const vaultToolGuidance = this.deps.getVaultToolGuidance?.() ?? ''

      const systemPrompt = [
        soulText,
        ...(vaultRecallContext.trim()
          ? ['', vaultRecallContext.trim()]
          : []),
        '',
        '## Current Personality',
        personalityConfig.systemPromptFragment,
        '',
        '## Your Task',
        'You are running a background heartbeat check. Review the recent context and decide whether to act.',
        'If you want to say something to the user, write it as plain text — a short, calm, proactive nudge (one or two sentences).',
        'Your text output is rendered directly as a floating bubble on the user\'s screen, so write *to* them, not *about* them.',
        '',
        '## Dialog Continuity',
        'You can see your own prior replies and the user\'s recent turns in the message history above this prompt. Treat them as the ongoing conversation — extend, refine, or build on them. Do not restart the topic from scratch each tick.',
        'Speak when the conversation calls for it:',
        '  - The user just said something that merits a reply (a fragment like "I\'m not" or "going pretty smooth" is not a reply trigger — wait for the thought to finish).',
        '  - You have something genuinely new to add — a fresh angle, a correction, a follow-up question, a callback to something they said earlier. Not a paraphrase of your last bubble.',
        'Stay silent when:',
        '  - You\'d only repeat or rephrase what you already said in the visible history. The user can already see it.',
        '  - Nothing new has happened since your last bubble.',
        '  - All you have is a generic acknowledgement ("Noted.", "Got it.").',
        `Confidence threshold: ${personalityConfig.confidenceThreshold}. Only speak if your confidence exceeds this.`,
        '',
        '## Routing Rules',
        'Messages tagged [user (chat)] are direct typed messages from the user in an ongoing thread — reply to them conversationally. Use earlier turns and the last answer for context (e.g. follow-ups like "make it shorter" or "explain step 2" refer to what you produced before).',
        'Answer as a direct assistant. Do not treat every transcript segment as a question — reply when there is a real prompt or something genuinely useful to add.',
        'Use a short bubble reply only for quick observations, reminders, confirmations, or one-line suggestions.',
        '',
        '### Note-taking intent — call save_memory ONLY on explicit save commands',
        'Call save_memory in this tick when the user says an explicit save verb:',
        '  - "save this", "save that", "save as a note", "add a note"',
        '  - "remember this", "remember that", "note that"',
        '  - "log this", "write this down", "keep track of this"',
        'A 60-second server-side cooldown is enforced — a second save within 60s will be refused and surface as a tool error. Treat that as a real constraint, not a glitch.',
        '',
        'DO NOT call save_memory when:',
        '  - The user asks a question (questions are not save commands, even if the answer is memorable).',
        '  - The topic merely feels useful or quotable — "what value is this for future-me" is the user\'s judgement, not yours.',
        '  - The user thanks you or acknowledges an answer.',
        '  - You already saved a memory in the recent tick log. Check before calling.',
        'If a save is refused by the cooldown, DO NOT retry it. Acknowledge in text only: "I already saved a related note recently — let me know if you want me to overwrite or save a different angle."',
        '',
        'After a successful save_memory, your bubble text should briefly confirm what was saved — quote a short phrase from the title (e.g. "Saved a note: heartbeat repetition + latency conflict"). Do NOT output a bare "Noted." — confirmation must reference the actual content.',
        '',
        '### Drop-topic intent — when the user says forget it',
        'If the user\'s most recent turn contains "forget that", "never mind", "ignore that", "scratch that", "drop it", "let it go", or a close paraphrase, immediately drop the previous topic. Your next reply MUST NOT reference the dropped topic at all — not even to acknowledge dropping it. Move on to whatever the user said next, or stay silent.',
        'A previously-emitted topic that turned out to be a transcription error (e.g. you hallucinated about a phrase that you now realize was a Deepgram mistake) ALSO counts as drop-topic — apologize once briefly, then never mention it again.',
        '',
        'If the user (or speaker) asks you to solve, explain in steps, write code, compare options, or show a structured answer, keep the bubble concise or use solve_with_openrouter for harder work.',
        'If the task feels genuinely hard or benefits from stronger reasoning, use solve_with_openrouter. Default to it for coding problems, debugging, non-trivial math, system design, and deep analysis.',
        'When you use solve_with_openrouter, do not also produce a long bubble reply. At most, give a tiny lead-in. Shorter is better.',
        'If the user explicitly wants the solution applied or ready to paste, use insert_solution_into_editor.',
        'If the screen shows code or a technical error, prefer run_code_analysis_on_screen before commenting on what is visible.',
        '',
        ...(vaultToolGuidance.trim() ? [vaultToolGuidance.trim(), ''] : []),
        '## Capability Disclosure Rules',
        'If the user asks what tools or capabilities you have, be precise about direct companion tools versus delegated answer-pipeline tools.',
        'Direct companion tools: recall and save memory, get session context, inspect the current screen when explicitly asked, search or preview/open saved artifacts, summarize the current task, copy prepared text/code to clipboard, and delegate hard work to the OpenRouter answer pipeline.',
        'Delegated answer-pipeline tools (via solve_with_openrouter): search the web, generate images, run deeper code/screen analysis. The result is written into the answer window.',
        'Do not claim you can insert directly into an editor. Say you can copy prepared content to the clipboard for the user to paste.',
        'Do not claim you can write files, create folders, run terminal commands, or modify a workspace. Those capabilities do not exist in this build — say so plainly if asked.',
        '',
        'Use get_session_context when you need continuity about what already happened in the session.',
        'Use save_memory to record important facts worth remembering, and recall_memory or search_artifacts to look things up.',
        'Only use analyze_current_screen when the user explicitly asks what is visible on screen. Never guess about screen contents.',
        'Silence is always acceptable and usually correct.',
      ].join('\n')

      const tools = this.deps.getToolDefinitions().filter(
        (t) => !HEARTBEAT_BLOCKED_TOOLS.has(t.function.name)
      )
      const executor = this.deps.getToolExecutor()
      const widgetManager = this.deps.widgetManager

      // Reuse a previous bubble if it's still on screen, otherwise register a
      // fresh one (no TTL — captions-style: it stays until the user dismisses
      // it or the next turn overwrites its content).
      const ensureBubble = (initialMessage: string): string => {
        const existing = this.activeAgentBubbleId()
        if (existing) {
          widgetManager.update(existing, { message: initialMessage, streaming: true })
          return existing
        }
        const widget = widgetManager.register({
          type: 'bubble',
          props: { message: initialMessage, urgency: 'low', expandable: true, streaming: true },
          ttl: null,
        })
        this.agentBubbleId = widget.id
        return widget.id
      }

      const tickStartedAt = Date.now()
      this.deps.recordTelemetry?.('heartbeat.tick.start', {
        snapshotChars: snapshot.length,
        systemPromptChars: systemPrompt.length,
        wasEventTriggered,
        transcriptLines: recentTranscript.length,
      })

      const priorMessages = this.deps.getConversationLog().getRecentAlternations(8)
      let routingToDetail = false
      const detailBehavior = getSessionBehavior(sessionContext?.sessionIntent || 'quick-help')
      const detailRouteMessage = detailBehavior.detailWindowPolicy.includes('code')
        ? 'I’m putting the code/details in Detail.'
        : 'I’m putting the detailed answer in Detail.'
      const detailRouteDoneMessage = detailBehavior.detailWindowPolicy.includes('code')
        ? 'I put the code/details in Detail.'
        : 'I put the detailed answer in Detail.'

      const result = await llmService.runHeartbeat(systemPrompt, snapshot, tools, executor, {
        priorMessages,
        onUsage: (usage) => {
          this.deps.recordUsage?.(usage.model, usage.promptTokens, usage.completionTokens)
          this.deps.recordTelemetry?.('llm.usage', {
            source: 'heartbeat',
            model: usage.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
          })
        },
        onStreamStart: () => {
          this.deps.onCompanionTextStart?.()
          ensureBubble('')
        },
        onStreamToken: (fullText, delta) => {
          this.deps.onCompanionTextToken?.(fullText, delta)
          const id = this.activeAgentBubbleId()
          if (!id) return
          if (!routingToDetail && this.shouldRouteToDetail(fullText)) {
            routingToDetail = true
            this.deps.onCompanionTextEnd?.('')
            widgetManager.update(id, {
              message: detailRouteMessage,
              streaming: true,
            })
            return
          }
          if (routingToDetail) return
          widgetManager.update(id, { message: fullText, streaming: true })
        },
        onToolCallStart: () => {
          const phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)]
          ensureBubble(phrase)
        },
        onStreamEnd: (fullText) => {
          const id = this.activeAgentBubbleId()
          if (!id) {
            this.deps.onCompanionTextEnd?.('')
            return
          }
          const trimmed = fullText.trim()
          if (!trimmed) {
            // Empty turn (model produced no usable text after a tool call):
            // tear the placeholder down so we don't leave a blank bubble.
            widgetManager.dismiss(id)
            this.agentBubbleId = null
            this.deps.onCompanionTextEnd?.('')
            return
          }
          if (this.shouldSuppressOutput(trimmed, recentTranscript)) {
            widgetManager.dismiss(id)
            this.agentBubbleId = null
            this.deps.onCompanionTextEnd?.('')
            return
          }
          if (routingToDetail || this.shouldRouteToDetail(trimmed)) {
            if (this.shouldSuppressDuplicateDetailAnswer(trimmed, recentTranscript)) {
              widgetManager.dismiss(id)
              this.agentBubbleId = null
              this.deps.onCompanionTextEnd?.('')
              return
            }
            widgetManager.update(id, {
              message: detailRouteDoneMessage,
              streaming: false,
            })
            this.lastDetailAnswerText = trimmed
            this.deps.openDetailWindow?.('Detailed answer', trimmed)
            this.deps.onCompanionTextEnd?.('')
            return
          }
          this.lastEmittedText = trimmed
          this.recentEmittedTexts.push(trimmed)
          if (this.recentEmittedTexts.length > 5) this.recentEmittedTexts.shift()
          widgetManager.update(id, { message: trimmed, streaming: false })
          this.deps.onCompanionTextEnd?.(trimmed)
          // No setTtl: bubble persists until the user closes it or the next
          // turn rewrites its message.
        },
      })
      if (result.toolCallsExecuted > 0) {
        console.log(`[Heartbeat] ${result.toolCallsExecuted} tool call(s) executed`)
      }

      this.deps.recordTelemetry?.('heartbeat.tick.complete', {
        toolCallsExecuted: result.toolCallsExecuted,
        finalTextChars: (result.finalText ?? '').length,
        durationMs: Date.now() - tickStartedAt,
      })

      this.setCooldown('global', HEARTBEAT_COOLDOWNS.globalMinMs)
    } catch (error: any) {
      this.deps.onCompanionTextEnd?.('')
      // On abort (new tick supersedes, or user barged in), tear down the
      // partial-text bubble so a half-formed reply doesn't linger on screen.
      const orphan = this.activeAgentBubbleId()
      if (orphan) {
        this.deps.widgetManager.dismiss(orphan)
        this.agentBubbleId = null
      }
      if (error?.name === 'AbortError') return
      console.error('[Heartbeat] LLM call failed:', error)
    } finally {
      if (this.presenceState === 'thinking') this.setPresenceState('idle')
    }
  }

  private shouldRouteToDetail(text: string): boolean {
    const trimmed = text.trim()
    if (trimmed.length > 520) return true
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0)
    if (lines.length >= 6) return true
    if (/```|^\s*#{1,6}\s+|^\s*\|.+\|\s*$|!\[[^\]]*]\(/m.test(trimmed)) return true
    const listItems = lines.filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).length
    return listItems >= 3
  }

  private shouldSuppressDuplicateDetailAnswer(text: string, recentTranscript: TranscriptEntry[]): boolean {
    if (!this.lastDetailAnswerText.trim()) return false
    const latestFinal = [...recentTranscript].reverse().find((entry) => entry.isFinal && entry.speaker === 'user')
    if (!latestFinal || !isAcknowledgementTurn(latestFinal.text)) return false

    const currentTokens = tokenSet(text)
    const previousTokens = tokenSet(this.lastDetailAnswerText)
    const score = jaccard(currentTokens, previousTokens)
    const sameNormalized = normalizeForDedupe(text) === normalizeForDedupe(this.lastDetailAnswerText)
    if (!sameNormalized && score < 0.55) return false

    this.deps.recordTelemetry?.('heartbeat.detail.suppress_duplicate', {
      reason: 'acknowledgement-after-detail',
      score: Number(score.toFixed(3)),
      latestUserTurn: latestFinal.text.trim().slice(0, 120),
    })
    return true
  }

  private shouldSuppressOutput(text: string, recentTranscript: TranscriptEntry[]): boolean {
    const normalized = normalizeForDedupe(text)
    if (!normalized) {
      this.deps.recordTelemetry?.('heartbeat.suppress', { reason: 'empty' })
      return true
    }
    if (normalized === normalizeForDedupe(this.lastEmittedText)) {
      this.deps.recordTelemetry?.('heartbeat.suppress', { reason: 'exact-prev' })
      return true
    }

    const latestFinal = [...recentTranscript].reverse().find((entry) => entry.isFinal)
    if (latestFinal && normalized === normalizeForDedupe(latestFinal.text)) {
      this.deps.recordTelemetry?.('heartbeat.suppress', { reason: 'echo-user' })
      return true
    }

    // Backstop dedup — the model now sees its own prior replies in the
    // messages array, so it should self-suppress most repeats. This catches
    // the cases where it doesn't. Loosened to 0.55 (was 0.40) after the
    // ConversationLog refactor on 2026-05-11 made aggressive heuristic
    // dedup the cause of flash-and-vanish bubbles. Trigram pass dropped
    // entirely — token Jaccard is sufficient as a backstop.
    const newTokens = tokenSet(text)
    if (newTokens.size >= 4) {
      for (const prev of this.recentEmittedTexts) {
        const prevTokens = tokenSet(prev)
        if (prevTokens.size < 4) continue
        const score = jaccard(newTokens, prevTokens)
        if (score >= 0.55) {
          console.log(
            `[Heartbeat] suppressed near-duplicate bubble (token-overlap ${score.toFixed(2)})`
          )
          this.deps.recordTelemetry?.('heartbeat.suppress', {
            reason: 'token-overlap',
            score: Number(score.toFixed(3)),
          })
          return true
        }
      }
    }

    return false
  }

  private async readLocalVisionContext(): Promise<VisionCortexResult | null> {
    if (!this.deps.getLocalVisionContext) return null
    try {
      return await this.deps.getLocalVisionContext()
    } catch (error) {
      console.warn('[Heartbeat] local vision context unavailable:', error)
      return null
    }
  }

  private buildContextSnapshot(
    sessionContext: SessionContext | undefined,
    profile: ProfileContext | undefined,
    profileMd: string,
    voiceMd: string,
    fileContext: string,
    localVisionContext: VisionCortexResult | null,
    recentMemories: MemoryRecord[],
    personality: PersonalityConfig
  ): string {
    const parts: string[] = []
    const trim = (s: string, max: number): string =>
      s.length > max ? s.slice(0, max).trimEnd() + '…' : s

    // Rebuilt every tick, so the agent always knows the real wall-clock time.
    parts.push(`Current date and time: ${formatCurrentDateTime()}`)

    if (sessionContext) {
      const behavior = getSessionBehavior(sessionContext.sessionIntent || 'quick-help')
      const meta = [
        sessionContext.sessionIntent && `Intent: ${sessionContext.sessionIntent}`,
        sessionContext.companyName && `Company: ${sessionContext.companyName}`,
        sessionContext.roleName && `Role: ${sessionContext.roleName}`,
        sessionContext.subject && `Subject: ${sessionContext.subject}`,
        sessionContext.sessionNotes && `Session notes from user: ${sessionContext.sessionNotes}`,
        `Behavior role: ${behavior.agentRole}`,
        `Auto-trigger posture: ${behavior.autoTriggerStrategy}`,
        `Detail policy: ${behavior.detailWindowPolicy}`,
        `Screen/code policy: ${behavior.screenCodePolicy}`,
        `Brain policy: ${behavior.brainPolicy}`,
      ].filter(Boolean)
      if (meta.length > 0) parts.push('## Session Context\n' + meta.join('\n'))
    }

    if (profile) {
      const universal = [
        profile.name && `Name: ${profile.name}`,
        profile.languages && `Languages: ${profile.languages}`,
        profile.occupation && `Occupation: ${profile.occupation}`,
        profile.currentFocus && `Currently focused on: ${profile.currentFocus}`,
        profile.commsStyle && `How they like to be spoken to: ${profile.commsStyle}`,
        profile.extraInstructions && `Standing instructions: ${profile.extraInstructions}`,
        profile.relationships && `Relationships: ${profile.relationships}`,
      ].filter(Boolean)
      if (universal.length > 0) parts.push('## User Profile\n' + universal.join('\n'))

    }

    const trimmedProfileMd = profileMd.trim()
    if (trimmedProfileMd.length > 0) {
      parts.push(
        '## Long-term Profile (auto-maintained)\n' +
          'This is what you have learned about the user across sessions. Treat it as more recent and authoritative than the structured profile above when they conflict.\n\n' +
          trim(trimmedProfileMd, 8000)
      )
    }

    const trimmedVoiceMd = voiceMd.trim()
    if (trimmedVoiceMd.length > 0) {
      parts.push(
        '## Voice & Style (auto-maintained)\n' +
          'These are stylistic preferences the user has built up across sessions. Follow them strictly — they override generic personality defaults.\n\n' +
          trim(trimmedVoiceMd, 4000)
      )
    }

    // Ground the agent in its actual runtime so it stops denying real
    // features. User flagged 2026-05-11 that the agent claimed it doesn't
    // take screenshots on a timer — but session-brain does exactly that
    // when enabled. The agent must know what it does.
    const capabilities = this.deps.getCapabilitiesSummary?.()?.trim() ?? ''
    if (capabilities.length > 0) {
      parts.push(
        '## What I Actually Do (current runtime state)\n' +
          'These are real behaviors active right now. Never deny them. If asked, answer accurately.\n\n' +
          capabilities
      )
    }

    const trimmedFileContext = fileContext.trim()
    if (trimmedFileContext.length > 0) {
      parts.push('## Loaded Context Files\n' + trim(trimmedFileContext, 60_000))
    }

    if (this.deps.isAnswerWindowVisible?.()) {
      parts.push(
        '## Detail Window\n' +
          'The user currently has the detail window open showing your last answer. If they say "explain step 2", "shorten that", "the second point", etc., they mean what is displayed there.'
      )
    }

    if (localVisionContext) {
      parts.push('## Local Vision Context\n' + formatVisionCortexContext(localVisionContext))
    }

    // NOTE: recent transcript is now passed as a real user/assistant
    // messages array via runHeartbeat({ priorMessages }) so the model sees
    // genuine dialog continuity. Nothing transcript-related goes into the
    // snapshot anymore — it would just duplicate what's already in the
    // messages array.

    if (recentMemories.length > 0) {
      const lines = recentMemories.map((m) => `- [${m.type}] ${m.title}: ${m.summary}`)
      parts.push('## Recent Memories\n' + lines.join('\n'))
    }

    const latestScreenSummary = this.deps.getLatestScreenSummary()
    if (latestScreenSummary) {
      parts.push('## Latest Screen Summary\n' + latestScreenSummary)
    }

    parts.push(`\nPersonality: ${personality.label}`)
    parts.push(`Interruption Policy: ${this.interruptionPolicy}`)

    return parts.join('\n\n')
  }

  private checkCooldown(key: string): boolean {
    const lastUsed = this.cooldowns[key]
    if (!lastUsed) return true
    return Date.now() - lastUsed >= HEARTBEAT_COOLDOWNS.globalMinMs
  }

  private cooldownRemainingMs(key: string): number {
    const lastUsed = this.cooldowns[key]
    if (!lastUsed) return 0
    return Math.max(0, HEARTBEAT_COOLDOWNS.globalMinMs - (Date.now() - lastUsed))
  }

  private setCooldown(key: string, _durationMs: number): void {
    this.cooldowns[key] = Date.now()
  }
}

function normalizeForDedupe(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`*_>-]+|[\s"'`*_>-]+$/g, '')
    .trim()
}

function isAcknowledgementTurn(value: string): boolean {
  const normalized = normalizeForDedupe(value).replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim()
  return /^(correct|it'?s working|it works|thanks|thank you|got it|ok|okay|yes|yeah|cool|perfect|great|nice)(?:\s|$)/.test(normalized) &&
    normalized.split(/\s+/).filter(Boolean).length <= 8
}

function buildTranscriptKey(entries: TranscriptEntry[]): string {
  return entries
    .filter((entry) => entry.isFinal)
    .map((entry) => `${entry.id}:${entry.timestamp}:${normalizeForDedupe(entry.text)}`)
    .join('|')
}

// Stop-words excluded from token-overlap matching so common phrasing
// scaffolding ("the", "your", "to") doesn't inflate similarity scores.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'of',
  'on', 'or', 'she', 'so', 'that', 'the', 'their', 'them', 'they', 'this',
  'to', 'was', 'we', 'were', 'will', 'with', 'you', 'your', 'youre', 'im',
  'me', 'my', 'our', 'us', 'these', 'those', 'do', 'does', 'did', 'can',
  'could', 'would', 'should', 'might', 'just', 'really', 'very', 'now',
  'one', 'two', 'three', 'some', 'any', 'all', 'no', 'not',
])

function tokenSet(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}
