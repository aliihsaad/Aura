/**
 * ModeRouter — single owner of "which pipeline is active right now".
 *
 * Phase 0: the router is constructed and exported, but no pipeline is
 * registered yet. ipc-handlers continues to drive session/companion/
 * workspace logic directly. Later phases register pipelines and migrate
 * call sites onto `router.dispatch*`.
 *
 * The router is the ONLY place in the codebase allowed to branch on
 * `mode === ...`. Everywhere else, route the event through here.
 */

import type {
  AgentMode,
  AppConfig,
  SessionContext,
  TranscriptEntry,
} from '@shared/types'
import type {
  Pipeline,
  PipelineStartContext,
  PipelineState,
  PipelineStopReason,
} from './pipeline'

export type PipelineFactory = (mode: AgentMode) => Pipeline | null

export interface ModeRouterOptions {
  /**
   * Builds a fresh pipeline instance for a given mode. Returning `null`
   * means "this mode has no migrated pipeline yet" — the router will leave
   * `activePipeline` unset and the legacy ipc-handler code stays in charge.
   */
  pipelineFactory: PipelineFactory

  /**
   * Optional broadcast hook so the router can publish `kernel:mode:active`
   * once the channel taxonomy work in Phase 5 lands. For Phase 0 this is
   * called but typically a no-op.
   */
  onModeActiveBroadcast?: (mode: AgentMode) => void
}

export class ModeRouter {
  private currentMode: AgentMode = 'companion'
  private activePipeline: Pipeline | null = null
  private starting: Promise<void> | null = null

  constructor(private readonly options: ModeRouterOptions) {}

  setModeActiveBroadcast(callback: (mode: AgentMode) => void): void {
    this.options.onModeActiveBroadcast = callback
  }

  // ── State ────────────────────────────────────────────────

  getMode(): AgentMode {
    return this.currentMode
  }

  getPipelineState(): PipelineState | null {
    return this.activePipeline ? this.activePipeline.getState() : null
  }

  /**
   * Returns true if the active pipeline implements the given mode AND has
   * been started. Phase 1+ uses this to decide whether to bypass the
   * legacy ipc-handler code.
   */
  hasActivePipeline(): boolean {
    return this.activePipeline !== null
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Switch to `mode` and start its pipeline against `session`. If the new
   * mode has no migrated pipeline (factory returns null), behaves as a
   * pure mode-mark — the caller falls back to legacy logic.
   */
  async startSession(mode: AgentMode, session: SessionContext): Promise<void> {
    await this.stopSession('mode-switch')
    this.currentMode = mode
    this.options.onModeActiveBroadcast?.(mode)

    const pipeline = this.options.pipelineFactory(mode)
    if (!pipeline) {
      this.activePipeline = null
      return
    }

    const ctx: PipelineStartContext = { session }
    this.starting = pipeline
      .start(ctx)
      .then(() => {
        this.activePipeline = pipeline
      })
      .catch(async (err) => {
        try {
          await pipeline.stop('fatal')
        } catch {
          /* swallow — pipeline already failed */
        }
        this.activePipeline = null
        throw err
      })
      .finally(() => {
        this.starting = null
      })

    await this.starting
  }

  async stopSession(reason: PipelineStopReason): Promise<void> {
    if (this.starting) {
      try {
        await this.starting
      } catch {
        /* start failed — fall through to a clean state */
      }
    }
    const pipeline = this.activePipeline
    this.activePipeline = null
    if (!pipeline) return
    await pipeline.stop(reason)
  }

  /**
   * Update the mode without starting a session. Used when Settings flips
   * `agentMode` while no session is live.
   */
  setMode(mode: AgentMode): void {
    if (this.activePipeline) {
      throw new Error(
        `ModeRouter.setMode called while a pipeline is active (${this.currentMode}). Stop the session first.`,
      )
    }
    if (this.currentMode === mode) return
    this.currentMode = mode
    this.options.onModeActiveBroadcast?.(mode)
  }

  // ── Event dispatch ───────────────────────────────────────

  dispatchTranscriptInterim(entry: TranscriptEntry): void {
    this.activePipeline?.onTranscriptInterim(entry)
  }

  dispatchTranscriptFinal(entry: TranscriptEntry): void {
    this.activePipeline?.onTranscriptFinal(entry)
  }

  async dispatchChatInput(text: string): Promise<void> {
    if (!this.activePipeline) return
    await this.activePipeline.onChatInput(text)
  }

  async dispatchScreenCaptureRequest(): Promise<void> {
    if (!this.activePipeline) return
    await this.activePipeline.onScreenCaptureRequest()
  }

  async dispatchManualAnswerRequest(question?: string): Promise<void> {
    if (!this.activePipeline) return
    await this.activePipeline.onManualAnswerRequest(question)
  }

  dispatchSettingsChanged(diff: Partial<AppConfig>): void {
    this.activePipeline?.onSettingsChanged(diff)
  }
}
