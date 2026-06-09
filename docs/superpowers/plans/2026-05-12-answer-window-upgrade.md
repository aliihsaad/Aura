# Answer Window Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note on commits:** the user's standing rule is "only commit when asked". The commit steps below are the intended git hygiene — confirm with the user before the first commit of an execution session, then follow through.

**Goal:** Turn the Companion-mode "answer window" into a rich result viewer — clickable links, inline images, web-search source cards, a read-aloud button — and rename it to "Detail".

**Architecture:** Replace the hand-rolled `markdown-renderer.tsx` with a `RichContent` component built on `react-markdown` + `remark-gfm` + `rehype-sanitize` (custom `<a>`/`<img>` renderers; `compact` prop for bubbles). Web sources and generated images are captured from `search_web` / `generate_image` tool results *during* an answer stream and shipped on the answer-done payload as structured `attachments` (no special syntax for the agent). Read-aloud reuses the existing Deepgram Aura TTS pipeline via a toggle-independent path. The agent already sees the last answer-window output via the ConversationLog; one extra heartbeat-snapshot line tells it when the window is visible.

**Tech Stack:** Electron 41, React 19, TypeScript, Tailwind v4, `react-markdown` + `remark-gfm` + `rehype-sanitize`, Deepgram Aura TTS (existing `CompanionTtsService`), the existing `voice:audio-chunk` IPC pipeline.

**Reference spec:** `docs/superpowers/specs/2026-05-12-answer-window-upgrade-design.md`

---

## File Structure

**New:**
- `src/renderer/overlay/components/RichContent.tsx` — markdown renderer (react-markdown + plugins, custom `<a>`/`<img>`, `compact` prop, `attachments` prop). One responsibility: render agent/markdown content richly and safely.
- `src/renderer/overlay/components/SourceCard.tsx` — one web-source card (favicon, title, domain, opens in browser).
- `src/main/services/markdown-plaintext.ts` — strip markdown → plain text for TTS. Pure function.
- `scripts/check-rich-content.mjs` — verification for `markdown-plaintext` + web-source dedup logic.

**Modified:**
- `src/renderer/overlay/components/markdown-renderer.tsx` → thin `<RichContent compact />` shim (keeps bubble call sites unchanged).
- `src/renderer/overlay/App.tsx` — answer view: use `RichContent` (full), render `attachments`, add read-aloud button; preview view: use `RichContent` (full).
- `src/renderer/canvas/components/Bubble.tsx` — render via `<RichContent compact />`.
- `src/renderer/overlay/components/FilePreview.tsx` (if it renders markdown directly) — use `RichContent` (full).
- `src/preload/index.ts` — add `openExternal`, `speakAnswer`, `stopSpeakingAnswer`.
- `src/main/ipc-handlers.ts` — `shell:open-external` handler; capture `search_web`/`generate_image` results into a pending-attachments buffer scoped to the answer stream; change the answer-done IPC payload to `{ text, attachments? }`; explicit (toggle-independent) TTS path; route `voice:audio-end` to the answer window; wire `isAnswerWindowVisible` into the heartbeat; rename internal labels.
- `src/main/services/agent/heartbeat-service.ts` — `isAnswerWindowVisible` dep + one line in `buildContextSnapshot`.
- `src/main/windows.ts` / wherever `sendToAnswer` lives — ensure it's exported/usable for `voice:audio-end`.
- `src/main/services/agent/companion-tts-service.ts` — small change so an explicit "speak this" call works regardless of the Companion-voice toggle.
- `src/renderer/overlay/components/Controls.tsx` — dropdown menu label "Show/Hide Answers" → "Detail".
- `src/shared/types.ts` — `AnswerAttachment` type; extended answer-done payload type.
- `package.json` — `react-markdown`, `remark-gfm`, `rehype-sanitize`.

---

## Task 1: Add deps + attachment types + minimal `RichContent`

**Files:**
- Modify: `package.json`
- Modify: `src/shared/types.ts`
- Create: `src/renderer/overlay/components/RichContent.tsx`

- [ ] **Step 1: Install the libraries**

Run: `npm install react-markdown remark-gfm rehype-sanitize`
Expected: added to `dependencies` in `package.json`, no peer-dep errors (react-markdown 9.x supports React 19).

- [ ] **Step 2: Add the attachment types** (used by RichContent below and by Tasks 6–8)

