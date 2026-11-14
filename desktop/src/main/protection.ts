import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { ShieldState } from '../shared/ipc'
import {
  DEFAULT_PROTECTION_SETTINGS,
  protectionTriggerLabel,
  type LocationField,
  type ProtectionActionResult,
  type ProtectionPhase,
  type ProtectionSettings,
  type ProtectionState,
  type ProtectionSummary,
  type ProtectionTrigger,
  type RemoteSession,
  type VpnAdapter
} from '../shared/protection'
import {
  baselineLabel,
  createBaseline,
  evaluateProtection,
  hasLikelyVpn,
  normalizeSettings,
  vpnAdapters,
  type BaselineInternal
} from '../core/protection'
import {
  LOCATION_CONFIRM_MS,
  PROTECTION_INTERFACE_POLL_MS
} from '../shared/constants'
import { HelperClient } from './helperClient'
import {
  installProtectionHelper,
  uninstallProtectionHelper
} from './helperInstall'
import { applyStartAtLogin } from './loginItem'
import type { Monitor } from './monitor'
import type { NotificationController } from './notifications'
import type { SettingsStore } from './store'

type Listener = (state: ProtectionState) => void

interface ArmOptions {
  acknowledgeRemote: boolean
  acknowledgeNoVpn: boolean
}

export class ProtectionController {
  private readonly settingsStore: SettingsStore
  private readonly monitor: Monitor
  private readonly notifications: NotificationController
  private readonly helper: HelperClient
  private readonly listeners = new Set<Listener>()
  private readonly salt = randomBytes(24).toString('hex')

  private settings: ProtectionSettings
  private baseline: BaselineInternal | null = null
  private phase: ProtectionPhase = 'unavailable'
  private armed = false
  private triggered = false
  private message: string | null = null
  private lastTrigger: ProtectionTrigger | null = null
  private helperInstalled = false
  private helperVersion: string | null = null
  private latestState: ShieldState
  private lastEvaluatedAt: number | null = null
  private pendingLocationConfirm = false
  private confirmTimer: NodeJS.Timeout | null = null
  private interfaceTimer: NodeJS.Timeout | null = null
  private lastInterfaceSignature = ''
  private remoteCache: { at: number; value: RemoteSession } | null = null
  private unsubscribeMonitor: () => void

  constructor(
    settingsStore: SettingsStore,
    monitor: Monitor,
    notifications: NotificationController,
    helper: HelperClient = new HelperClient()
  ) {
    this.settingsStore = settingsStore
    this.monitor = monitor
    this.notifications = notifications
    this.helper = helper
    this.settings = settingsStore.protectionSettings
    this.latestState = monitor.getState()
    this.unsubscribeMonitor = monitor.subscribe((state) => {
      this.onMonitorState(state)
    })
  }

  async initialize(): Promise<void> {
    applyStartAtLogin(this.settings.startAtLogin)
    await this.refreshHelper()
    this.emit()
  }

  shutdown(): void {
    this.clearConfirmTimer()
    this.stopInterfacePolling()
    this.unsubscribeMonitor()
    this.listeners.clear()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): ProtectionState {
    const adapters = this.interfaceNames()
    return {
      ...this.summary(),
      helperInstalled: this.helperInstalled,
      helperVersion: this.helperVersion,
      settings: { ...this.settings },
      baseline: this.baseline
        ? {
            label: baselineLabel(this.baseline, this.settings.locationFields),
            fields: [...this.settings.locationFields],
            capturedAt: this.baseline.capturedAt
          }
        : null,
      vpnAdapters: vpnAdapters(adapters),
      remoteSession: this.detectRemoteSession(),
      lastCheckedAt: this.latestState.lastCheckedAt,
      currentStatus: this.latestState.status,
      currentHeadline: this.latestState.evaluation.headline,
      canSetBaseline:
        this.settings.enabled &&
        this.latestState.status === 'clear' &&
        Boolean(this.latestState.report),
      canArm:
        this.settings.enabled &&
        this.helperInstalled &&
        Boolean(this.baseline) &&
        this.latestState.status === 'clear' &&
        !this.armed &&
        !this.triggered
    }
  }

