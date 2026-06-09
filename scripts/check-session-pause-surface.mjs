import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function assertIncludes(file, needle, message) {
  const content = read(file)
  if (!content.includes(needle)) {
    throw new Error(`${message}\nMissing in ${file}: ${needle}`)
  }
}

assertIncludes('src/shared/types.ts', "PAUSE_SESSION: 'session:pause'", 'pause IPC channel must be declared')
assertIncludes('src/shared/types.ts', "RESUME_SESSION: 'session:resume'", 'resume IPC channel must be declared')
assertIncludes('src/preload/index.ts', 'pauseSession:', 'pause API must be exposed to renderer')
assertIncludes('src/preload/index.ts', 'resumeSession:', 'resume API must be exposed to renderer')
assertIncludes('src/main/ipc-handlers.ts', 'ipcMain.handle(IPC.PAUSE_SESSION', 'main process must handle pause')
assertIncludes('src/main/ipc-handlers.ts', 'ipcMain.handle(IPC.RESUME_SESSION', 'main process must handle resume')
assertIncludes('src/main/ipc-handlers.ts', 'isPaused:', 'session broadcasts must carry paused state')
assertIncludes('src/main/services/session-state-service.ts', 'isPaused: boolean', 'session state service must accept paused state')
assertIncludes('src/main/services/session-state-service.ts', 'isPaused: options.isPaused', 'session state service must publish paused state')
assertIncludes('src/renderer/overlay/App.tsx', 'setIsSessionPaused', 'overlay must store paused state')
assertIncludes('src/renderer/overlay/App.tsx', '!isSessionPaused && <AudioCapture', 'pause must unmount audio capture')
assertIncludes('src/renderer/overlay/components/Controls.tsx', 'onTogglePause', 'controls must expose pause toggle')
assertIncludes('src/main/ipc-handlers.ts', 'sessionRuntimeStore.sessionBrain?.pause()', 'pause must call sessionBrain.pause()')
assertIncludes('src/main/ipc-handlers.ts', 'sessionRuntimeStore.sessionBrain?.resume()', 'resume must call sessionBrain.resume()')
assertIncludes('src/main/ipc-handlers.ts', 'sessionRuntimeStore.sessionBrain.stop()', 'stop-session must call sessionBrain.stop()')

console.log('Session pause surface check passed')