In `src/shared/types.ts`:

```ts
export type AnswerAttachment =
  | { type: 'web-source'; url: string; title: string; domain: string }
  | { type: 'image'; src: string; caption?: string }

export interface AnswerDonePayload {
  text: string
  attachments?: AnswerAttachment[]
}
```

- [ ] **Step 3: Create the minimal `RichContent` component**

`src/renderer/overlay/components/RichContent.tsx`:

```tsx
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import type { AnswerAttachment } from '@shared/types'

interface RichContentProps {
  content: string
  fontSize?: number
  /** Bubbles use this — disables images, tables, and attachment cards so the
   *  bubble stays a terse one-liner. */
  compact?: boolean
  /** Structured extras (web sources, generated images) rendered below the
   *  prose. Ignored when compact. */
  attachments?: AnswerAttachment[]
}

export default function RichContent({
  content,
  fontSize = 15,
  compact = false,
  attachments,
}: RichContentProps): React.JSX.Element {
  return (
    <div className="rich-content" style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
```

(`compact` and `attachments` are wired in later tasks — accept them now so the prop type is stable.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: green. (Don't wire it into any view yet.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/shared/types.ts src/renderer/overlay/components/RichContent.tsx
git commit -m "feat(answer-window): add react-markdown + RichContent skeleton + attachment types"
```

---

## Task 2: Clickable links via `shell.openExternal`

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add `shell:open-external` handler)
- Modify: `src/preload/index.ts` (add `openExternal`)
- Modify: `src/renderer/overlay/components/RichContent.tsx` (custom `<a>` renderer)
- Modify: `src/shared/ipc-channels.ts` (if channels are centralised there) — add `OPEN_EXTERNAL = 'shell:open-external'`

- [ ] **Step 1: Add the IPC channel constant**

In `src/shared/ipc-channels.ts`, add to the `IPC` object: `OPEN_EXTERNAL: 'shell:open-external'`.

- [ ] **Step 2: Add the main handler**

In `src/main/ipc-handlers.ts`, near the other `ipcMain.handle` calls (e.g. next to the existing `clipboard:write` handler), add:

```ts
ipcMain.handle(IPC.OPEN_EXTERNAL, async (_e, url: string) => {
  // Only allow http(s). Block file:, javascript:, etc.
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
})
```

(`shell` is already imported at the top of `ipc-handlers.ts`: `import { ipcMain, dialog, safeStorage, clipboard, shell } from 'electron'`.)

- [ ] **Step 3: Expose it in the preload**

In `src/preload/index.ts`, add to the `api` object:

```ts
openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
```

and in the `Window['api']` type declaration block: `openExternal: (url: string) => Promise<boolean>`.

- [ ] **Step 4: Add the custom `<a>` renderer in RichContent**

In `RichContent.tsx`, add a `components` map to `<ReactMarkdown>`:

```tsx
import { ExternalLink } from 'lucide-react'
// ...
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSanitize]}
  components={{
    a: ({ href, children }) => {
      const url = typeof href === 'string' ? href : ''
      if (!url || !/^https?:\/\//i.test(url)) {
        return <span>{children}</span>
      }
      return (
        <a
          href={url}
          onClick={(e) => {
            e.preventDefault()
            void window.api.openExternal(url)
          }}
          className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-400/40 hover:decoration-cyan-300 cursor-pointer inline-flex items-baseline gap-0.5"
        >
          {children}
          <ExternalLink size={11} className="opacity-60 translate-y-px" />
        </a>
      )
    },
  }}
>
  {content}
</ReactMarkdown>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc-handlers.ts src/preload/index.ts src/renderer/overlay/components/RichContent.tsx
git commit -m "feat(answer-window): clickable links open in the default browser"
```

---

## Task 3: Inline images with broken-image fallback

**Files:**
- Modify: `src/renderer/overlay/components/RichContent.tsx`

- [ ] **Step 1: Add the custom `<img>` renderer**

In `RichContent.tsx`'s `components` map, add an `img` entry. It uses a local state hook per image, so extract a small subcomponent:

```tsx
import { useState } from 'react'
import { ImageOff } from 'lucide-react'