  summary(): ProtectionSummary {
    return {
      phase: this.phase,
      armed: this.armed,
      triggered: this.triggered,
      beta: true,
      message: this.message,
      lastTrigger: this.lastTrigger,
      baselineLabel: this.baseline
        ? baselineLabel(this.baseline, this.settings.locationFields)
        : null
    }
  }

  isArmed(): boolean {
    return this.armed
  }

  isTriggered(): boolean {
    return this.triggered
  }

  async installHelper(): Promise<ProtectionActionResult> {
    if (this.triggered) {
      const restored = await this.restoreNetwork()
      if (!restored.ok) {
        return {
          ok: false,
          message: `Restore networking before reinstalling: ${restored.message}`
        }
      }
    }
    if (this.armed) {
      await this.disarm()
    }

    const result = await installProtectionHelper()
    if (result.ok) {
      await this.refreshHelper()
      this.message = result.message
    } else {
      this.phase = 'unavailable'
      this.message = result.message
    }
    this.emit()
    return result
  }

  async uninstallHelper(): Promise<ProtectionActionResult> {
    if (this.triggered) {
      const restored = await this.restoreNetwork()
      if (!restored.ok) {
        return {
          ok: false,
          message: `Restore networking before uninstalling: ${restored.message}`
        }
      }
    }
    if (this.armed) {
      await this.disarm()
    }

    const result = await uninstallProtectionHelper()
    if (result.ok) {
      this.helperInstalled = false
      this.helperVersion = null
      this.phase = 'unavailable'
      this.message = result.message
    } else {
      this.message = result.message
    }
    this.emit()
    return result
  }

  setBaseline(): ProtectionActionResult {
    if (!this.settings.enabled) {
      return { ok: false, message: 'Enable Protection first.' }
    }
    const report = this.latestState.report
    if (!report || this.latestState.status !== 'clear') {
      return {
        ok: false,
        message: 'Run a check and wait for a Clear result before setting a baseline.'
      }
    }

    const result = createBaseline(
      report,
      this.settings.locationFields,
      this.salt
    )
    if (!result.baseline) {
      return {
        ok: false,
        message: `BrowserLeaks did not return: ${result.missing.join(', ')}.`
      }
    }

    this.baseline = result.baseline
    this.message = 'Baseline captured for this session.'
    this.emit()
    return { ok: true, message: this.message }
  }

  async arm(options: ArmOptions): Promise<ProtectionActionResult> {
    if (!this.settings.enabled) {
      return { ok: false, message: 'Enable Protection first.' }
    }
    if (!this.helperInstalled) {
      return { ok: false, message: 'Install the protection helper first.' }
    }
    if (this.triggered) {
      return {
        ok: false,
        message: 'Networking is disabled. Restore it before arming again.'
      }
    }
    if (this.armed) {
      return { ok: true, message: 'Protection is already armed.' }
    }
    if (!this.baseline) {
      return { ok: false, message: 'Set a safe baseline before arming.' }
    }

    const state = this.latestState
    if (state.isChecking) {
      return { ok: false, message: 'Wait for the current check to finish.' }
    }
    if (state.status !== 'clear' || !state.report) {
      return {
        ok: false,
        message: 'Arming requires a known Clear result and a captured baseline.'
      }
    }

    const remote = this.detectRemoteSession()
    if (remote.detected && !options.acknowledgeRemote) {
      return {
        ok: false,
        message: `Remote session detected (${remote.kind ?? 'remote'}). Confirm the risk first.`
      }
    }

    const adapters = vpnAdapters(this.interfaceNames())
    if (!hasLikelyVpn(this.interfaceNames()) && !options.acknowledgeNoVpn) {
      return {
        ok: false,
        message: 'No VPN adapter was detected. Confirm that your VPN is connected.'
      }
    }

    this.armed = true
    this.triggered = false
    this.phase = 'armed'
    this.message = `Armed · ${baselineLabel(this.baseline, this.settings.locationFields)}`
    this.lastEvaluatedAt = null
    this.pendingLocationConfirm = false
    this.monitor.setProtectionArmed(true)
    this.monitor.checkNow()
    this.startInterfacePolling()
    this.emit()

    return { ok: true, message: this.message }
  }

