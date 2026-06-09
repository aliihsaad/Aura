# Local AI Installer Notes

Date: 2026-05-12

## Installer Identity

Whisphry packages as `com.whisphry.desktop` with product name `Whisphry`.
The Windows installer is assisted, not one-click, so users can choose the install
location and get predictable desktop/start-menu shortcuts.

## Base Installer Policy

The base installer must stay model-free. It may include application code,
renderer assets, production dependencies, and small markdown workspace skills.
It must not include model weights, local AI pack folders, or downloaded runtime
artifacts.

Explicitly excluded from packaged files:

- `**/models/**`
- `**/model-packs/**`
- `**/*.gguf`
- `**/*.safetensors`
- `**/*.onnx`
- `**/*.bin`
- `**/*.pt`
- `**/*.pth`

`resources/workspace-skills` is the only configured `extraResources` entry and
is filtered to markdown files. Model packs remain post-install downloads.

## Model Pack Policy

Model packs are optional user actions from Settings. Users must enable model
downloads before install actions are accepted. Installed packs live under
Electron `userData` in the local AI model root and can be removed from Settings.
Downloads go to a temp folder under that same model root, then move into the
pack folder only after the download and configured checksum verification pass.

Current planned packs:

| Pack | Provider | Approx Size | Installer Behavior |
| --- | --- | ---: | --- |
| Whisper tiny Q5_1 | Local STT | 72MB | Post-install only; source configured from `ggml-org/whisper.cpp` plus multilingual `ggml-tiny-q5_1` model |

Removed/deferred packs:

- Piper English Small was removed from the active provider list and legacy
  model-pack cleanup now deletes existing Piper installs from the local model
  root.
- MiniCPM-V 2.6 OpenVINO INT4 was removed from the active provider list because
  the Windows runtime path was too heavy and slow for the current product loop.
  Cloud vision remains the active vision route.
- Kokoro 82M was removed after local testing. The dependency, runtime provider,
  model pack, and Settings controls are not part of the active build.

## Capability Defaults

Local AI defaults to `auto`, but no large model is downloaded or loaded by
default. Weak machines are protected by keeping heavyweight local vision out of
the active provider set.

Deepgram remains the default STT provider. Whisper local is an opt-in
fallback/privacy option and must not become the default.

## Cloud Fallback

The cloud route stays available unless the user explicitly selects settings that
block it, such as local-only screenshot blocking. Local provider crashes,
missing packs, and runtime failures should produce diagnostics and fall back to
current cloud behavior when policy allows.

## Verification

Run before packaging:

```bash
npm run check:package
npm run check:local-ai
npm run build
```

Optional directory package smoke:

```bash
npm run package:dir
```