function MarkdownImage({ src, alt }: { src?: string; alt?: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const url = typeof src === 'string' ? src : ''
  if (!url || broken) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[12px] text-white/50">
        <ImageOff size={13} />
        image unavailable
        {url && /^https?:\/\//i.test(url) && (
          <a
            href={url}
            onClick={(e) => { e.preventDefault(); void window.api.openExternal(url) }}
            className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
          >
            {url.length > 60 ? url.slice(0, 57) + '…' : url}
          </a>
        )}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setBroken(true)}
      onClick={() => { if (/^https?:\/\//i.test(url)) void window.api.openExternal(url) }}
      className="max-w-full rounded-lg my-2 border border-white/10 cursor-zoom-in"
    />
  )
}
```

Then in the `components` map: `img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />`. (Compact mode hiding images is handled in Task 4 via `disallowedElements` — leave this unconditional for now.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/overlay/components/RichContent.tsx
git commit -m "feat(answer-window): inline images with broken-image fallback"
```

---

## Task 4: `compact` mode + make `markdown-renderer.tsx` a shim + preview uses full

**Files:**
- Modify: `src/renderer/overlay/components/RichContent.tsx` (compact disables tables too)
- Modify: `src/renderer/overlay/components/markdown-renderer.tsx` (→ shim)
- Modify: `src/renderer/overlay/components/FilePreview.tsx` (use RichContent full — if it currently uses `markdown-renderer` directly)
- Modify: `src/renderer/canvas/components/Bubble.tsx` (use RichContent compact — if it uses `markdown-renderer`)

- [ ] **Step 1: Check current `markdown-renderer.tsx` props + call sites**

Run: `grep -rn "markdown-renderer\|MarkdownRenderer\|markdown-renderer.tsx" src/renderer`
Note the prop names the existing component takes (likely something like `content` / `text` and `fontSize`). RichContent must accept the same prop name(s) — adjust `RichContentProps` if needed so the shim is a drop-in.

- [ ] **Step 2: In RichContent, disable images + tables when `compact`**

Use `disallowedElements` + `unwrapDisallowed` as the single source of truth — when compact, `img` and `table` are dropped (their text content survives via `unwrapDisallowed`, so a bubble that mentions an image still reads fine). Update the `<ReactMarkdown>` call:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSanitize]}
  disallowedElements={compact ? ['img', 'table'] : []}
  unwrapDisallowed
  components={{
    a: ({ href, children }) => { /* ...the link renderer from Task 2... */ },
    img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
  }}
>
  {content}
</ReactMarkdown>
```

Remove the `compact ? () => <></> : ...` branch from `components.img` that Task 3 added — `disallowedElements` now handles the compact case, so `img` can unconditionally point at `MarkdownImage`.

- [ ] **Step 3: Rewrite `markdown-renderer.tsx` as a shim**

Replace the entire file `src/renderer/overlay/components/markdown-renderer.tsx` with:

```tsx
import React from 'react'
import RichContent from './RichContent'

// Back-compat shim: existing call sites (bubbles) used this component for
// terse inline-formatted text. They now route through RichContent in compact
// mode (no images, no tables, no attachment cards).
export default function MarkdownRenderer(
  props: { content: string; fontSize?: number }
): React.JSX.Element {
  return <RichContent compact content={props.content} fontSize={props.fontSize} />
}
```

(If the existing component's prop is named `text` not `content`, accept both: `content={props.content ?? (props as any).text}`.)

- [ ] **Step 4: Point FilePreview and the answer view at the *full* renderer**

Wherever the file-preview window renders markdown (`FilePreview.tsx` and/or the `view=preview` branch of `overlay/App.tsx`), replace `<MarkdownRenderer ... />` with `<RichContent content={...} fontSize={...} />` (no `compact`). Bubbles (`Bubble.tsx`) keep using `<MarkdownRenderer />` (the compact shim) — no change needed there beyond confirming the import still resolves.

- [ ] **Step 5: Build + manual check**

Run: `npm run build` → green.
Manual (`npm run dev`): drop a `.md` file with a link, an image, and a table into the preview window → all render rich. Trigger a Companion bubble → still a terse one-liner, no inline image even if the text contains one.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/overlay/components/RichContent.tsx src/renderer/overlay/components/markdown-renderer.tsx src/renderer/overlay/components/FilePreview.tsx src/renderer/overlay/App.tsx src/renderer/canvas/components/Bubble.tsx
git commit -m "feat(answer-window): compact mode; preview uses rich renderer; bubbles stay terse"
```

