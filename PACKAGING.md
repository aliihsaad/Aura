# Whisphry Packaging & Releases

## Goal

Build installable Whisphry desktop artifacts from versioned Git tags so the app can be tested outside `npm run dev`.

## Current Package Targets

- Windows NSIS installer: `dist/Whisphry-Setup-<version>-x64.exe`
- Windows portable app: `dist/Whisphry-Portable-<version>.exe`
- macOS DMG/ZIP artifacts from the GitHub macOS builder

The installer metadata comes from `package.json`:

- `version`: release version. The first controlled release baseline is `1.0.0`.
- `build.appId`: `com.whisphry.desktop`
- `build.productName`: `Whisphry`

## Local Verification

Run this before tagging a release:

```bash
npm run check:release
```

That command checks the package config, mode-isolation guard, session-intent taxonomy, release version format, and production build.

To create a local Windows installer:

```bash
npm run package:win
```

## GitHub Builder Workflow

Workflow file: `.github/workflows/build.yml`

It now runs in three modes:

- Pull requests to `main`: verify only, no installer artifacts.
- Pushes to `main`: verify and build Windows/macOS artifacts for install testing.
- Tags like `v1.0.5`: verify, build installers, and create a draft GitHub Release.

For tag builds, the tag must match `package.json` exactly:

```text
package.json version: 1.0.0
required git tag: v1.0.0
```

The check is enforced by `scripts/check-release-version.mjs`.

## Release Steps

1. Confirm the working tree only contains intended changes:

```bash
git status --short
```

2. Bump the app version:

```bash
npm version patch --no-git-tag-version
```

Use `minor` or `major` instead of `patch` when the change warrants it.

3. Run local verification:

```bash
npm run check:release
```

4. Commit the release changes:

```bash
git add package.json package-lock.json
git commit -m "chore: release v1.0.0"
```

5. Create and push the matching tag:

```bash
git tag v1.0.0
git push origin main --tags
```

6. In GitHub Actions, open the `Build Installers` run for the tag. Download the Windows artifact or open the draft GitHub Release once the workflow finishes.

## Install Test Checklist

- Installer launches and installs Whisphry.
- Portable EXE launches without install.
- App starts without `npm run dev`.
- Closing the settings/dashboard window hides it instead of exiting the app.
- Tray Quit exits the app cleanly.
- API keys are entered through the app, not bundled from `.env`.
- `%APPDATA%/whisphry/` config and session data persist between launches.

## Later

- Add Windows code signing to reduce SmartScreen warnings.
- Add auto-update after GitHub Releases are stable.
- Decide whether macOS releases need notarization before publishing public downloads.
