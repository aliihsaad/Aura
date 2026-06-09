import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface TerminalApprovalRequest {
  command: string
  cwd: string
  timeoutMs: number
}

export interface TerminalRunOptions {
  cwd?: string
  timeoutMs?: number
  approvalAlreadyGranted?: boolean
}

export interface TerminalRunResult {
  command: string
  cwd: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

interface TerminalServiceOptions {
  requestApproval: (request: TerminalApprovalRequest) => Promise<boolean>
}

export class TerminalService {
  private static readonly DEFAULT_TIMEOUT_MS = 20_000
  private static readonly MAX_TIMEOUT_MS = 30_000
  private static readonly MAX_OUTPUT_BYTES = 64 * 1024
  // Catastrophic, irreversible commands. Always refused, even with approval.
  private static readonly BLOCKED_PATTERNS: RegExp[] = [
    /\brm\s+-rf\b/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\breg\s+delete\b/i,
  ]
  // Destructive-but-recoverable commands. Allowed only when the user has
  // explicitly approved this exact command via the approval card. Bypassing
  // the approval gate (approvalAlreadyGranted) is NOT enough on its own —
  // these still require a fresh approve.
  private static readonly DESTRUCTIVE_PATTERNS: RegExp[] = [
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\b/i,
    /\bgit\s+checkout\s+--\b/i,
    /\brmdir\b/i,
    /\bdel\b/i,
  ]

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: TerminalServiceOptions
  ) {}

  async runCommand(command: string, options: TerminalRunOptions = {}): Promise<TerminalRunResult> {
    const trimmed = command.trim()
    if (!trimmed) {
      throw new Error('Command is required.')
    }
    if (TerminalService.BLOCKED_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      throw new Error('Refusing to run a catastrophic command (no approval can override this).')
    }

    const cwd = this.resolveCwd(options.cwd)
    const timeoutMs = this.normalizeTimeout(options.timeoutMs)
    const isDestructive = TerminalService.DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(trimmed))
    // Destructive commands always need a fresh, explicit approval — even if a
    // task-level approval was already granted upstream. This catches things
    // like `git reset --hard` and `git clean -fd` from auto-running.
    if (isDestructive || !options.approvalAlreadyGranted) {
      const approved = await this.options.requestApproval({
        command: trimmed,
        cwd,
        timeoutMs,
      })
      if (!approved) {
        throw new Error('User declined terminal command approval.')
      }
    }

    return await this.execute(trimmed, cwd, timeoutMs)
  }

  private execute(command: string, cwd: string, timeoutMs: number): Promise<TerminalRunResult> {
    return new Promise((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
      const args =
        process.platform === 'win32'
          ? ['-NoProfile', '-NonInteractive', '-Command', command]
          : ['-lc', command]

      let stdout = ''
      let stderr = ''
      let stdoutTruncated = false
      let stderrTruncated = false
      let timedOut = false

      const child = execFile(shell, args, {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: TerminalService.MAX_OUTPUT_BYTES * 2,
      })

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        const next = stdout + text
        if (Buffer.byteLength(next, 'utf8') > TerminalService.MAX_OUTPUT_BYTES) {
          stdout = trimUtf8(next, TerminalService.MAX_OUTPUT_BYTES)
          stdoutTruncated = true
          return
        }
        stdout = next
      })

      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        const next = stderr + text
        if (Buffer.byteLength(next, 'utf8') > TerminalService.MAX_OUTPUT_BYTES) {
          stderr = trimUtf8(next, TerminalService.MAX_OUTPUT_BYTES)
          stderrTruncated = true
          return
        }
        stderr = next
      })

      child.on('error', (error) => {
        reject(error)
      })

      child.on('close', (code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          timedOut = true
        }

        resolve({
          command,
          cwd,
          exitCode: code,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
          timedOut,
          stdoutTruncated,
          stderrTruncated,
        })
      })
    })
  }

  private resolveCwd(requested?: string): string {
    const raw = (requested || '.').trim()
    const absolute = path.resolve(path.isAbsolute(raw) ? raw : path.join(this.workspaceRoot, raw))
    const normalizedRoot = this.workspaceRoot.endsWith(path.sep)
      ? this.workspaceRoot
      : `${this.workspaceRoot}${path.sep}`
    if (absolute !== this.workspaceRoot && !absolute.startsWith(normalizedRoot)) {
      throw new Error('Requested cwd is outside the workspace root.')
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
      throw new Error('Requested cwd is not a directory.')
    }
    return absolute
  }

  private normalizeTimeout(input?: number): number {
    const parsed = Number(input)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return TerminalService.DEFAULT_TIMEOUT_MS
    }
    return Math.min(Math.max(Math.floor(parsed), 1_000), TerminalService.MAX_TIMEOUT_MS)
  }
}

function trimUtf8(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, 'utf8')
  if (buffer.byteLength <= maxBytes) return input
  return buffer.subarray(0, maxBytes).toString('utf8')
}