---

## Task 5: Render the answer view through `RichContent`

**Files:**
- Modify: `src/renderer/overlay/App.tsx` (the `view=answer` branch)

- [ ] **Step 1: Find where `currentAnswer` is rendered**

Run: `grep -n "currentAnswer" src/renderer/overlay/App.tsx`
Locate the JSX in the answer view that renders `currentAnswer` (currently via the old markdown renderer or raw).

- [ ] **Step 2: Render via RichContent**

Replace that JSX with `<RichContent content={currentAnswer} fontSize={answerFontSize} />` (use whatever the existing answer-font-size state variable is called; `grep -n "FontSize" src/renderer/overlay/App.tsx` if unsure). Keep the existing scroll container / header chrome.

- [ ] **Step 3: Build + manual check**

Run: `npm run build` → green.
Manual: trigger an answer-window output containing a markdown link and image → renders rich, link opens browser.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/overlay/App.tsx
git commit -m "feat(answer-window): render answer content via RichContent"
```

---

## Task 6: Capture `search_web` results onto the answer-done payload

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/renderer/overlay/App.tsx` (answer-done handler accepts `{ text, attachments }`)
- Modify: `src/preload/index.ts` (the `onAnswerDone` callback type)

(`AnswerAttachment` / `AnswerDonePayload` were already added to `src/shared/types.ts` in Task 1 — import them where needed.)

- [ ] **Step 1: Add a pending-attachments buffer scoped to the answer stream**

In `src/main/ipc-handlers.ts`, near the other answer-stream state (`let answerTaskActive`, etc.), add:

```ts
let pendingAnswerAttachments: AnswerAttachment[] = []

function resetPendingAnswerAttachments(): void {
  pendingAnswerAttachments = []
}

function addWebSourceAttachments(results: Array<{ url: string; title?: string }>): void {
  for (const r of results) {
    if (!r?.url) continue
    if (pendingAnswerAttachments.some((a) => a.type === 'web-source' && a.url === r.url)) continue
    let domain = ''
    try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch { /* ignore */ }
    pendingAnswerAttachments.push({
      type: 'web-source',
      url: r.url,
      title: (r.title || domain || r.url).slice(0, 200),
      domain,
    })
    if (pendingAnswerAttachments.filter((a) => a.type === 'web-source').length >= 6) break
  }
}
```

- [ ] **Step 2: Clear the buffer when an answer stream starts**

