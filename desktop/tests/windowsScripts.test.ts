import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  buildWindowsInstallScript,
  buildWindowsUninstallScript,
  quotePowerShell
} from '../src/main/windowsScripts'

const binary = 'C:\\Program Files\\ShieldBar\\resources\\helper\\win32-x64\\shieldbar-helper.exe'
const sid = 'S-1-5-21-1234567890-1234567890-1234567890-1001'

describe('Windows helper scripts', () => {
  it('puts the exit statement on its own line', () => {
    const script = buildWindowsInstallScript(binary, sid)

    expect(script).toContain('\nexit $process.ExitCode')
    expect(script).not.toContain('-WindowStyle')
    expect(script).not.toContain('Hidden exit')
    expect(script).toContain("'install'")
    expect(script).toContain(`'${sid}'`)
  })

  it('builds a separate uninstall script', () => {
    const script = buildWindowsUninstallScript(binary)

    expect(script).toContain("'uninstall'")
    expect(script).toContain('\nexit $process.ExitCode')
    expect(script).not.toContain('-WindowStyle')
  })

  it('escapes apostrophes in PowerShell string literals', () => {
    expect(quotePowerShell("C:\\O'Brien\\helper.exe")).toBe(
      "'C:\\O''Brien\\helper.exe'"
    )
  })

  it.runIf(process.platform === 'win32')(
    'parses as valid PowerShell without executing it',
    () => {
      const script = buildWindowsInstallScript(binary, sid)
      const encoded = Buffer.from(script, 'utf8').toString('base64')
      const parser = [
        `$code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
        '$tokens = $null',
        '$errors = $null',
        '[System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors) | Out-Null',
        'if ($errors.Count -gt 0) {',
        '  $errors | ForEach-Object { Write-Error $_.Message }',
        '  exit 1',
        '}'
      ].join('\n')

      expect(() =>
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', parser],
          { stdio: 'pipe' }
        )
      ).not.toThrow()
    }
  )
})
