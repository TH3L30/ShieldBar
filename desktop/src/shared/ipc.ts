import type { BrowserLeaksReport, ShieldStatus, StatusEvaluation } from '../core/models'

export interface ShieldState {
  status: ShieldStatus
  evaluation: StatusEvaluation
  report: BrowserLeaksReport | null
  lastCheckedAt: number | null
  nextCheckAt: number | null
  isChecking: boolean
  lastError: string | null
  notifyOnLeak: boolean
  showWelcome: boolean
}

export interface ShieldBarAPI {
  getState: () => Promise<ShieldState>
  refresh: () => void
  openFullReport: () => void
  openBrowserLeaks: () => void
  setNotify: (value: boolean) => Promise<boolean>
  dismissWelcome: () => Promise<void>
  showAbout: () => void
  copyText: (text: string) => Promise<void>
  setHeight: (height: number) => void
  hide: () => void
  quit: () => void
  onState: (callback: (state: ShieldState) => void) => () => void
}

export const IPC_CHANNELS = {
  getState: 'shieldbar:get-state',
  refresh: 'shieldbar:refresh',
  openFullReport: 'shieldbar:open-full-report',
  openBrowserLeaks: 'shieldbar:open-browserleaks',
  setNotify: 'shieldbar:set-notify',
  dismissWelcome: 'shieldbar:dismiss-welcome',
  showAbout: 'shieldbar:show-about',
  copyText: 'shieldbar:copy-text',
  setHeight: 'shieldbar:set-height',
  hide: 'shieldbar:hide',
  quit: 'shieldbar:quit',
  state: 'shieldbar:state'
} as const
