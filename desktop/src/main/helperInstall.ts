import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ProtectionActionResult } from '../shared/protection'

const execFileAsync = promisify(execFile)

function platformDirectory(): string {
  if (process.platform === 'win32') return 'win32-x64'
  if (process.platform === 'linux') return 'linux-x64'
  return 'darwin-arm64'
}

export function helperBinaryPath(): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'helper')
    : join(app.getAppPath(), 'resources', 'helper')
  const binary =
    process.platform === 'win32' ? 'shieldbar-helper.exe' : 'shieldbar-helper'
  return join(root, platformDirectory(), binary)
}

export async function installProtectionHelper(): Promise<ProtectionActionResult> {
  const binary = helperBinaryPath()
  if (!existsSync(binary)) {
    return {
      ok: false,
      message:
        'The helper binary is missing. Build it with “npm run helper” before packaging.'
    }
  }

  try {
    if (process.platform === 'darwin') {
      const uid = process.getuid?.() ?? -1
      const gid = process.getgid?.() ?? -1
      if (uid < 0 || gid < 0) {
        return { ok: false, message: 'Could not determine the current user.' }
      }
      const command = `${shellQuote(binary)} install --uid ${uid} --gid ${gid}`
      const script = `do shell script ${appleScriptQuote(command)} with administrator privileges`
      await execFileAsync('/usr/bin/osascript', ['-e', script], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024
      })
      return { ok: true, message: 'Protection helper installed.' }
    }

    if (process.platform === 'linux') {
      const uid = process.getuid?.() ?? -1
      const gid = process.getgid?.() ?? -1
      if (uid < 0 || gid < 0) {
        return { ok: false, message: 'Could not determine the current user.' }
      }
      await execFileAsync(
        'pkexec',
        [binary, 'install', '--uid', String(uid), '--gid', String(gid)],
        { timeout: 120_000, maxBuffer: 1024 * 1024 }
      )
      return { ok: true, message: 'Protection helper installed.' }
    }

    if (process.platform === 'win32') {
      const sid = await currentWindowsSid()
      if (!sid) {
        return { ok: false, message: 'Could not determine the current Windows user SID.' }
      }
      const script = [
        `$process = Start-Process -FilePath ${psQuote(binary)}`,
        `-ArgumentList @('install','--sid',${psQuote(sid)})`,
        '-Verb RunAs -Wait -PassThru -WindowStyle Hidden',
        'exit $process.ExitCode'
      ].join(' ')
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 120_000, maxBuffer: 1024 * 1024 }
      )
      return { ok: true, message: 'Protection helper installed.' }
    }

    return { ok: false, message: 'Unsupported platform for the protection helper.' }
  } catch (error) {
    return { ok: false, message: helperErrorMessage(error) }
  }
}

export async function uninstallProtectionHelper(): Promise<ProtectionActionResult> {
  const binary = helperBinaryPath()
  if (!existsSync(binary)) {
    return { ok: false, message: 'The helper binary is missing.' }
  }

  try {
    if (process.platform === 'darwin') {
      const command = `${shellQuote(binary)} uninstall`
      const script = `do shell script ${appleScriptQuote(command)} with administrator privileges`
      await execFileAsync('/usr/bin/osascript', ['-e', script], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024
      })
      return { ok: true, message: 'Protection helper removed.' }
    }

    if (process.platform === 'linux') {
      await execFileAsync('pkexec', [binary, 'uninstall'], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024
      })
      return { ok: true, message: 'Protection helper removed.' }
    }

    if (process.platform === 'win32') {
      const script = [
        `$process = Start-Process -FilePath ${psQuote(binary)}`,
        `-ArgumentList @('uninstall')`,
        '-Verb RunAs -Wait -PassThru -WindowStyle Hidden',
        'exit $process.ExitCode'
      ].join(' ')
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 120_000, maxBuffer: 1024 * 1024 }
      )
      return { ok: true, message: 'Protection helper removed.' }
    }

    return { ok: false, message: 'Unsupported platform for the protection helper.' }
  } catch (error) {
    return { ok: false, message: helperErrorMessage(error) }
  }
}

async function currentWindowsSid(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value'
      ],
      { timeout: 30_000 }
    )
    const sid = stdout.trim()
    return /^S-\d-\d+(-\d+)+$/.test(sid) ? sid : null
  } catch {
    return null
  }
}

function helperErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
    if (stderr) return stderr.split('\n').slice(-4).join(' ')
  }
  if (error instanceof Error) {
    if (error.message.includes('User canceled') || error.message.includes('canceled')) {
      return 'Administrator approval was canceled.'
    }
    return error.message
  }
  return String(error)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function appleScriptQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
