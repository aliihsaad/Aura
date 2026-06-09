/**
 * Re-export shim — Phase 4 of the mode-isolation refactor.
 *
 * The wizard moved into `setup/` and was split into a shell plus
 * one component per agent mode. This file keeps the old import path
 * alive so `App.tsx` and any other consumers don't churn.
 */

export { default } from './setup/SessionSetup'
