export function buildWindowsInstallScript(binary: string, sid: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath ${quotePowerShell(binary)} -ArgumentList @('install','--sid',${quotePowerShell(sid)}) -Verb RunAs -Wait -PassThru`,
    'if ($null -eq $process) { exit 1 }',
    'exit $process.ExitCode'
  ].join('\n')
}

export function buildWindowsUninstallScript(binary: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath ${quotePowerShell(binary)} -ArgumentList @('uninstall') -Verb RunAs -Wait -PassThru`,
    'if ($null -eq $process) { exit 1 }',
    'exit $process.ExitCode'
  ].join('\n')
}

export function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
