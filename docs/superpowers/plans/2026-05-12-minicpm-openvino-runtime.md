# MiniCPM OpenVINO Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing MiniCPM-V local vision provider real when a compatible OpenVINO VLM model folder and runtime are installed.

**Architecture:** Keep MiniCPM behind the existing `VisionProvider` interface. Dynamically load OpenVINO GenAI Node at runtime, use an injectable fake runtime for tests, and keep cloud fallback controlled by the existing Local AI routing policy.

**Tech Stack:** Electron main process, TypeScript, OpenVINO GenAI Node optional runtime, existing Local AI model-pack store.

---

### Task 1: Add Runtime Verification

**Files:**
- Create: `scripts/check-minicpm-runtime.mjs`
- Modify: `package.json`

- [ ] Write a failing script that imports `MiniCpmVisionProvider`, creates a fake installed model pack, injects a fake VLM runtime, and expects a normalized `VisionCortexResult`.
- [ ] Run `node scripts/check-minicpm-runtime.mjs` and confirm it fails because the provider has no runtime override or working `analyze()` implementation.
- [ ] Add the script to `npm run check:local-ai`.

### Task 2: Implement Provider Runtime Boundary

**Files:**
- Modify: `src/main/services/local-ai/providers/minicpm-vision-provider.ts`
- Modify: `src/main/services/local-ai/local-ai-manager.ts`

- [ ] Add a `MiniCpmRuntimeOverride` test hook with `createPipeline(modelPath, device)`.
- [ ] Add model-folder readiness checks for OpenVINO VLM files.
- [ ] Dynamically load `openvino-genai-node` only inside provider runtime code.
- [ ] Write screenshot bytes to a temp image and call `pipeline.generate(prompt, { images: [imagePath], generationConfig })`.
- [ ] Parse the returned text with `parseVisionCortexJson`.
- [ ] Update status so installed-but-missing-runtime says exactly what is missing.

### Task 3: Verify And Commit

**Files:**
- All files above

- [ ] Run `node scripts/check-minicpm-runtime.mjs`.
- [ ] Run `npm run check:local-ai`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Commit as `feat(local-ai): run minicpm vision via openvino`.
- [ ] Push `main`.
