import { net, powerMonitor } from 'electron'
import type {
  BrowserLeaksReport,
  ShieldStatus,
  StatusEvaluation
} from '../core/models'
import {
  CHECKING_EVALUATION,
  IDLE_EVALUATION,
  pageAddresses,
  reportLocalAddresses,
  reportPublicAddresses
} from '../core/models'
import { StatusEvaluator } from '../core/evaluator'
import { checkIntervalMs } from '../core/schedule'
import type { ShieldState } from '../shared/ipc'
import { NETWORK_POLL_MS } from '../shared/constants'
import { BrowserLeaksProbe } from './probe'
import type { SettingsStore } from './store'
import type { NotificationController } from './notifications'

type StateListener = (state: ShieldState) => void

export interface MonitorOptions {
  probe?: BrowserLeaksProbe
  onState?: StateListener
}

/**
 * Owns the check cadence and the single source of truth for the tray, the
 * popover, and the report window. Mirrors the macOS Monitor semantics:
 * 30s while the popover is open, 15min in the background, 60s while offline.
 */
export class Monitor {
  private readonly probe: BrowserLeaksProbe
  private readonly listeners = new Set<StateListener>()
  private readonly settings: SettingsStore
  private readonly notifications: NotificationController

  private status: ShieldStatus = 'idle'
  private evaluation: StatusEvaluation = IDLE_EVALUATION
  private report: BrowserLeaksReport | null = null
  private lastCheckedAt: number | null = null
  private nextCheckAt: number | null = null
  private isChecking = false
  private lastError: string | null = null
  private showWelcome: boolean
  private popoverOpen = false

  private timer: NodeJS.Timeout | null = null
  private networkTimer: NodeJS.Timeout | null = null
  private lastNetworkAvailable: boolean | null = null
  private lastKnownStatus: ShieldStatus | null = null
  private pendingCheck = false
  private hasStarted = false
  private stopped = false

  private onResume = (): void => {
    // Give VPN and DHCP routes a moment to settle after wake.
    setTimeout(() => this.checkNow(), 2_000)
  }

  constructor(
    settings: SettingsStore,
    notifications: NotificationController,
    options: MonitorOptions = {}
  ) {
    this.settings = settings
    this.notifications = notifications
    this.probe = options.probe ?? new BrowserLeaksProbe()
    this.showWelcome = !settings.hasSeenWelcome
    if (options.onState) this.listeners.add(options.onState)
  }

  getState(): ShieldState {
    return {
      status: this.status,
      evaluation: this.evaluation,
      report: this.report,
      lastCheckedAt: this.lastCheckedAt,
      nextCheckAt: this.nextCheckAt,
      isChecking: this.isChecking,
      lastError: this.lastError,
      notifyOnLeak: this.settings.notifyOnLeak,
      showWelcome: this.showWelcome
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.hasStarted || this.stopped) return
    this.hasStarted = true

    this.lastNetworkAvailable = this.isNetworkAvailable()
    this.networkTimer = setInterval(
      () => this.pollNetwork(),
      NETWORK_POLL_MS
    )
    powerMonitor.on('resume', this.onResume)

    this.checkNow()
  }

