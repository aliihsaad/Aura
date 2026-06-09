# MiniCPM OpenVINO Runtime Design

**Context:** Whisphry already has Local AI settings, vision provider contracts, routing policy, and a MiniCPM provider shell. Piper and Whisper are now real local providers. MiniCPM-V remains the next local AI step, but it is a larger trust and packaging surface because the useful model pack is several GB and official OpenVINO usage expects either local conversion or a preconverted model folder.

## Decision

Implement the MiniCPM provider runtime boundary first and keep automatic model downloads conservative.

Whisphry will support an installed OpenVINO VLM model folder under the existing model-pack root. The provider will dynamically load OpenVINO GenAI Node at runtime, analyze a screenshot through `VLMPipeline`, and normalize the returned text into the existing `VisionCortexResult` shape.

The app will not automatically download a third-party converted MiniCPM pack in this step. A user or later installer task can place/convert a compatible model folder, and Settings will truthfully report whether the model folder and runtime are usable.

## Architecture

- `MiniCpmVisionProvider` remains the only local vision provider implementation.
- The provider checks three things before reporting available:
  - `minicpm-v-2_6-openvino-int4` model pack is installed.
  - The pack folder looks like an OpenVINO VLM folder.
  - `openvino-genai-node` can be loaded.
- `analyze()` writes the screenshot to a temporary image file, asks the VLM for compact JSON, then parses it through the existing vision-cortex parser.
- Cloud fallback remains controlled by `local-ai-routing-policy.ts`.
- Settings keeps MiniCPM opt-in and removable.

## Runtime Source

OpenVINO GenAI documents `VLMPipeline` for JavaScript/Node and shows MiniCPM-V 2.6 conversion with:

```bash
optimum-cli export openvino --model openbmb/MiniCPM-V-2_6 --weight-format int4 --trust-remote-code MiniCPM_V_2_6_ov
```

This implementation targets that output shape rather than hardcoding a community Hugging Face conversion as the automatic source.

## Testing

Add a focused script, `scripts/check-minicpm-runtime.mjs`, that:

- verifies the provider reports unavailable when no pack is installed,
- verifies the provider reports unavailable when runtime loading fails,
- verifies `analyze()` works with a fake `VLMPipeline` injected through a runtime override,
- verifies parsed output maps into `VisionCortexResult`.

The fake-runtime path prevents CI/dev verification from requiring an 8GB model.

## Non-Goals

- No automatic third-party MiniCPM model download in this step.
- No Python conversion workflow in the app.
- No default switch to local-only vision.
- No broad rewrite of screenshot or answer routing.
