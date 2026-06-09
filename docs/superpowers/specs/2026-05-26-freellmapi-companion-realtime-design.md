# FreeLLMAPI Companion Provider and Realtime Beta Design

**Date:** 2026-05-26
**Status:** draft for review

## Goal

Add FreeLLMAPI support to Whisphry without breaking the current working companion setup.

The current companion path remains the default:

```text
Deepgram STT -> OpenRouter chat/heartbeat -> selected TTS -> canvas playback
```

The new work adds two opt-in capabilities beside that path:

1. FreeLLMAPI as the primary OpenAI-compatible chat endpoint, with OpenRouter fallback.
2. A beta realtime companion engine that uses FreeLLMAPI's Gemini Live session minting endpoint and a dedicated realtime pipeline.

The implementation should be additive and reversible. If FreeLLMAPI is not configured, down, out of quota, or rejected by a provider, Whisphry should keep using the existing OpenRouter/Deepgram path.

## Product Shape

Do not add a third top-level app mode. Keep the existing modes:

- `Interview`
- `Companion`

Inside Companion settings, add an advanced companion engine/provider choice:

- `Classic` - current stable behavior.
- `Realtime Beta` - new FreeLLMAPI/Gemini Live path.

Classic remains the default. Realtime Beta is explicit opt-in.

The FreeLLMAPI chat fallback can be enabled separately from Realtime Beta. This lets the user reduce OpenRouter usage for normal companion responses without taking on the realtime architecture risk.

## Non-Goals

- Do not replace the existing `CompanionPipeline`.
- Do not make realtime the default companion engine.
- Do not remove Deepgram STT, Deepgram TTS, or OpenRouter.
- Do not silently switch between realtime and classic mid-sentence.
- Do not promise unlimited free usage. FreeLLMAPI can route to free-tier or free providers, but provider quotas and keys still apply.
- Do not revive older Gemini Live plans as a broad latency rewrite. This is a new, explicit beta engine requested for FreeLLMAPI integration.

## Configuration

Add FreeLLMAPI configuration without disturbing existing OpenRouter keys:

- `freeLlmApiBaseUrl`, defaulting to `http://localhost:3001/v1`.
- `freeLlmApiKey`, stored like other sensitive provider keys.
- `companionLlmProvider: 'openrouter' | 'freellmapi-first'`.
- `companionEngine: 'classic' | 'realtime-beta'`.
- Optional realtime settings:
  - model, defaulting to FreeLLMAPI/provider auto routing where possible.
  - voice name.
  - input transcription enabled.
  - output transcription enabled.

The initial UI should keep this compact. The advanced settings can expose base URL and key. The normal Companion setup can show only the engine choice and whether FreeLLMAPI is configured.

## Track A: FreeLLMAPI Primary Chat With OpenRouter Fallback

This track keeps the current companion pipeline intact.

Instead of hard-coding every chat request to OpenRouter, introduce an LLM provider configuration layer around the existing `LLMService` call sites. The service should be able to call:

```text
primary:  FreeLLMAPI /v1/chat/completions
fallback: OpenRouter /api/v1/chat/completions
```

Fallback rules:

- If FreeLLMAPI is not configured, use OpenRouter directly.
- If FreeLLMAPI returns authentication, routing, quota, timeout, or 5xx errors, retry through OpenRouter.
- If FreeLLMAPI returns a clean model response, do not call OpenRouter.
- Preserve existing OpenRouter behavior for Interview mode unless explicitly enabled later.

Important compatibility checks:

- Streaming SSE shape.
- Tool-calling support, where used.
- Vision/screenshot support, where used.
- Usage accounting, which may be absent or different from OpenRouter.

The first implementation should tolerate missing usage chunks instead of treating them as fatal.

## Track B: FreeLLMAPI TTS Provider

Add FreeLLMAPI as an optional TTS output provider after the chat fallback path is stable.

Expected route:

```text
POST {freeLlmApiBaseUrl}/audio/speech
```

Use `response_format: "pcm"` where possible so the response can feed the existing PCM playback path. The provider should implement the same local AI TTS provider contract as the existing Deepgram/system providers.

Fallback rules:

- If FreeLLMAPI TTS is not configured or fails, fall back to the selected existing TTS provider when allowed.
- If the user selected `disabled`, do not speak.
- Do not require FreeLLMAPI TTS for FreeLLMAPI chat.

## Track C: Companion Realtime Beta

Realtime Beta gets a dedicated pipeline:

```text
CompanionRealtimePipeline
```

This pipeline is selected only when:

- `agentMode` is `companion`.
- `companionEngine` is `realtime-beta`.
- FreeLLMAPI base URL and key are configured or local trusted access is available.

The current `CompanionPipeline` remains the Classic engine.

Realtime session flow:

1. Session start validates FreeLLMAPI realtime availability.
2. Main process requests `POST /v1/realtime/sessions`.
3. FreeLLMAPI returns an ephemeral client secret and constrained `connect_url`.
4. Whisphry opens the returned WebSocket.
5. Whisphry sends setup and 16 kHz PCM audio chunks.
6. Whisphry receives model audio chunks, input transcripts, output transcripts, and turn-complete signals.
7. Output audio is forwarded through the existing `voice:audio-chunk` IPC path.
8. Transcripts are persisted into the same session artifacts where practical.
9. Session stop closes the WebSocket, audio capture, and playback cleanly.