Find `beginAnswerStream` (or `generateAnswer`'s start) in `ipc-handlers.ts` and call `resetPendingAnswerAttachments()` there, before the LLM call.

- [ ] **Step 3: Wrap the `searchWeb` callback to capture results**

In `generateAnswer`'s `requestWithTools.executeToolCall: createToolExecutor({ ... searchWeb: (query, limit) => webSearchService.search(query, limit), ... })`, change `searchWeb` to:

```ts
searchWeb: async (query: string, limit?: number) => {
  const results = await webSearchService.search(query, limit)
  // results shape: array of { url, title, ... } — adjust the map to the real shape.
  addWebSourceAttachments(Array.isArray(results) ? results : [])
  return results
},
```

(Inspect `webSearchService.search`'s return type to get `url`/`title` field names right.)

- [ ] **Step 4: Send `{ text, attachments }` on answer-done**

Find where the answer-done value is published to the renderer (`sendInterviewAnswerDone(value)` / `publishDone` in `completeAnswerStream`). Change it to send an `AnswerDonePayload`:

```ts
// in completeAnswerStream, where it currently does publishDone(value):
publishDone({ text: value, attachments: pendingAnswerAttachments.length ? [...pendingAnswerAttachments] : undefined })
```

If `publishDone` / `sendInterviewAnswerDone` is typed `(s: string) => void`, widen it to `(p: string | AnswerDonePayload) => void` and update the IPC send. Keep accepting a bare string elsewhere (back-compat).

- [ ] **Step 5: Renderer accepts the new payload**

In `src/renderer/overlay/App.tsx`, the `window.api.onAnswerDone((payload) => ...)` handler:

```ts
const cleanupDone = window.api.onAnswerDone((payload: string | { text: string; attachments?: AnswerAttachment[] }) => {
  const text = typeof payload === 'string' ? payload : payload.text
  const attachments = typeof payload === 'string' ? [] : (payload.attachments ?? [])
  if (text.trim()) { setAnswerTab('answer'); /* existing logic */ }
  setCurrentAnswer(text)
  setCurrentAttachments(attachments)
  // ...rest of existing onAnswerDone logic, using `text` where it used `answer`
})
```

Add `const [currentAttachments, setCurrentAttachments] = useState<AnswerAttachment[]>([])` near the other answer state. Update `src/preload/index.ts`'s `onAnswerDone` callback type to `(payload: string | AnswerDonePayload) => void`.

- [ ] **Step 6: Build**

Run: `npm run build` → green. (Cards aren't rendered yet — Task 8.)

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc-handlers.ts src/renderer/overlay/App.tsx src/preload/index.ts
git commit -m "feat(answer-window): capture web-search sources onto the answer-done payload"
```

---

## Task 7: Capture generated images as data-URL attachments

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Inspect `generateImageArtifact`'s return**

Run: `grep -n "generateImageArtifact\|generateImage" src/main/ipc-handlers.ts src/main/services/image-generation-service.ts`
Determine what it returns (a file path? an artifact record with a path? the bytes?). The wrap below assumes it returns something from which a filesystem path is reachable; adjust to the real shape.

- [ ] **Step 2: Add an image-attachment helper**

In `ipc-handlers.ts`:

```ts
function addGeneratedImageAttachment(filePath: string, caption?: string): void {
  try {
    const buf = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    pendingAnswerAttachments.push({
      type: 'image',
      src: `data:${mime};base64,${buf.toString('base64')}`,
      caption,
    })
  } catch (err) {
    console.error('[AnswerWindow] failed to attach generated image:', err)
  }
}
```

- [ ] **Step 3: Wrap the `generateImage` callback**

In `generateAnswer`'s `createToolExecutor({ ... generateImage: (params) => generateImageArtifact(params), ... })`, change to:

```ts
generateImage: async (params: any) => {
  const result = await generateImageArtifact(params)
  // Adjust `result.path` to the real field that holds the saved file path:
  const filePath = (result && (result.absolutePath || result.path)) as string | undefined
  if (filePath) addGeneratedImageAttachment(filePath, typeof params?.prompt === 'string' ? params.prompt.slice(0, 200) : undefined)
  return result
},
```

- [ ] **Step 4: Build**

Run: `npm run build` → green.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(answer-window): attach generated images as data URLs"
```

---

## Task 8: Render attachments — source cards + inline generated images

**Files:**
- Create: `src/renderer/overlay/components/SourceCard.tsx`
- Modify: `src/renderer/overlay/components/RichContent.tsx` (render `attachments` below prose)
- Modify: `src/renderer/overlay/App.tsx` (pass `currentAttachments` to `<RichContent>`)

- [ ] **Step 1: Create `SourceCard.tsx`**

```tsx
import React from 'react'
import { Globe } from 'lucide-react'

export default function SourceCard({
  url, title, domain,
}: { url: string; title: string; domain: string }): React.JSX.Element {
  const favicon = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : ''
  return (
    <button
      type="button"
      onClick={() => { void window.api.openExternal(url) }}
      className="flex items-center gap-2.5 w-full text-left rounded-lg bg-white/[0.03] border border-white/8 hover:border-white/16 hover:bg-white/[0.05] transition-colors px-3 py-2"
    >
      {favicon
        ? <img src={favicon} alt="" width={16} height={16} className="rounded-sm shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        : <Globe size={14} className="text-white/40 shrink-0" />}
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] text-white/85 truncate">{title}</span>
        <span className="block text-[10.5px] text-white/40 truncate">{domain || url}</span>
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Render attachments in RichContent**

In `RichContent.tsx`, after the `<ReactMarkdown>` block, and only when `!compact`:

```tsx
import SourceCard from './SourceCard'
// ...
{!compact && attachments && attachments.length > 0 && (
  <div className="mt-3 space-y-2">
    {attachments.filter((a) => a.type === 'image').map((a, i) => (
      <figure key={`img-${i}`} className="m-0">
        <img src={(a as { src: string }).src} alt={(a as { caption?: string }).caption ?? ''} loading="lazy" className="max-w-full rounded-lg border border-white/10" />
        {(a as { caption?: string }).caption && <figcaption className="text-[11px] text-white/40 mt-1">{(a as { caption?: string }).caption}</figcaption>}
      </figure>
    ))}
    {attachments.some((a) => a.type === 'web-source') && (
      <div className="space-y-1.5">
        <div className="text-[10.5px] uppercase tracking-wider text-white/30 font-semibold">Sources</div>
        {attachments.filter((a) => a.type === 'web-source').map((a, i) => {
          const s = a as { url: string; title: string; domain: string }
          return <SourceCard key={`src-${i}`} url={s.url} title={s.title} domain={s.domain} />
        })}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Pass attachments from the answer view**

In `src/renderer/overlay/App.tsx`, the answer-view render: `<RichContent content={currentAnswer} fontSize={answerFontSize} attachments={currentAttachments} />`.

- [ ] **Step 4: Build + manual check**

Run: `npm run build` → green.
Manual: ask the agent something that triggers `search_web` → after the answer streams, "Sources" cards appear below; click one → opens in browser. Trigger `generate_image` → the image appears inline below the prose.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/overlay/components/SourceCard.tsx src/renderer/overlay/components/RichContent.tsx src/renderer/overlay/App.tsx
git commit -m "feat(answer-window): render source cards + generated images"
```

---

## Task 9: Read-aloud button (Aura TTS, toggle-independent)

**Files:**
- Create: `src/main/services/markdown-plaintext.ts`
- Create: `scripts/check-rich-content.mjs`
- Modify: `src/shared/ipc-channels.ts` (`SPEAK_ANSWER`, `STOP_SPEAKING_ANSWER`)
- Modify: `src/preload/index.ts` (`speakAnswer`, `stopSpeakingAnswer`)
- Modify: `src/main/ipc-handlers.ts` (handlers; route `voice:audio-end` to the answer window)
- Modify: `src/main/services/agent/companion-tts-service.ts` (no change needed if we just `new CompanionTtsService(...)` for the explicit path — see Step 4)
- Modify: `src/renderer/overlay/App.tsx` (read-aloud button + state)

- [ ] **Step 1: `markdown-plaintext.ts`**

```ts
/** Strip markdown formatting so the text reads naturally through TTS.
 *  Keeps the words and link/image *labels*; drops URLs, fences, list bullets,
 *  heading hashes, emphasis markers, table pipes. */
export function markdownToPlaintext(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')                 // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')                     // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')        // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')         // links → label text
    .replace(/^#{1,6}\s+/gm, '')                     // heading hashes
    .replace(/^\s*[-*+]\s+/gm, '')                   // unordered list bullets
    .replace(/^\s*\d+\.\s+/gm, '')                   // ordered list numbers
    .replace(/^\s*>\s?/gm, '')                       // blockquote markers
    .replace(/\|/g, ' ')                             // table pipes
    .replace(/^[-:|\s]{3,}$/gm, ' ')                 // table separator rows
    .replace(/(\*\*|__)(.*?)\1/g, '$2')              // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')                 // italic
    .replace(/~~(.*?)~~/g, '$1')                     // strikethrough
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')             // horizontal rules
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 2: `scripts/check-rich-content.mjs`**

```js
import assert from 'node:assert/strict'
import { markdownToPlaintext } from '../src/main/services/markdown-plaintext.ts'

assert.equal(
  markdownToPlaintext('## Heading\n\n- **bold** item with a [link](https://x.com) and `code`'),
  'Heading bold item with a link and code'
)
assert.equal(markdownToPlaintext('```\ncode block\n```\nafter'), 'after')
assert.equal(markdownToPlaintext('![alt text](https://x.com/a.png)'), 'alt text')
console.log('check-rich-content: markdownToPlaintext OK')
```

(If the project's check scripts can't import `.ts` directly, mirror the convention of the other `scripts/check-*.mjs` — they may use `tsx` or compile first. Match whatever `scripts/check-profile-merger.mjs` does.)

Run: `node scripts/check-rich-content.mjs` (or however the other check scripts are invoked) → prints OK.

- [ ] **Step 3: IPC channels + preload**

`ipc-channels.ts`: `SPEAK_ANSWER: 'answer:speak'`, `STOP_SPEAKING_ANSWER: 'answer:stop-speaking'`.
`preload/index.ts`: add `speakAnswer: (text: string) => ipcRenderer.invoke(IPC.SPEAK_ANSWER, text)` and `stopSpeakingAnswer: () => ipcRenderer.invoke(IPC.STOP_SPEAKING_ANSWER)`, plus the type declarations.

- [ ] **Step 4: Main handlers — explicit, toggle-independent TTS**

In `ipc-handlers.ts`. The existing `ensureCompanionTtsService()` returns null when `!voiceOutputEnabled()`. Add an explicit variant that ignores the toggle:

```ts
function ensureExplicitTtsService(): CompanionTtsService | null {
  const apiKey = deepgramKeyFromConfig()
  if (!apiKey) return null
  const options = { apiKey, model: companionVoiceModel(), sampleRate: 24000 }
  if (!companionTtsService) {
    companionTtsService = new CompanionTtsService(options)
    companionTtsService.on('event', emitCompanionVoiceEvent)
  } else {
    companionTtsService.setConfig(options)
  }
  return companionTtsService
}

ipcMain.handle(IPC.SPEAK_ANSWER, async (_e, text: string) => {
  const clean = markdownToPlaintext(typeof text === 'string' ? text : '')
  if (!clean) return false
  const svc = ensureExplicitTtsService()
  if (!svc) {
    sendToAnswer('answer:tts-unavailable')   // renderer shows a toast
    return false
  }
  svc.beginTurn()
  svc.enqueueDelta(clean)
  svc.endTurn()
  return true
})

ipcMain.handle(IPC.STOP_SPEAKING_ANSWER, async () => {
  companionTtsService?.stop()
  return true
})
```

Also, in `emitCompanionVoiceEvent`'s `case 'audio-end':`, add `sendToAnswer('voice:audio-end')` alongside the existing `sendToCanvas` / `sendToOverlay` so the answer window learns when playback finishes. (`sendToAnswer` already exists — `grep -n "function sendToAnswer" src/main/ipc-handlers.ts`.) The PCM playback itself continues to happen in the canvas window via the existing `voice:audio-chunk` → `voice-audio-player.ts` path — no change there.

- [ ] **Step 5: Read-aloud button in the answer view**

In `src/renderer/overlay/App.tsx` answer-view header (next to the font-size +/- controls), add:

```tsx
import { Volume2, Square } from 'lucide-react'
// state, near the other answer state:
const [speaking, setSpeaking] = useState(false)
// effect, near the other window.api.on* effects:
useEffect(() => {
  const cleanupEnd = window.api.on?.('voice:audio-end', () => setSpeaking(false))
  const cleanupErr = window.api.on?.('answer:tts-unavailable', () => {
    setSpeaking(false)
    // reuse the existing toast mechanism — show "Add a Deepgram key in Settings to use read-aloud"
  })
  return () => { cleanupEnd?.(); cleanupErr?.() }
}, [])
// button JSX:
<button
  onClick={() => {
    if (speaking) { setSpeaking(false); void window.api.stopSpeakingAnswer() }
    else if (currentAnswer.trim()) { setSpeaking(true); void window.api.speakAnswer(currentAnswer) }
  }}
  title={speaking ? 'Stop' : 'Read aloud'}
  className="..."
>
  {speaking ? <Square size={14} /> : <Volume2 size={14} />}
</button>
```

(If `window.api` doesn't already expose a generic `on(channel, cb)`, add tiny `onVoiceAudioEnd(cb)` / `onAnswerTtsUnavailable(cb)` helpers in the preload following the pattern of the existing `on*` helpers, and the matching `ipcRenderer.on` registrations. Match the existing preload style.)

- [ ] **Step 6: Build + check + manual**

Run: `npm run build` → green. Run the check script → OK.
Manual: open the answer window with content, click the read-aloud button → Aura speaks the plaintext (no "asterisk asterisk"), button shows the stop icon; click again → stops; with no Deepgram key configured → a toast points to Settings.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/markdown-plaintext.ts scripts/check-rich-content.mjs src/shared/ipc-channels.ts src/preload/index.ts src/main/ipc-handlers.ts src/renderer/overlay/App.tsx
git commit -m "feat(answer-window): read-aloud button using Aura TTS"
```

---

## Task 10: Window-content awareness + rename to "Detail"

**Files:**
- Modify: `src/main/services/agent/heartbeat-service.ts` (`isAnswerWindowVisible` dep + snapshot line)
- Modify: `src/main/ipc-handlers.ts` (wire the dep)
- Modify: `src/renderer/overlay/components/Controls.tsx` (menu label "Answers" → "Detail")
- Modify: `src/renderer/overlay/App.tsx` (answer-view header label, if any)
- Modify: `CLAUDE.md` + `docs/superpowers/specs/2026-05-12-answer-window-upgrade-design.md` (note the upgrade shipped)

- [ ] **Step 1: Add `isAnswerWindowVisible` to the heartbeat deps**

In `heartbeat-service.ts`, add to `HeartbeatDeps`: `isAnswerWindowVisible: () => boolean`. In `buildContextSnapshot`, after the `Loaded Context Files` / before `Recent Memories` block (anywhere in the body), add:

```ts
if (this.deps.isAnswerWindowVisible()) {
  parts.push('## Detail Window\nThe user currently has the detail window open showing your last answer. If they say "explain step 2", "shorten that", "the second point", etc., they mean what is displayed there.')
}
```

In `ipc-handlers.ts`, the `new HeartbeatService({ ... })` call: add `isAnswerWindowVisible: () => { const w = getAnswerWindow(); return !!w && !w.isDestroyed() && w.isVisible() }`.

- [ ] **Step 2: Rename internal labels**

`grep -rn "Answers\b\|Show Answers\|Hide Answers\|answer window" src/renderer` — in `Controls.tsx`'s dropdown menu, change the "Show/Hide Answers" item label to "Detail" (keep the toggle behaviour). In `overlay/App.tsx`, if the answer-view header shows a title like "Answers" or "AI Suggestion", change it to "Detail". Don't touch IPC channel names, function names, or file names — labels only.

- [ ] **Step 3: Build + manual check**

Run: `npm run build` → green.
Manual: open the answer/detail window, ask the agent "shorten that" → it operates on the displayed content; the dropdown menu shows "Detail".

- [ ] **Step 4: Update docs**

In `CLAUDE.md`, update the "What Exists Now" / answer-window description: it's now "Detail" — a rich result viewer (clickable links, inline images, web-search source cards, read-aloud via Aura). In the spec doc, add a line at the top: `**Status:** shipped 2026-MM-DD`.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent/heartbeat-service.ts src/main/ipc-handlers.ts src/renderer/overlay/components/Controls.tsx src/renderer/overlay/App.tsx CLAUDE.md docs/superpowers/specs/2026-05-12-answer-window-upgrade-design.md
git commit -m "feat(answer-window): window-content awareness; rename to Detail"
```

---

## Final verification

- [ ] `npm run build` green.
- [ ] `node scripts/check-rich-content.mjs` (or project convention) passes.
- [ ] Manual smoke (Companion mode, `npm run dev`):
  - Detail window with a markdown link → opens in default browser.
  - Detail window with a markdown image → renders inline; broken URL → fallback chip.
  - Ask something that triggers `search_web` → "Sources" cards below the answer, clickable.
  - Trigger `generate_image` → image renders inline below the prose.
  - Click "Read aloud" → Aura speaks the plaintext (no markdown noise); click again → stops; no Deepgram key → toast to Settings.
  - Companion bubbles still render as terse one-liners (no inline images/tables/cards).
  - `.md` file preview → links/images/tables render rich.
  - Ask "shorten that" with the Detail window open → agent operates on the displayed content.
  - Dropdown menu shows "Detail".
- [ ] Update the vault decision memory for whisphry noting the answer-window upgrade shipped (link the spec + plan paths).

---

## Notes / risks

- `react-markdown` v9 needs React 18+; React 19 is supported. If `npm install` flags a peer-dep conflict, check the installed `react-markdown` major.
- `webSearchService.search` and `generateImageArtifact` return shapes are assumptions in Tasks 6–7 — the implementer must inspect them and adjust the `.map`/field access. This is the one place the plan can't be fully concrete without reading those files.
- The answer window is a `view=answer` instance of the *overlay* renderer but a *separate BrowserWindow* — `sendToOverlay` does NOT reach it; use `sendToAnswer`. This bites the `voice:audio-end` wiring (Task 9 Step 4) and the toast (`answer:tts-unavailable`).
- Bundle size grows ~50–80KB from the markdown libs. Acceptable for a desktop app.
- Keep the commit-permission rule in mind (note at top of this plan).
