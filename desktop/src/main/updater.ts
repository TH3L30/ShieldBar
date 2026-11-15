import { app, net, shell } from 'electron'
import type {
  UpdateActionResult,
  UpdateState
} from '../shared/update'
import {
  UPDATE_FEED_SIGNATURE_URL,
  UPDATE_FEED_URL
} from '../shared/update'
import {
  isAllowedReleaseUrl,
  parseUpdateManifest
} from './updateVerifier'
import type { NotificationController } from './notifications'
import type { SettingsStore } from './store'

type Listener = (state: UpdateState) => void

const STARTUP_DELAY_MS = 8_000
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000

export class UpdateController {
  private readonly settings: SettingsStore
  private readonly notifications: NotificationController
  private readonly listeners = new Set<Listener>()
  private state: UpdateState
  private launchTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private checking = false
  private disposed = false

  constructor(settings: SettingsStore, notifications: NotificationController) {
    this.settings = settings
    this.notifications = notifications
    this.state = {
      phase: settings.autoCheckUpdates ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseUrl: null,
      notice: null,
      message: null,
      autoCheck: settings.autoCheckUpdates,
      dismissed: false,
      noticeSeen: false,
      lastCheckedAt: null
    }
  }

  start(): void {
    if (this.settings.autoCheckUpdates) {
      this.launchTimer = setTimeout(() => {
        void this.check(false)
      }, STARTUP_DELAY_MS)
      this.intervalTimer = setInterval(() => {
        void this.check(false)
      }, CHECK_INTERVAL_MS)
    }
    this.emit()
  }

  dispose(): void {
    this.disposed = true
    if (this.launchTimer) clearTimeout(this.launchTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.launchTimer = null
    this.intervalTimer = null
    this.listeners.clear()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): UpdateState {
    return { ...this.state, notice: this.state.notice ? { ...this.state.notice } : null }
  }

  async check(manual: boolean): Promise<UpdateActionResult> {
    if (this.checking) {
      return { ok: false, message: 'An update check is already running.' }
    }
    if (!manual && !this.settings.autoCheckUpdates) {
      return { ok: false, message: 'Automatic update checks are disabled.' }
    }

    this.checking = true
    this.state = {
      ...this.state,
      phase: 'checking',
      message: manual ? 'Checking for updates…' : this.state.message
    }
    this.emit()

    try {
      const [manifestResponse, signatureResponse] = await Promise.all([
        fetchWithTimeout(UPDATE_FEED_URL),
        fetchWithTimeout(UPDATE_FEED_SIGNATURE_URL)
      ])

      if (!manifestResponse.ok || !signatureResponse.ok) {
        throw new Error(
          `The update feed returned HTTP ${manifestResponse.status}/${signatureResponse.status}.`
        )
      }

      const payload = Buffer.from(await manifestResponse.arrayBuffer())
      const signature = Buffer.from(
        (await signatureResponse.text()).trim(),
        'base64'
      )
      if (signature.length !== 64) {
        throw new Error('The update signature has an invalid length.')
      }

      const parsed = parseUpdateManifest(
        payload,
        signature,
        app.getVersion()
      )
      const manifest = parsed.manifest
      const available = parsed.available
      const dismissed =
        available && this.settings.dismissedUpdateVersion === manifest.version
      const notice =
        manifest.notice &&
        manifest.notice.id !== this.settings.lastSeenNoticeId
          ? manifest.notice
          : null

      if (available && !dismissed) {
        if (this.settings.lastNotifiedUpdateVersion !== manifest.version) {
          this.notifications.notifyUpdateAvailable(manifest.version, () => {
            if (isAllowedReleaseUrl(manifest.releaseUrl)) {
              void shell.openExternal(manifest.releaseUrl)
            }
          })
          this.settings.markUpdateNotified(manifest.version)
        }
      }

      this.state = {
        phase: available ? 'available' : notice ? 'notice' : 'upToDate',
        currentVersion: app.getVersion(),
        latestVersion: manifest.version,
        releaseUrl: manifest.releaseUrl,
        notice,
        message: available
          ? `ShieldBar ${manifest.version} is available.`
          : notice
            ? notice.title
            : 'ShieldBar is up to date.',
        autoCheck: this.settings.autoCheckUpdates,
        dismissed,
        noticeSeen: !notice,
        lastCheckedAt: Date.now()
      }
      this.emit()

      return {
        ok: true,
        message: this.state.message ?? ''
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The update check failed.'
      this.state = {
        ...this.state,
        phase: 'error',
        message,
        autoCheck: this.settings.autoCheckUpdates,
        lastCheckedAt: Date.now()
      }
      this.emit()
      return { ok: false, message }
    } finally {
      this.checking = false
    }
  }

  dismiss(): void {
    if (this.state.notice) {
      this.settings.markNoticeSeen(this.state.notice.id)
    }
    if (this.state.latestVersion) {
      this.settings.dismissUpdateVersion(this.state.latestVersion)
    }
    this.state = {
      ...this.state,
      notice: null,
      noticeSeen: true,
      dismissed: true
    }
    this.emit()
  }

  openRelease(): void {
    const url = this.state.notice?.url ?? this.state.releaseUrl
    if (url && isAllowedReleaseUrl(url)) {
      void shell.openExternal(url)
    }
  }

  setAutoCheck(value: boolean): UpdateState {
    this.settings.setAutoCheckUpdates(value)

    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.launchTimer) clearTimeout(this.launchTimer)
    this.intervalTimer = null
    this.launchTimer = null

    if (value) {
      this.intervalTimer = setInterval(() => {
        void this.check(false)
      }, CHECK_INTERVAL_MS)
      if (this.state.phase === 'idle' || this.state.phase === 'disabled') {
        void this.check(false)
      }
    }

    this.state = {
      ...this.state,
      autoCheck: value,
      phase:
        !value && (this.state.phase === 'idle' || this.state.phase === 'checking')
          ? 'disabled'
          : this.state.phase
    }
    this.emit()
    return this.getState()
  }

  private emit(): void {
    if (this.disposed || !this.listeners.size) return
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return await net.fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    },
    signal: AbortSignal.timeout(15_000)
  })
}
