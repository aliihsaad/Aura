# Aura

> A local-first desktop AI companion that listens, watches, remembers, and helps in real time.

[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows--first-lightgrey)]()

## Overview

Aura is an always-on-top desktop companion built around three ideas:

- **Capture** what is happening around the user in real time — system audio, microphone, and screen.
- **Remember** what matters in a local memory layer (events, artifacts, memories, entities, relations).
- **Help** through a single companion agent: short floating replies, a detail window for deep answers, and optional voice.

Everything runs locally except the AI APIs the user explicitly configures (OpenRouter, Deepgram, FreeLLMAPI).

## Companion Mode

Aura has one product mode — **Companion** — with two engines:

- **Classic**: Deepgram STT → heartbeat agent → OpenRouter chat completions → floating reply bubbles, with optional Deepgram Aura TTS voice.
- **Realtime Beta**: live audio in/out over a FreeLLMAPI realtime WebSocket (Gemini Live), with `solve_with_openrouter` available for hard reasoning, and automatic session-context re-injection when the connection rotates mid-session.

## Key Features

- Live transcription (system audio + mic) with multi-language support
- Heartbeat agent with tool catalog: answer window, web search, image generation, screen analysis, memory tools
- Local memory subsystem: embeddings, entity graph, recall — all on disk
- Session brain: background summarizer + relevance-rated screenshot index
- File-based sessions (`sessions/`) with transcript, answers, notes, conversation log
- Content protection (windows invisible to screen capture) — toggleable
- Local AI fallbacks: whisper.cpp STT, system TTS

## Getting Started

```bash
npm install
npm run dev
```

Configure API keys in the dashboard Settings tab (stored encrypted via `safeStorage`).

## Build & Package

```bash
npm run build          # compile
npm run check:release  # release guard checks + build
npm run package        # Windows installer + portable exe
```

## License

MIT
