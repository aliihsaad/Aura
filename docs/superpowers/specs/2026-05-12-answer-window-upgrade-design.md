# Answer Window Upgrade — rich result viewer for Companion mode

**Date:** 2026-05-12
**Status:** shipped 2026-05-12
**Context:** Workspace mode was removed (commit 42b7133); the answer window is a leftover from the interview-assistant era ("here's your structured answer"). For Companion mode, bubbles are the conversational surface; the answer window is the "I have something longer to say" overflow. This upgrade gives it a clear post-Workspace identity: a **rich result/document viewer** — the place the agent puts longer-form, link-heavy, image-heavy, structured content that won't fit in a bubble. Read-mostly, but capable.

Original baseline before this upgrade: a `view=answer` instance of the overlay renderer (`src/renderer/overlay/App.tsx`) showed `currentAnswer` through `src/renderer/overlay/components/markdown-renderer.tsx` — a hand-rolled parser that handled headings/bold/italic/inline-code/lists and nothing else (no links, no images). It had tabs (answer/queue/notes/companion) and font-size controls. The same `markdown-renderer.tsx` was also used by the canvas bubbles and the file-preview window.

---

## Goals

1. **Rich rendering** — clickable links (open in default browser), inline images (from markdown `![]()` and from tool output), web-search source cards, GFM tables.
2. **Read-aloud** — a play/stop button that speaks the content through the existing Deepgram Aura pipeline, regardless of which agent mode is active.
3. **Window-content awareness** — when the window is open, the agent treats follow-ups ("explain step 2", "shorten that") as referring to what's displayed there. (Mostly already wired via the ConversationLog; one small addition.)
4. **Rename** — "answer window" → **"Detail"** (working name; user may change). Only affects internal labels — the window itself is frameless/titleless.

## Non-goals (declined during brainstorming)

- Sandboxed HTML/SVG fenced blocks the agent can emit.
- Interactive widgets / micro-apps in the window.
- Sentence-highlight-while-speaking (Aura gives no per-word timing; the estimate would drift).
- Playback speed / skip controls.
- Full screen-activity inference ("the agent watches my screen and figures out what I'm doing") — that's the session-brain, which already exists and is out of scope here.
- An inline reply box / making this a second conversation surface — the window role is read-mostly viewer.
- Cross-session persistence of viewed content.

---

## Architecture

### Rendering core — `RichContent`

New component `src/renderer/overlay/components/RichContent.tsx` built on **`react-markdown` + `remark-gfm` + `rehype-sanitize`**. `react-markdown` does not render raw HTML by default and (v9+) applies a `urlTransform` that blocks `javascript:` etc.; `rehype-sanitize` enforces a strict element/attribute allowlist on top (no `<script>`, no inline event handlers). We keep `rehype-sanitize`'s defaults — markdown `data:` images stay blocked; generated images do not flow through markdown at all, they render via the `attachments` path (our own React component). Net: URL/HTML safety is library-provided, not hand-rolled.

Custom element overrides:
- `<a>` — intercepts the click, calls `window.api.openExternal(href)` (the renderer is sandboxed and cannot open browsers directly; the main process uses `shell.openExternal`). Visual: cyan text, underline on hover, trailing ↗ glyph. External-only — no in-app navigation.
- `<img>` — `loading="lazy"`; `onError` swaps to a fallback chip: "🖼 image unavailable — {url}" where the url is itself a clickable link. Max width 100% of the content column; click → open full-size in browser.

Props:
- `compact?: boolean` — disables images, tables, and source cards; used by bubbles so they stay terse one-liners.
- `attachments?: AnswerAttachment[]` — structured extras (web sources, generated images) rendered as cards/inline images **below** the prose (see Data Flow).
- (existing) `fontSize`, content string.

`src/renderer/overlay/components/markdown-renderer.tsx` becomes a thin shim: `export default (props) => <RichContent compact {...props} />`. This keeps the bubble and file-preview call sites nearly unchanged. **The file-preview window switches to the full (non-compact) renderer** — `.md` previews gain clickable links, inline images, and tables, which is strictly an improvement.

New component `src/renderer/overlay/components/SourceCard.tsx` (or inline in `RichContent`) — renders one web-source: favicon (`https://www.google.com/s2/favicons?domain={domain}`), title, domain, opens the URL in the browser on click. A row/grid of these renders when `attachments` contains `web-source` entries.

### Data flow — web sources & generated images (structured, not syntax)

The agent keeps writing plain markdown answers; it is **not** taught special fences. Instead the **answer pipeline captures tool results during a generation** and attaches them to the answer-done payload:

- During an answer stream (between `beginAnswerStream` and `completeAnswerStream`), if the tool executor runs `search_web`, its results are accumulated. On answer-done, they become `attachments: [{ type:'web-source', url, title, domain }]`, deduped by URL, capped at ~6 cards.
- If `generate_image` ran during the stream, the saved artifact's bytes are read back and base64-encoded into a **data URL**, attached as `{ type:'image', src: dataUrl, caption? }`. Data URL (not `file://` or a custom protocol) keeps the image inside the content-protected window with zero protocol-registration work; a single generated image is a few hundred KB, acceptable in the IPC payload.
- The capture boundary is the answer stream's begin→done, so cards/images only show for tool calls that belong to *this* answer.

