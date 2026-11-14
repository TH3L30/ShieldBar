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
import { IPC_CHANNELS } from '../shared/ipc'
import { SettingsStore } from './store'
import { NotificationController } from './notifications'
import { TrayController } from './tray'
import { PopoverController } from './popover'
import { ReportWindowController } from './report'
import { Monitor } from './monitor'
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
let shuttingDown = false

app.setName('ShieldBar')
app.setAppUserModelId(APP_ID)

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

app.on('before-quit', () => {
  if (shuttingDown) return
  shuttingDown = true
  monitor?.shutdown()
  tray?.destroy()
  popover?.destroy()
  reportWindow?.destroy()
  tray = null
  popover = null
  reportWindow = null
  monitor = null
})

function showPopover(): void {
  popover?.show(tray?.getBounds() ?? null)
}

function openFullReport(): void {
  popover?.hide()
  reportWindow?.present()
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
    if (!monitor) throw new Error('ShieldBar is not ready.')
    return monitor.getState()
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
}

function startApplication(): void {
  settings = new SettingsStore()
  reportWindow = new ReportWindowController()
  popover = new PopoverController({
    onVisibilityChange: (open) => monitor?.setPopoverOpen(open)
  })

  const notifications = new NotificationController(() => {
    showPopover()
  })

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
    onAbout: () => {
      showAbout()
    },
    onQuit: () => {
      app.quit()
    }
  })

  monitor = new Monitor(settings, notifications)

  monitor.subscribe((state) => {
    tray?.update(state)
    popover?.sendState(state)
  })

  tray.update(monitor.getState())
  registerIpc()
  monitor.start()

  if (monitor.getState().showWelcome) {
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

  const window = new BrowserWindow({
    width: 386,
    height: 760,
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

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const ready = (await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('main.card')) && typeof window.shieldbar?.getState === 'function'`
        )) as boolean
        if (ready) {
          process.stdout.write(
            'SMOKE PASS: renderer mounted and preload bridge is available.\n'
          )
          return 0
        }
      } catch {
        /* React may still be mounting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    process.stderr.write('SMOKE FAIL: the dashboard did not become ready.\n')
    return 1
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

      startApplication()
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error)
      process.stderr.write(`ShieldBar failed to start: ${message}\n`)
      app.exit(1)
    })
}