The realtime path should share only stable boundaries with the classic path:

- audio capture input
- voice audio output IPC
- session lifecycle status
- conversation/session persistence
- telemetry/logging conventions

It should not force the classic STT -> LLM -> TTS loop to understand Gemini Live internals.

## Realtime Fallback Behavior

Before connect:

- If `/v1/realtime/sessions` fails, show a clear status and fall back to Classic Companion when OpenRouter/Deepgram are configured.

After connect:

- If the WebSocket drops mid-session, stop realtime cleanly and show a status.
- Do not silently continue the same utterance through Classic Companion.
- A later enhancement can add explicit "resume in Classic" handoff with summarized context.

This boundary keeps behavior understandable and avoids partial duplicated replies.

## Audio and Transcript Handling

The renderer already captures 16 kHz PCM audio for the current STT path. Realtime Beta should reuse that capture format.

Expected realtime audio handling:

- input: 16-bit PCM, 16 kHz
- output: 16-bit PCM, provider sample rate declared in the emitted MIME string, commonly 24 kHz

The existing canvas/overlay audio player can already consume PCM chunks when the sample rate is declared. Realtime Beta should emit chunks in the same shape as the current voice output path.

Input and output transcriptions should be captured when available:

- input transcript: what the user said
- output transcript: what the model said

Those should feed session persistence and conversation memory in a way that does not duplicate or corrupt the classic transcript entries.

## UI and Status

Settings should make the beta nature explicit but not noisy:

- Companion engine: `Classic` or `Realtime Beta`.
- FreeLLMAPI connection status: configured, missing key, unreachable, or healthy.
- Realtime status during session: connecting, live, reconnect unavailable, failed, stopped.

Avoid adding a landing page or explanatory in-app copy. The UI should expose the choice and current status, not teach the architecture.

## Error Handling

FreeLLMAPI chat:

- Authentication/routing/quota/provider errors trigger OpenRouter fallback.
- Missing FreeLLMAPI config uses OpenRouter directly.
- Missing OpenRouter fallback should produce the existing clear "API key not configured" style error.

FreeLLMAPI TTS:

- Failure should not fail the session.
- Log and surface concise speech-output status.

Realtime Beta:

- Missing FreeLLMAPI config blocks realtime start and offers Classic fallback.
- Session-token failure falls back before connect.
- WebSocket failure after connect stops realtime and preserves session artifacts.
- Stop/pause must close audio capture, WebSocket, pending playback, and listeners.

## Files Likely Touched

Expected shared/config files:

- `src/shared/types.ts`
- `src/shared/local-ai-types.ts`
- `src/shared/constants.ts`

Expected main-process files:

- `src/main/services/llm-service.ts`
- `src/main/pipelines/companion-pipeline.ts`
- `src/main/pipelines/index.ts`
- `src/main/pipelines/pipeline.ts`
- `src/main/services/session-runtime-service.ts`
- `src/main/services/session-runtime-store.ts`
- `src/main/ipc-handlers.ts`
- new `src/main/pipelines/companion-realtime-pipeline.ts`
- new realtime client/service module, likely under `src/main/services/realtime/`
- new FreeLLMAPI TTS provider, likely under `src/main/services/local-ai/providers/`

Expected renderer/preload files:

- `src/preload/index.ts`
- `src/renderer/overlay/components/setup/CompanionSetup.tsx`
- possible settings/local-AI UI files after source inspection

Expected verification scripts:

- new `scripts/check-freellmapi-provider-config.mjs`
- new `scripts/check-companion-realtime-pipeline.mjs`

Exact file list should be finalized during the implementation plan after another source pass.

## Testing and Guardrails

Add focused `scripts/check-*.mjs` guardrails before or alongside implementation.

Minimum checks:

- Classic Companion remains the default.
- Existing `CompanionPipeline` is still selectable and not replaced.
- FreeLLMAPI config does not remove OpenRouter config.
- Companion session start no longer requires OpenRouter when FreeLLMAPI chat is configured and selected.
- Interview mode still uses existing behavior.
- Realtime Beta has its own pipeline file and selection branch.
- Realtime Beta is gated behind Companion mode and explicit engine selection.
- Realtime failure before connect falls back to Classic only when Classic dependencies are configured.
- Realtime failure after connect does not silently duplicate a response through Classic.

Build verification:

```bash
npm run build
```

Existing repo guardrails should keep running as part of release checks. If any older guardrail assumes OpenRouter is always required for every session, update it to distinguish Classic/OpenRouter from FreeLLMAPI-first Companion.

## Rollout Plan

Implement in phases:

1. FreeLLMAPI config and OpenAI-compatible chat fallback.
2. FreeLLMAPI TTS provider.
3. Realtime Beta pipeline skeleton and session selection.
4. Realtime WebSocket audio/transcript loop.
5. Persistence, telemetry, and manual smoke testing.

Each phase should keep Classic Companion green before moving to the next.

## Review Decision

This spec chooses the conservative architecture:

- current Companion stays stable and default
- FreeLLMAPI chat is added as a provider/fallback layer
- FreeLLMAPI TTS is added as an optional speech provider
- realtime voice is isolated in a beta pipeline

Implementation should not begin until this design is approved and converted into a detailed implementation plan.
