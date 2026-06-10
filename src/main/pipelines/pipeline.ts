/**
 * Pipeline contract — Phase 0 of the mode-isolation refactor.
 *
 * Each product mode (session / companion / workspace) implements this
 * interface in a dedicated pipeline class. The ModeRouter holds at most
 * one active pipeline at a time and forwards events to it.
 *
 * Hard rules from §3 of the plan:
 *   1. No service holds a reference to another pipeline.
 *   2. `stop()` releases every resource `start()` acquired.
 *   3. `if (mode === ...)` is forbidden outside the router.
 */

import type {
  AgentMode,
  AgentPresenceState,
  AppConfig,
  CompanionRealtimeStatus,
  SessionContext,
  TranscriptEntry,
} from '@shared/types'

export type PipelineStopReason = 'user-stop' | 'mode-switch' | 'fatal'

export interface PipelineState {
  mode: AgentMode
  presence: AgentPresenceState
  busy: boolean
  companionRealtimeStatus?: CompanionRealtimeStatus
}

/**
 * Context passed to `pipeline.start()`. For Phase 0/1 we accept the legacy
 * `SessionContext` shape; Phase 4 replaces this with a discriminated union
 * keyed on mode.
 */
export interface PipelineStartContext {
  session: SessionContext
}

export interface Pipeline {
  readonly mode: AgentMode

  start(ctx: PipelineStartContext): Promise<void>
  stop(reason: PipelineStopReason): Promise<void>

  // Inbound events. Implementations decide what (if anything) to do.
  onTranscriptInterim(entry: TranscriptEntry): void
  onTranscriptFinal(entry: TranscriptEntry): void
  onChatInput(text: string): Promise<void>
  onScreenCaptureRequest(): Promise<void>
  onManualAnswerRequest(question?: string): Promise<void>
  onSettingsChanged(diff: Partial<AppConfig>): void

  // Outbound state for UI / diagnostics.
  getState(): PipelineState
}

/**
 * Minimal base class with no-op defaults. Mode pipelines extend this and
 * override the events they care about, so adding a new event to the
 * interface doesn't force every pipeline to grow boilerplate.
 */
export abstract class BasePipeline implements Pipeline {
  abstract readonly mode: AgentMode

  abstract start(ctx: PipelineStartContext): Promise<void>
  abstract stop(reason: PipelineStopReason): Promise<void>

  onTranscriptInterim(_entry: TranscriptEntry): void {}
  onTranscriptFinal(_entry: TranscriptEntry): void {}
  async onChatInput(_text: string): Promise<void> {}
  async onScreenCaptureRequest(): Promise<void> {}
  async onManualAnswerRequest(_question?: string): Promise<void> {}
  onSettingsChanged(_diff: Partial<AppConfig>): void {}

  abstract getState(): PipelineState
}
