import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const AUTOSTART_FILE = 'shieldbar.desktop'

export function applyStartAtLogin(enabled: boolean): void {
  if (process.platform === 'linux') {
    applyLinuxStartAtLogin(enabled)
    return
  }

  if (!app.isPackaged) return

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--background']
    })
  } catch {
    /* login items are best effort */
  }
}

function applyLinuxStartAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return

  const directory = join(app.getPath('home'), '.config', 'autostart')
  const file = join(directory, AUTOSTART_FILE)

  try {
    if (!enabled) {
      if (existsSync(file)) rmSync(file)
      return
    }

    const executable = process.env.APPIMAGE || process.execPath
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=ShieldBar',
        `Exec="${executable.replace(/"/g, '\\"')}"`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        'NoDisplay=false',
        ''
      ].join('\n'),
      'utf8'
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`ShieldBar: could not update autostart: ${message}\n`)
  }
}
