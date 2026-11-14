import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  shell
} from 'electron'
import { join } from 'node:path'
import { BROWSERLEAKS_URL, APP_ID } from '../shared/constants'
import { IPC_CHANNELS, type ShieldState } from '../shared/ipc'
import {
  DEFAULT_PROTECTION_SETTINGS,
  type ProtectionSettings
} from '../shared/protection'
import { SettingsStore } from './store'
import { NotificationController } from './notifications'
import { TrayController } from './tray'
import { PopoverController } from './popover'
import { ReportWindowController } from './report'
import { Monitor } from './monitor'
import { ProtectionController } from './protection'
import { ProtectionWindowController } from './protectionWindow'
import { runSelfTest } from './selftest'
import { renderPreviews } from './previewRunner'

const SELF_TEST = process.argv.includes('--self-test')
const SMOKE_TEST = process.argv.includes('--smoke-test')
const RENDER_PREVIEW = process.argv.includes('--render-preview')
const CLI_MODE = SELF_TEST || SMOKE_TEST || RENDER_PREVIEW

let settings: SettingsStore | null = null
let monitor: Monitor | null = null
let tray: TrayController | null = null
let popover: PopoverController | null = null
let reportWindow: ReportWindowController | null = null
let protection: ProtectionController | null = null
let protectionWindow: ProtectionWindowController | null = null
let shuttingDown = false
let quitConfirmed = false
let quitPromptOpen = false

app.setName('ShieldBar')
app.setAppUserModelId(APP_ID)

if (RENDER_PREVIEW) {
  // CI runners have no stable GPU surface; software rendering makes
  // capturePage deterministic for the documentation screenshots.
  app.disableHardwareAcceleration()
}

let primaryInstance = true
if (!CLI_MODE) {
  primaryInstance = app.requestSingleInstanceLock()
  if (!primaryInstance) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      showPopover()
    })
  }
}

// A tray app stays alive when every window is hidden or closed.
app.on('window-all-closed', () => {
  /* keep running */
})

app.on('before-quit', (event) => {
  if (shuttingDown) return

  if (!quitConfirmed && (protection?.isArmed() || protection?.isTriggered())) {
    event.preventDefault()
    void confirmQuit()
    return
  }

  cleanup()
})

function cleanup(): void {
  if (shuttingDown) return
  shuttingDown = true
  protection?.shutdown()
  monitor?.shutdown()
  tray?.destroy()
  popover?.destroy()
  protectionWindow?.destroy()
  reportWindow?.destroy()
  protection = null
  monitor = null
  tray = null
  popover = null
  protectionWindow = null
  reportWindow = null
}

async function confirmQuit(): Promise<void> {
  if (quitPromptOpen) return
  quitPromptOpen = true

  try {
    const triggered = protection?.isTriggered() ?? false
    const armed = protection?.isArmed() ?? false
    if (!triggered && !armed) {
      quitConfirmed = true
      app.quit()
      return
    }

    const detail = triggered
      ? 'Networking is currently disabled by ShieldBar. Quitting will leave it disabled until you restore it from the helper or your operating system.'
      : 'Protection is armed. Quitting stops monitoring and disarms the kill switch.'

    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Quit ShieldBar?',
      message: triggered ? 'Your network is still disabled' : 'Kill switch is armed',
      detail,
      buttons: ['Keep ShieldBar Running', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })

    if (result.response !== 1) return

    if (armed) {
      await protection?.disarm()
    }
    quitConfirmed = true
    app.quit()
  } finally {
    quitPromptOpen = false
  }
}

function showPopover(): void {
  popover?.show(tray?.getBounds() ?? null)
}

function openFullReport(): void {
  popover?.hide()
  reportWindow?.present()
}

function currentState(): ShieldState | null {
  if (!monitor) return null
  return {
    ...monitor.getState(),
    ...(protection ? { protection: protection.summary() } : {})
  }
}

function broadcastUiState(): void {
  const state = currentState()
  if (!state) return
  tray?.update(state, state.protection)
  popover?.sendState(state)
}

function openProtectionWindow(): void {
  popover?.hide()
  protectionWindow?.present()
  if (protection) {
    protectionWindow?.sendState(protection.getState())
    void protection.refreshHelper()
  }
}

async function restoreFromTray(): Promise<void> {
  if (!protection) return
  const result = await protection.restoreNetwork()
  if (!result.ok) {
    void dialog.showMessageBox({
      type: 'error',
      title: 'Could not restore networking',
      message: 'ShieldBar could not restore every network interface.',
      detail: result.message,
      buttons: ['OK'],
      noLink: true
    })
  }
}