  shutdown(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.networkTimer) clearInterval(this.networkTimer)
    this.timer = null
    this.networkTimer = null
    powerMonitor.removeListener('resume', this.onResume)
    this.listeners.clear()
  }

  checkNow(): void {
    if (!this.hasStarted || this.stopped) return

    if (this.isChecking) {
      this.pendingCheck = true
      return
    }

    if (!this.isNetworkAvailable()) {
      this.setOffline('No network connection.')
      this.scheduleNext()
      return
    }

    this.isChecking = true
    this.status = 'checking'
    this.evaluation = CHECKING_EVALUATION
    this.lastError = null
    this.nextCheckAt = null
    this.clearTimer()
    this.emit()

    const previousStatus = this.lastKnownStatus

    void this.runProbe(previousStatus)
  }

  setPopoverOpen(open: boolean): void {
    if (this.popoverOpen === open) return
    this.popoverOpen = open

    if (open) {
      const age = this.lastCheckedAt
        ? Date.now() - this.lastCheckedAt
        : Number.POSITIVE_INFINITY
      if (!this.isChecking && age > 8_000) {
        this.checkNow()
      } else {
        this.scheduleNext()
      }
    } else {
      this.scheduleNext()
    }
  }

  setNotifyOnLeak(value: boolean): boolean {
    this.settings.setNotifyOnLeak(value)
    this.emit()
    return this.settings.notifyOnLeak
  }

  toggleNotifications(): boolean {
    return this.setNotifyOnLeak(!this.settings.notifyOnLeak)
  }

  dismissWelcome(): void {
    if (!this.showWelcome) return
    this.showWelcome = false
    this.settings.markWelcomeSeen()
    this.emit()
  }

  relativeAge(since: number, now: number = Date.now()): string {
    const seconds = Math.max(0, Math.floor((now - since) / 1000))
    if (seconds < 5) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  tooltip(): string {
    const parts = [`ShieldBar — ${this.evaluation.headline}`]
    if (this.report?.pageIPv4) parts.push(this.report.pageIPv4)
    if (this.lastCheckedAt) {
      parts.push(`checked ${this.relativeAge(this.lastCheckedAt)}`)
    }
    return parts.join(' · ')
  }

  private async runProbe(previousStatus: ShieldStatus | null): Promise<void> {
    try {
      const report = await this.probe.probe()
      if (this.stopped) return

      this.report = report
      this.lastCheckedAt = report.checkedAt

      const evaluation = StatusEvaluator.evaluate(report)
      this.evaluation = evaluation
      this.status = evaluation.status
      this.lastKnownStatus = evaluation.status
      this.notifyIfNeeded(previousStatus, evaluation.status)
    } catch (error) {
      if (this.stopped) return
      const message =
        error instanceof Error ? error.message : 'The BrowserLeaks check failed.'
      this.lastError = message
      this.status = 'offline'
      this.evaluation = this.offlineEvaluation(message)
      this.lastKnownStatus = 'offline'
    }

    this.isChecking = false
    this.scheduleNext()
    this.emit()

    if (this.pendingCheck) {
      this.pendingCheck = false
      this.checkNow()
    }
  }

  private pollNetwork(): void {
    const available = this.isNetworkAvailable()
    const previous = this.lastNetworkAvailable
    this.lastNetworkAvailable = available

    if (!available) {
      // Only react to the transition. Rescheduling on every poll would keep
      // pushing the offline retry timer forward and it would never fire.
      if (!this.isChecking && this.status !== 'offline') {
        this.setOffline('No network connection. ShieldBar will retry automatically.')
        this.scheduleNext()
        this.emit()
      }
      return
    }

    if (previous === false) {
      setTimeout(() => this.checkNow(), 1_500)
    }
  }

  private isNetworkAvailable(): boolean {
    try {
      return net.isOnline()
    } catch {
      return true
    }
  }

  private scheduleNext(): void {
    this.clearTimer()

    if (!this.hasStarted || this.stopped || this.isChecking) {
      this.nextCheckAt = null
      return
    }

    const interval = checkIntervalMs({
      status: this.status,
      isNetworkAvailable: this.isNetworkAvailable(),
      popoverOpen: this.popoverOpen
    })

    this.nextCheckAt = Date.now() + interval
    this.timer = setTimeout(() => this.checkNow(), interval)
    this.emit()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private setOffline(message: string): void {
    this.lastError = message
    this.status = 'offline'
    this.evaluation = this.offlineEvaluation(message)
    this.lastKnownStatus = 'offline'
  }

  private offlineEvaluation(message: string): StatusEvaluation {
    return {
      status: 'offline',
      headline: 'Offline',
      detail: message,
      publicMismatch: [],
      localExposed: this.report ? reportLocalAddresses(this.report) : [],
      publicAddresses: this.report ? reportPublicAddresses(this.report) : [],
      pageAddresses: this.report ? pageAddresses(this.report) : []
    }
  }

  private notifyIfNeeded(
    previous: ShieldStatus | null,
    current: ShieldStatus
  ): void {
    if (!this.settings.notifyOnLeak) return
    if (current !== 'publicLeak') return
    if (previous === null || previous === 'publicLeak') return
    this.notifications.notifyPublicLeak()
  }

  private emit(): void {
    if (!this.listeners.size) return
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }
}
