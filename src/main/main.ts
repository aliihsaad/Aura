import { app, globalShortcut, Tray, Menu, nativeImage, session, desktopCapturer } from 'electron'
import { join } from 'path'
import * as dotenv from 'dotenv'
import { createOverlayWindow, createAnswerWindow, createSettingsWindow, createPreviewWindow, createCanvasWindow, toggleOverlay, hideOverlay, getOverlayWindow, getSettingsWindow, markAppQuitting, quitApp } from './windows'
import { setupIpcHandlers, startVaultMcp, shutdownVaultMcp } from './ipc-handlers'
import { checkForUpdates } from './services/update-checker'
import { DEFAULT_SHORTCUTS } from '@shared/constants'

// Load environment variables
dotenv.config()

let tray: Tray | null = null

app.whenReady().then(() => {
  // Grant all media permissions (audio/video capture)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'display-capture', 'audioCapture']
    callback(allowed.includes(permission))
  })

  // Auto-grant display media request (for system audio via desktopCapturer)
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Grant access to the first screen with audio
      callback({ video: sources[0], audio: 'loopback' })
    })
  })

  // Create windows
  createOverlayWindow()
  createAnswerWindow()
  createPreviewWindow()
  createSettingsWindow()
  createCanvasWindow()

  // Setup IPC handlers
  setupIpcHandlers()

  // Connect Vault MCP servers in the background — the app never waits on
  // them and boots identically when they are absent.
  void startVaultMcp().catch((err) => {
    console.warn('[MCP] startup connect failed:', err)
  })

  // Register global shortcuts
  globalShortcut.register(DEFAULT_SHORTCUTS.toggleOverlay, () => {
    toggleOverlay()
  })

  globalShortcut.register(DEFAULT_SHORTCUTS.startStopSession, () => {
    const overlay = getOverlayWindow()
    if (overlay) {
      overlay.webContents.send('shortcut:toggle-session')
    }
  })

  globalShortcut.register(DEFAULT_SHORTCUTS.captureScreen, () => {
    const overlay = getOverlayWindow()
    if (overlay) {
      overlay.webContents.send('shortcut:capture-screen')
    }
  })

  globalShortcut.register(DEFAULT_SHORTCUTS.regenerateAnswer, () => {
    const overlay = getOverlayWindow()
    if (overlay) {
      overlay.webContents.send('shortcut:regenerate')
    }
  })

  globalShortcut.register(DEFAULT_SHORTCUTS.hideOverlay, () => {
    hideOverlay()
  })

  globalShortcut.register(DEFAULT_SHORTCUTS.answerNow, () => {
    const overlay = getOverlayWindow()
    if (overlay) {
      overlay.webContents.send('shortcut:answer-now')
    }
  })

  // Create system tray
  createTray()

  console.log('[App] Ready')

  // Check for updates after startup
  setTimeout(async () => {
    const update = await checkForUpdates()
    if (update?.updateAvailable) {
      const settings = getSettingsWindow()
      if (settings) {
        settings.webContents.send('update:available', update)
      }
    }
  }, 3000)
})

import iconPath from '../../build/icon.png?asset'

function createTray(): void {
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => toggleOverlay() },
    { label: 'Preferences', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() },
  ])

  tray.setToolTip('Aura')
  tray.setContextMenu(contextMenu)
}

let vaultMcpShutdownDone = false

app.on('before-quit', (event) => {
  markAppQuitting()
  // Disconnect the vault-collab presence session cleanly before exit, with a
  // hard 2.5s cap so a hung server can never block quitting.
  if (!vaultMcpShutdownDone) {
    event.preventDefault()
    const finish = (): void => {
      if (vaultMcpShutdownDone) return
      vaultMcpShutdownDone = true
      app.quit()
    }
    const failsafe = setTimeout(finish, 2500)
    void shutdownVaultMcp()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(failsafe)
        finish()
      })
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
