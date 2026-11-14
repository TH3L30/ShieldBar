import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_PROTECTION_SETTINGS,
  type ProtectionSettings
} from '../shared/protection'
import { normalizeSettings } from '../core/protection'

interface SettingsData {
  notifyOnLeak: boolean
  hasSeenWelcome: boolean
  protection: ProtectionSettings
}

const DEFAULTS: SettingsData = {
  notifyOnLeak: true,
  hasSeenWelcome: false,
  protection: { ...DEFAULT_PROTECTION_SETTINGS }
}

/**
 * Small local settings file. It stores UI preferences and protection toggles,
 * never IP addresses, baselines, reports, or history.
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

  get protectionSettings(): ProtectionSettings {
    return { ...this.data.protection }
  }

  setProtectionSettings(settings: ProtectionSettings): void {
    this.data = { ...this.data, protection: { ...settings } }
    this.save()
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
            : DEFAULTS.hasSeenWelcome,
        protection: normalizeSettings(
          parsed.protection,
          DEFAULT_PROTECTION_SETTINGS
        )
      }
    } catch {
      return {
        ...DEFAULTS,
        protection: { ...DEFAULT_PROTECTION_SETTINGS }
      }
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
