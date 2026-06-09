You are working in the Whisphry Electron + React + TypeScript codebase.

Goal:
Remove Gemini Live / direct Gemini API live-agent behavior and replace it with a simpler OpenRouter + Deepgram Aura companion voice pipeline.

Product rules:
- OpenRouter remains the only LLM reasoning/generation provider.
- Deepgram Aura is used only for text-to-speech audio output.
- TTS must only work in Companion mode.
- TTS must be disabled in Interview mode and Presentation mode.
- Do not add voice output to interview or presentation workflows.
- Keep existing Deepgram STT/transcription behavior unchanged.
- Do not remove OpenRouter answer generation.
- Do not remove existing script player / presentation script tracking.

Architecture target:
User/context trigger
→ OpenRouter streamed chat completion
→ phrase chunker
→ Deepgram Aura streaming TTS WebSocket
→ audio queue/player
→ companion voice output only

OpenRouter requirements:
- Use POST https://openrouter.ai/api/v1/chat/completions
- Headers:
  - Authorization: Bearer <OPENROUTER_API_KEY>
  - Content-Type: application/json
  - HTTP-Referer and X-OpenRouter-Title if already used in the app
- Request body must support:
  - model
  - messages
  - stream: true
  - temperature/max_tokens if existing app settings already support them
- Parse Server-Sent Events.
- Ignore SSE comment lines beginning with ":" such as ": OPENROUTER PROCESSING".
- Parse `data:` JSON chunks.
- Extract streamed text from `choices[].delta.content`.
- Detect `[DONE]`.
- Handle OpenRouter stream errors, including mid-stream JSON error objects where `finish_reason` may be `"error"`.
- Expose an abort/cancel mechanism using AbortController.

Deepgram Aura WebSocket requirements:
- Use the existing Deepgram API key from settings.
- Prefer the official `@deepgram/sdk` if it already exists in dependencies; otherwise use a WebSocket implementation compatible with Electron main process.
- Create a new service, for example:
  - `CompanionVoiceService`
  - or `DeepgramAuraTTSService`
- Connect using Aura streaming TTS.
- Default voice/model:
  - `aura-2-thalia-en`
- Default audio:
  - `encoding: "linear16"`
  - `sample_rate: 48000`
- Use one WebSocket per companion conversation/session.
- Do not change model/voice/sample_rate after connection.
- Reconnect only by closing and creating a new socket.
- Send text chunks as:
  - `{ "type": "Speak", "text": "<chunk>" }`
- Send:
  - `{ "type": "Flush" }`
  when a chunk should be synthesized.
- Send:
  - `{ "type": "Close" }`
  when ending companion voice mode/session.
- Respect Deepgram limits:
  - max 2000 chars per text payload
  - 2400 chars per minute throughput
  - max 20 Flush messages per 60 seconds
  - 60-minute active WebSocket timeout
- Add guardrails so chunks are well below 2000 chars.
- Rate-limit flushes so we do not exceed Deepgram flush limits.
- On interruption/cancel, stop playback immediately, clear pending audio queue, and close/restart the TTS socket if needed.

Chunking requirements:
- Do not send every token to TTS.
- Buffer OpenRouter streamed tokens into speakable phrase chunks.
- Flush when one of these is true:
  - sentence-ending punctuation: `.`, `?`, `!`
  - comma/semicolon/colon after at least 8 words
  - buffer reaches around 12–18 words
  - stream finishes
- Avoid chunks shorter than 3 words unless stream ended.
- Strip markdown formatting that sounds bad in speech:
  - backticks
  - markdown headings
  - bullet markers
  - raw URLs unless explicitly needed
  - excessive emoji
- Preserve natural pauses by converting some punctuation to readable spacing, but do not use SSML unless Deepgram docs/support in this project already require it.
- For companion voice, responses should be conversational and concise.

Audio playback requirements:
- Implement audio playback from streamed Deepgram audio bytes.
- Use Electron main-process safe playback strategy suitable for the current app architecture.
- Prefer sending audio chunks to the Canvas window or an existing audio playback surface if the app already has one.
- Queue audio chunks and play continuously.
- Avoid writing temporary audio files.
- Playback must be interruptible.
- Add `startVoiceResponse`, `stopVoiceResponse`, and `clearVoiceQueue` style methods.
- Do not block UI while audio is generating or playing.

Mode gating:
- Add or reuse mode detection:
  - Companion mode: TTS allowed if setting enabled.
  - Interview mode: TTS always disabled.
  - Presentation mode: TTS always disabled.
- Add setting:
  - `companionVoiceEnabled: boolean`
  - `companionVoiceModel: string` default `aura-2-thalia-en`
  - optional `companionVoiceSampleRate: number` default `48000`
- Settings UI should make clear:
  - “Voice output is only used in Companion mode.”
- Remove Gemini Live API key requirement from settings if it only exists for live agent.
- Remove Gemini Live toggles/tooling if no longer used.
- Update README references from Gemini Live to OpenRouter + optional Deepgram Aura companion voice.

Implementation plan:
1. Search the codebase for Gemini Live:
   - `GeminiLiveService`
   - `gemini`
   - `GEMINI_API_KEY`
   - live-agent toggles
   - Gemini audio playback
2. Remove or disable Gemini Live service paths cleanly.
3. Keep non-Gemini tools/memory/screen-analysis behavior intact.
4. Implement OpenRouter streaming helper if not already present:
   - `streamOpenRouterChatCompletion(messages, options, onToken, signal)`
5. Implement chunker:
   - `StreamingSpeechChunker`
   - accepts tokens
   - emits speakable chunks
   - flushes final chunk
6. Implement Deepgram Aura TTS service:
   - connect
   - speak(chunk)
   - flush
   - close
   - interrupt
   - rate-limit flushes
7. Wire companion response flow:
   - OpenRouter stream tokens
   - text still appears in UI normally
   - chunker sends voice chunks to Deepgram only in Companion mode
   - playback starts as soon as first audio chunk arrives
8. Add robust error handling:
   - missing Deepgram key
   - socket failure
   - OpenRouter stream error
   - audio playback failure
   - cancellation/interruption
9. Add logging with safe redaction:
   - never log API keys
   - log provider, mode, chunk lengths, flush count, socket state
10. Update README and settings labels.

Acceptance criteria:
- In Companion mode, when voice is enabled, Whisphry speaks the assistant response while OpenRouter is still streaming text.
- First audio starts before the full LLM answer completes.
- If user interrupts or asks a new question, current speech stops immediately.
- In Interview mode, no TTS audio plays.
- In Presentation mode, no TTS audio plays.
- Existing transcription/session capture remains unchanged.
- Existing OpenRouter text answer flow still works.
- Gemini Live is no longer required or exposed in settings.
- No API keys are logged.
- Deepgram WebSocket is closed cleanly on session end/app exit.