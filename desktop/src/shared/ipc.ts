import type { BrowserLeaksReport, ShieldStatus, StatusEvaluation } from '../core/models'
import type {
  ProtectionActionResult,
  ProtectionSettings,
  ProtectionState,
  ProtectionSummary
} from './protection'
import type {
  UpdateActionResult,
  UpdateState
} from './update'

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
  protection?: ProtectionSummary
  update?: UpdateState
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

  getProtectionState: () => Promise<ProtectionState>
  installHelper: () => Promise<ProtectionActionResult>
  uninstallHelper: () => Promise<ProtectionActionResult>
  setProtectionBaseline: () => Promise<ProtectionActionResult>
  armProtection: (options: {
    acknowledgeRemote: boolean
    acknowledgeNoVpn: boolean
  }) => Promise<ProtectionActionResult>
  disarmProtection: () => Promise<ProtectionActionResult>
  restoreNetwork: () => Promise<ProtectionActionResult>
  updateProtectionSettings: (
    patch: Partial<ProtectionSettings>
  ) => Promise<ProtectionSettings>
  openProtection: () => void
  onProtectionState: (
    callback: (state: ProtectionState) => void
  ) => () => void

  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateActionResult>
  dismissUpdate: () => Promise<UpdateState>
  openUpdateRelease: () => void
  setAutoCheckUpdates: (value: boolean) => Promise<UpdateState>
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
  state: 'shieldbar:state',
  getProtectionState: 'shieldbar:get-protection-state',
  installHelper: 'shieldbar:install-helper',
  uninstallHelper: 'shieldbar:uninstall-helper',
  setProtectionBaseline: 'shieldbar:set-protection-baseline',
  armProtection: 'shieldbar:arm-protection',
  disarmProtection: 'shieldbar:disarm-protection',
  restoreNetwork: 'shieldbar:restore-network',
  updateProtectionSettings: 'shieldbar:update-protection-settings',
  openProtection: 'shieldbar:open-protection',
  protectionState: 'shieldbar:protection-state',
  getUpdateState: 'shieldbar:get-update-state',
  checkForUpdates: 'shieldbar:check-for-updates',
  dismissUpdate: 'shieldbar:dismiss-update',
  openUpdateRelease: 'shieldbar:open-update-release',
  setAutoCheckUpdates: 'shieldbar:set-auto-check-updates'
} as const
