/**
 * Public surface of the pipelines/ package.
 *
 * One product mode: Companion (classic + realtime-beta engines).
 * Session mode was removed in the Aura fork; Workspace was removed
 * 2026-05-11 (see vault vm_UyUOIsvmCmZBz6AU).
 *
 * ipc-handlers (which owns the singleton dependencies) calls
 * `configurePipelineFactory()` at boot, passing the companion builders.
 */

import type { AgentMode } from '@shared/types'
import { ModeRouter, type PipelineFactory } from './mode-router'
import type { Pipeline } from './pipeline'
import { CompanionPipeline, type CompanionPipelineDeps } from './companion-pipeline'
import {
  CompanionRealtimePipeline,
  type CompanionRealtimePipelineDeps,
} from './companion-realtime-pipeline'

export { ModeRouter, type PipelineFactory } from './mode-router'
export {
  BasePipeline,
  type Pipeline,
  type PipelineStartContext,
  type PipelineState,
  type PipelineStopReason,
} from './pipeline'
export { CompanionPipeline, type CompanionPipelineDeps } from './companion-pipeline'
export {
  CompanionRealtimePipeline,
  type CompanionRealtimePipelineDeps,
} from './companion-realtime-pipeline'

export interface PipelineBuilders {
  /** Companion owns text + optional voice through its voiceEnabled config flag. */
  companion?: () => CompanionPipelineDeps
  companionEngine: () => 'classic' | 'realtime-beta'
  companionRealtime?: () => CompanionRealtimePipelineDeps
}

let activeBuilders: Partial<PipelineBuilders> = {}

const factory: PipelineFactory = (mode: AgentMode): Pipeline | null => {
  if (mode === 'companion') {
    if (
      activeBuilders.companionEngine?.() === 'realtime-beta' &&
      activeBuilders.companionRealtime
    ) {
      return new CompanionRealtimePipeline(activeBuilders.companionRealtime())
    }
    if (activeBuilders.companion) {
      return new CompanionPipeline(activeBuilders.companion())
    }
  }
  return null
}

let singleton: ModeRouter | null = null

export function getModeRouter(): ModeRouter {
  if (!singleton) {
    singleton = new ModeRouter({ pipelineFactory: factory })
  }
  return singleton
}

/**
 * Register per-mode dependency builders. Call once at app startup from
 * the module that owns the singletons (today: ipc-handlers).
 */
export function configurePipelineFactory(builders: PipelineBuilders): void {
  activeBuilders = builders
}

export function setModeRouter(router: ModeRouter | null): void {
  singleton = router
}