  async disarm(): Promise<ProtectionActionResult> {
    if (!this.armed) {
      return { ok: true, message: 'Protection is not armed.' }
    }

    this.armed = false
    this.pendingLocationConfirm = false
    this.lastEvaluatedAt = null
    this.clearConfirmTimer()
    this.stopInterfacePolling()
    this.monitor.setProtectionArmed(false)
    this.phase = this.helperInstalled ? 'ready' : 'unavailable'
    this.message = 'Protection disarmed.'
    this.emit()
    return { ok: true, message: this.message }
  }

  async restoreNetwork(): Promise<ProtectionActionResult> {
    if (!this.triggered) {
      return { ok: true, message: 'Networking was not disabled.' }
    }

    this.phase = 'restoring'
    this.message = 'Restoring network interfaces…'
    this.emit()

    try {
      const response = await this.helper.restore()
      if (!response.ok) {
        this.phase = 'triggered'
        this.message = response.message ?? 'Could not restore all interfaces.'
        this.emit()
        return { ok: false, message: this.message }
      }

      this.triggered = false
      this.armed = false
      this.phase = 'ready'
      this.lastTrigger = null
      this.baseline = null
      this.message = 'Networking restored. Set a new baseline before arming again.'
      this.monitor.setProtectionArmed(false)
      this.monitor.checkNow()
      this.emit()
      return { ok: true, message: this.message }
    } catch (error) {
      this.phase = 'triggered'
      this.message =
        error instanceof Error ? error.message : 'Could not restore networking.'
      this.emit()
      return { ok: false, message: this.message }
    }
  }

  updateSettings(patch: Partial<ProtectionSettings>): ProtectionSettings {
    const previous = this.settings
    const next = normalizeSettings(
      { ...this.settings, ...patch },
      DEFAULT_PROTECTION_SETTINGS
    )

    if (!next.enabled && this.armed) {
      void this.disarm()
    }
    if (!sameFields(previous.locationFields, next.locationFields)) {
      if (this.armed) {
        void this.disarm()
      }
      this.baseline = null
    }
    if (previous.startAtLogin !== next.startAtLogin) {
      applyStartAtLogin(next.startAtLogin)
    }

    this.settings = next
    this.settingsStore.setProtectionSettings(next)
    this.emit()
    return { ...this.settings }
  }

  async refreshHelper(): Promise<void> {
    try {
      const response = await this.helper.status()
      if (!response.ok) {
        this.helperInstalled = false
        this.helperVersion = null
        if (!this.triggered) this.phase = 'unavailable'
        this.message = response.message ?? 'Protection helper is unavailable.'
        return
      }

      this.helperInstalled = true
      this.helperVersion = response.version ?? null

      if (response.triggered) {
        this.triggered = true
        this.armed = false
        this.phase = 'triggered'
        this.message =
          'Networking is currently disabled by ShieldBar. Restore it before arming.'
        this.pendingLocationConfirm = false
        this.clearConfirmTimer()
        this.stopInterfacePolling()
        this.monitor.setProtectionArmed(false)
      } else if (!this.triggered) {
        this.phase = this.armed ? 'armed' : 'ready'
        if (!this.armed) this.message = null
      }
    } catch {
      this.helperInstalled = false
      this.helperVersion = null
      if (!this.triggered) {
        this.phase = this.armed ? 'error' : 'unavailable'
      }
      this.message = this.armed
        ? 'Protection helper became unavailable while armed.'
        : 'Install the protection helper to enable the kill switch.'
    }
    this.emit()
  }

