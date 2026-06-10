import { app, globalShortcut, Tray, Menu, nativeImage, session, desktopCapturer } from 'electron'
import { join } from 'path'
import * as dotenv from 'dotenv'
import { createOverlayWindow, createAnswerWindow, createSettingsWindow, createPreviewWindow, createCanvasWindow, toggleOverlay, hideOverlay, getOverlayWindow, getSettingsWindow, markAppQuitting, quitApp } from './windows'
import { setupIpcHandlers } from './ipc-handlers'
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

app.on('before-quit', () => {
  markAppQuitting()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