`src/shared/types.ts` gains:
```ts
type AnswerAttachment =
  | { type: 'web-source'; url: string; title: string; domain: string }
  | { type: 'image'; src: string; caption?: string }
```
The `onAnswerDone` / answer-stream-done payload extends from `string` to `{ text: string; attachments?: AnswerAttachment[] }`. A back-compat shim accepts a bare string from any caller not yet updated.

### Read-aloud

Header control on the answer view: `▶ Read aloud` ↔ `■ Stop`.
- Click → `window.api.speakAnswer(text)` → main process: run the text through a **markdown → plaintext** pass (strip `# * _ > ~` `[]()` etc. — reuse/extend `cleanSpokenText` from `companion-tts-service.ts` or a small new util), then feed it to a `CompanionTtsService` via a path that **ignores the Companion-voice toggle** (the current `ensureCompanionTtsService()` returns null when `!voiceOutputEnabled()`; add an explicit-action entry that does not check the toggle, reusing the same singleton + voice model). PCM streams over the existing `voice:audio-chunk` events the canvas/overlay already play. `beginTurn()` already stops any in-flight TTS, so this can't collide with a bubble being auto-spoken (one TTS stream at a time).
- The window listens for `voice:audio-end` and flips the button back to `▶`.
- `window.api.stopSpeakingAnswer()` → `companionTtsService?.stop()`.
- No Deepgram key configured → toast "Add a Deepgram key in Settings to use read-aloud" (reuse the existing toast system); button does nothing.

### Window-content awareness

Already mostly done: `completeAnswerStream` appends `{ role:'agent', source:'answer-window', text }` to the ConversationLog the heartbeat reads (shipped in the conversation-memory work), so follow-ups already see the last answer-window output. One small addition: when the answer window is **visible**, `HeartbeatService.buildContextSnapshot` adds one line — "The user currently has the detail window open showing your last answer." — so the agent treats "explain step 2" / "shorten that" as referring to it. New heartbeat dep: `isAnswerWindowVisible: () => boolean` (wired in `ipc-handlers.ts` from `getAnswerWindow()?.isVisible()`). That is the entire "agent knows what I'm doing" scope here.

---

## Files touched

**New:**
- `src/renderer/overlay/components/RichContent.tsx`
- `src/renderer/overlay/components/SourceCard.tsx`
- (maybe) `src/main/services/markdown-plaintext.ts` — markdown→plaintext for TTS, if not folded into `companion-tts-service.ts`
- (maybe) `scripts/check-rich-content.mjs` — verification for the markdown→plaintext + source-dedup logic (codebase convention is `check-*.mjs`, not a test runner)

**Modified:**
- `src/renderer/overlay/components/markdown-renderer.tsx` → thin `<RichContent compact />` shim
- `src/renderer/overlay/App.tsx` → answer view uses `RichContent` (full), adds the read-aloud button, renders `attachments`, listens for `voice:audio-end`; file-preview view uses `RichContent` (full)
- `src/renderer/canvas/components/Bubble.tsx` → renders via `<RichContent compact />`
- `src/preload/index.ts` → `+ openExternal(url)`, `speakAnswer(text)`, `stopSpeakingAnswer()`
- `src/main/ipc-handlers.ts` → handlers for the above; capture `search_web` / `generate_image` results into the answer-done payload; explicit (toggle-independent) TTS path; `isAnswerWindowVisible` wiring; markdown→plaintext call
- `src/main/services/agent/heartbeat-service.ts` → `+ isAnswerWindowVisible` dep, one line in `buildContextSnapshot`
- `src/main/services/agent/companion-tts-service.ts` → small change to support the explicit (toggle-independent) entry, and/or export the markdown→plaintext helper
- `src/shared/types.ts` → `AnswerAttachment` (+ `WebSource` shape), extended answer-done payload type
- `package.json` → add `react-markdown`, `remark-gfm`, `rehype-sanitize`
- Internal labels: dropdown menu item, window header text — "Answers" → "Detail" (working name)

## Error handling

- Broken image URL → fallback chip with the URL as a clickable link.
- `shell.openExternal` failure → log only; links are non-critical.
- TTS failure → button flips back to `▶`, toast "couldn't read aloud".
- No Deepgram key on read-aloud → toast pointing to Settings; no-op otherwise.
- Malformed/oversized markdown → `react-markdown` degrades gracefully; `rehype-sanitize` strips anything dangerous. No content-length cap (answers aren't that long).
- Tool-result capture finds nothing → `attachments` omitted; renderer shows prose only (current behavior).

## Testing

- The codebase uses `scripts/check-*.mjs` verification scripts, not a test runner. Add `scripts/check-rich-content.mjs` covering: markdown→plaintext strips formatting correctly (and leaves URLs/words intact for speech), web-source dedup-by-URL + cap.
- `npm run build` green.
- Manual smoke (running app, Companion mode): open the detail window on content that has a markdown link + a markdown image + follows a `search_web` call → link opens in browser, image renders inline, source cards appear; trigger `generate_image` → generated image shows inline; click "Read aloud" → Aura speaks the plaintext, click "Stop" → halts; confirm bubbles still render as terse one-liners with no inline images/cards; preview a `.md` file with links/images/a table → all render.

## Open items folded into the plan

- Working name "Detail" — user may swap it during spec review or implementation; it's a string, not load-bearing.
- Exact home of the markdown→plaintext helper (its own file vs inside `companion-tts-service.ts`) — pick the simpler one during implementation.