  private onMonitorState(state: ShieldState): void {
    this.latestState = state

    if (!this.armed || this.triggered || state.isChecking) return
    if (state.lastCheckedAt === null) return
    if (state.lastCheckedAt === this.lastEvaluatedAt) return

    if (state.status === 'offline' || !state.report) {
      this.lastEvaluatedAt = state.lastCheckedAt
      this.message = 'Protection degraded: BrowserLeaks is unreachable.'
      this.emit()
      return
    }

    const result = evaluateProtection(
      state.report,
      state.status,
      this.settings,
      this.baseline,
      this.salt
    )

    if (result.trigger === 'publicLeak' || result.trigger === 'localExposure' || result.trigger === 'inconclusive') {
      this.lastEvaluatedAt = state.lastCheckedAt
      void this.triggerKill(result.trigger)
      return
    }

    if (result.trigger === 'locationChange') {
      if (this.pendingLocationConfirm) {
        this.lastEvaluatedAt = state.lastCheckedAt
        void this.triggerKill('locationChange')
        return
      }

      this.pendingLocationConfirm = true
      this.lastEvaluatedAt = state.lastCheckedAt
      this.message = 'Location change detected. Confirming in 2 seconds…'
      this.emit()
      this.clearConfirmTimer()
      this.confirmTimer = setTimeout(() => {
        if (this.armed && !this.triggered) {
          this.monitor.checkNow()
        }
      }, LOCATION_CONFIRM_MS)
      return
    }

    if (this.pendingLocationConfirm) {
      this.pendingLocationConfirm = false
      this.message = null
    }
    this.lastEvaluatedAt = state.lastCheckedAt
  }

  private async triggerKill(reason: ProtectionTrigger): Promise<void> {
    if (!this.armed || this.triggered) return

    this.phase = 'triggering'
    this.message = 'Disabling all network interfaces…'
    this.emit()

    let lastMessage = 'The protection helper did not respond.'
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.helper.disable()
        if (response.triggered) {
          this.triggered = true
          this.armed = false
          this.phase = 'triggered'
          this.lastTrigger = reason
          this.baseline = null
          this.pendingLocationConfirm = false
          this.clearConfirmTimer()
          this.stopInterfacePolling()
          this.monitor.setProtectionArmed(false)
          this.message = response.ok
            ? `Network disabled: ${protectionTriggerLabel(reason)}.`
            : `Network disabled with errors: ${response.message ?? 'some interfaces may still be up.'}`
          this.notifications.notifyProtectionTriggered(reason)
          this.emit()
          return
        }
        lastMessage = response.message ?? lastMessage
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error)
      }

      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    }

    this.phase = 'error'
    this.message = `Could not disable networking: ${lastMessage}`
    this.emit()
  }

  private startInterfacePolling(): void {
    this.stopInterfacePolling()
    this.lastInterfaceSignature = this.interfaceSignature()
    this.interfaceTimer = setInterval(() => {
      const next = this.interfaceSignature()
      if (next === this.lastInterfaceSignature) return
      this.lastInterfaceSignature = next
      this.monitor.checkNow()
      this.emit()
    }, PROTECTION_INTERFACE_POLL_MS)
  }

  private stopInterfacePolling(): void {
    if (this.interfaceTimer) clearInterval(this.interfaceTimer)
    this.interfaceTimer = null
  }

  private clearConfirmTimer(): void {
    if (this.confirmTimer) clearTimeout(this.confirmTimer)
    this.confirmTimer = null
  }

  private interfaceNames(): string[] {
    return Object.keys(os.networkInterfaces()).filter(
      (name) => !/^(lo|lo0)$/i.test(name)
    )
  }

  private interfaceSignature(): string {
    return this.interfaceNames().sort().join('|')
  }

  private detectRemoteSession(): RemoteSession {
    if (this.remoteCache && Date.now() - this.remoteCache.at < 30_000) {
      return this.remoteCache.value
    }

    let value: RemoteSession = { detected: false, kind: null }
    if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
      value = { detected: true, kind: 'SSH' }
    } else if (
      process.platform === 'win32' &&
      (process.env.SESSIONNAME ?? '').toUpperCase().startsWith('RDP-')
    ) {
      value = { detected: true, kind: 'RDP' }
    } else if (process.platform !== 'win32') {
      const names = ['screensharingd', 'ARDAgent', 'vncserver', 'Xvnc', 'tvnserver']
      for (const name of names) {
        try {
          execFileSync('pgrep', ['-x', name], {
            stdio: 'ignore',
            timeout: 400
          })
          value = { detected: true, kind: 'screen sharing' }
          break
        } catch {
          /* process not found */
        }
      }
    }

    this.remoteCache = { at: Date.now(), value }
    return value
  }

  private emit(): void {
    if (!this.listeners.size) return
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}

function sameFields(a: LocationField[], b: LocationField[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}