function showAbout(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: 'About ShieldBar',
    message: 'ShieldBar',
    detail: [
      `Version ${app.getVersion()}`,
      '',
      'Public IP and WebRTC leak monitor for Windows and Linux.',
      '',
      'IP address and WebRTC data are provided by browserleaks.com. ShieldBar is not affiliated with BrowserLeaks.',
      '',
      'Checks run through bundled Chromium. No browsing history or IP history is stored.'
    ].join('\n'),
    buttons: ['OK'],
    defaultId: 0,
    noLink: true
  })
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getState, () => {
    const state = currentState()
    if (!state) throw new Error('ShieldBar is not ready.')
    return state
  })

  ipcMain.on(IPC_CHANNELS.refresh, () => {
    monitor?.checkNow()
  })

  ipcMain.on(IPC_CHANNELS.openFullReport, () => {
    openFullReport()
  })

  ipcMain.on(IPC_CHANNELS.openBrowserLeaks, () => {
    void shell.openExternal(BROWSERLEAKS_URL)
  })

  ipcMain.handle(IPC_CHANNELS.setNotify, (_event, value: unknown) => {
    if (!monitor) return false
    return monitor.setNotifyOnLeak(Boolean(value))
  })

  ipcMain.handle(IPC_CHANNELS.dismissWelcome, () => {
    monitor?.dismissWelcome()
  })

  ipcMain.on(IPC_CHANNELS.showAbout, () => {
    showAbout()
  })

  ipcMain.handle(IPC_CHANNELS.copyText, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })

  ipcMain.on(IPC_CHANNELS.setHeight, (_event, height: unknown) => {
    if (typeof height === 'number') popover?.setContentHeight(height)
  })

  ipcMain.on(IPC_CHANNELS.hide, () => {
    popover?.hide()
  })

  ipcMain.on(IPC_CHANNELS.quit, () => {
    app.quit()
  })

  ipcMain.handle(IPC_CHANNELS.getProtectionState, () => {
    if (!protection) throw new Error('Protection is not ready.')
    return protection.getState()
  })

  ipcMain.handle(IPC_CHANNELS.installHelper, async () => {
    if (!protection) return { ok: false, message: 'Protection is not ready.' }
    return await protection.installHelper()
  })

  ipcMain.handle(IPC_CHANNELS.uninstallHelper, async () => {
    if (!protection) return { ok: false, message: 'Protection is not ready.' }
    return await protection.uninstallHelper()
  })

  ipcMain.handle(IPC_CHANNELS.setProtectionBaseline, () => {
    if (!protection) return { ok: false, message: 'Protection is not ready.' }
    return protection.setBaseline()
  })

  ipcMain.handle(
    IPC_CHANNELS.armProtection,
    async (
      _event,
      options: { acknowledgeRemote?: boolean; acknowledgeNoVpn?: boolean }
    ) => {
      if (!protection) return { ok: false, message: 'Protection is not ready.' }
      return await protection.arm({
        acknowledgeRemote: Boolean(options?.acknowledgeRemote),
        acknowledgeNoVpn: Boolean(options?.acknowledgeNoVpn)
      })
    }
  )

  ipcMain.handle(IPC_CHANNELS.disarmProtection, async () => {
    if (!protection) return { ok: false, message: 'Protection is not ready.' }
    return await protection.disarm()
  })

  ipcMain.handle(IPC_CHANNELS.restoreNetwork, async () => {
    if (!protection) return { ok: false, message: 'Protection is not ready.' }
    return await protection.restoreNetwork()
  })

  ipcMain.handle(
    IPC_CHANNELS.updateProtectionSettings,
    (_event, patch: unknown) => {
      if (!protection) throw new Error('Protection is not ready.')
      return protection.updateSettings(
        patch && typeof patch === 'object'
          ? (patch as Partial<ProtectionSettings>)
          : {}
      )
    }
  )

  ipcMain.on(IPC_CHANNELS.openProtection, () => {
    openProtectionWindow()
  })
}

