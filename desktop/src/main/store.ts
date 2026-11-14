import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

interface SettingsData {
  notifyOnLeak: boolean
  hasSeenWelcome: boolean
}

const DEFAULTS: SettingsData = {
  notifyOnLeak: true,
  hasSeenWelcome: false
}

/**
 * Tiny local settings file. It deliberately stores only two booleans: no IP
 * addresses, reports, history, or timestamps.
 */
export class SettingsStore {
  private readonly filePath: string
  private data: SettingsData

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? join(app.getPath('userData'), 'settings.json')
    this.data = this.load()
  }

  get notifyOnLeak(): boolean {
    return this.data.notifyOnLeak
  }

  get hasSeenWelcome(): boolean {
    return this.data.hasSeenWelcome
  }

  setNotifyOnLeak(value: boolean): void {
    if (this.data.notifyOnLeak === value) return
    this.data = { ...this.data, notifyOnLeak: value }
    this.save()
  }

  markWelcomeSeen(): void {
    if (this.data.hasSeenWelcome) return
    this.data = { ...this.data, hasSeenWelcome: true }
    this.save()
  }

  private load(): SettingsData {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULTS }
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<SettingsData>
      return {
        notifyOnLeak:
          typeof parsed.notifyOnLeak === 'boolean'
            ? parsed.notifyOnLeak
            : DEFAULTS.notifyOnLeak,
        hasSeenWelcome:
          typeof parsed.hasSeenWelcome === 'boolean'
            ? parsed.hasSeenWelcome
            : DEFAULTS.hasSeenWelcome
      }
    } catch {
      return { ...DEFAULTS }
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
      renameSync(temporary, this.filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`ShieldBar: could not save settings: ${message}\n`)
    }
  }
}