async function startApplication(): Promise<void> {
  settings = new SettingsStore()
  reportWindow = new ReportWindowController()
  popover = new PopoverController({
    onVisibilityChange: (open) => monitor?.setPopoverOpen(open)
  })

  const notifications = new NotificationController(() => {
    showPopover()
  })

  monitor = new Monitor(settings, notifications)
  protection = new ProtectionController(settings, monitor, notifications)
  protectionWindow = new ProtectionWindowController()

  tray = new TrayController({
    onToggle: () => {
      popover?.toggle(tray?.getBounds() ?? null)
    },
    onRefresh: () => {
      monitor?.checkNow()
    },
    onOpenReport: () => {
      openFullReport()
    },
    onToggleNotifications: () => {
      monitor?.toggleNotifications()
    },
    onOpenProtection: () => {
      openProtectionWindow()
    },
    onRestoreNetwork: () => {
      void restoreFromTray()
    },
    onAbout: () => {
      showAbout()
    },
    onQuit: () => {
      app.quit()
    }
  })

  monitor.subscribe(() => {
    broadcastUiState()
  })

  protection.subscribe((protectionState) => {
    protectionWindow?.sendState(protectionState)
    broadcastUiState()
  })

  await protection.initialize()
  broadcastUiState()
  registerIpc()
  monitor.start()

  if (monitor.getState().showWelcome && !protection.isTriggered()) {
    setTimeout(() => {
      if (monitor?.getState().showWelcome) showPopover()
    }, 900)
  }
}

async function runSmokeTest(): Promise<number> {
  ipcMain.handle(IPC_CHANNELS.getState, () => ({
    status: 'idle',
    evaluation: {
      status: 'idle',
      headline: 'Not checked yet',
      detail: 'Click Refresh to run the first BrowserLeaks check.',
      publicMismatch: [],
      localExposed: [],
      publicAddresses: [],
      pageAddresses: []
    },
    report: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    isChecking: false,
    lastError: null,
    notifyOnLeak: true,
    showWelcome: false
  }))

  ipcMain.handle(IPC_CHANNELS.getProtectionState, () => ({
    phase: 'ready',
    armed: false,
    triggered: false,
    beta: true,
    message: null,
    lastTrigger: null,
    baselineLabel: 'Canada',
    helperInstalled: true,
    helperVersion: '1.1.0',
    settings: { ...DEFAULT_PROTECTION_SETTINGS, enabled: true },
    baseline: {
      label: 'Canada',
      fields: ['country'],
      capturedAt: Date.now()
    },
    vpnAdapters: [{ name: 'utun3', likelyVpn: true }],
    remoteSession: { detected: false, kind: null },
    lastCheckedAt: Date.now(),
    currentStatus: 'clear',
    currentHeadline: 'Clear',
    canSetBaseline: true,
    canArm: true
  }))

  const window = new BrowserWindow({
    width: 760,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await window.loadFile(join(__dirname, '../renderer/index.html'))
    let dashboardReady = false
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        dashboardReady = (await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('main.card')) && typeof window.shieldbar?.getState === 'function'`
        )) as boolean
        if (dashboardReady) break
      } catch {
        /* React may still be mounting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    if (!dashboardReady) {
      process.stderr.write('SMOKE FAIL: the dashboard did not become ready.\n')
      return 1
    }

    await window.loadFile(join(__dirname, '../renderer/protection.html'))
    let protectionReady = false
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        protectionReady = (await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.protection-shell')) && Boolean(document.querySelector('h1'))`
        )) as boolean
        if (protectionReady) break
      } catch {
        /* React may still be mounting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    if (!protectionReady) {
      process.stderr.write('SMOKE FAIL: the protection window did not become ready.\n')
      return 1
    }

    process.stdout.write(
      'SMOKE PASS: dashboard and protection renderers mounted; preload bridge is available.\n'
    )
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`SMOKE FAIL: ${message}\n`)
    return 1
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

function previewDirectory(): string | undefined {
  const index = process.argv.indexOf('--render-preview')
  if (index === -1) return undefined
  const candidate = process.argv[index + 1]
  if (!candidate || candidate.startsWith('--')) return undefined
  return candidate
}

if (primaryInstance) {
  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null)

      if (process.platform === 'darwin') {
        app.dock?.hide()
      }

      if (SELF_TEST) {
        const code = await runSelfTest()
        app.exit(code)
        return
      }

      if (RENDER_PREVIEW) {
        const code = await renderPreviews(previewDirectory())
        app.exit(code)
        return
      }

      if (SMOKE_TEST) {
        const code = await runSmokeTest()
        app.exit(code)
        return
      }

      await startApplication()
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error)
      process.stderr.write(`ShieldBar failed to start: ${message}\n`)
      app.exit(1)
    })
}
