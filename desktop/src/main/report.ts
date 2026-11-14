import { BrowserWindow, Menu, session, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { BROWSERLEAKS_URL, REPORT_PARTITION } from '../shared/constants'
import { chromeUserAgent } from './userAgent'

function isBrowserLeaksUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'browserleaks.com' ||
        url.hostname.endsWith('.browserleaks.com'))
    )
  } catch {
    return false
  }
}

/**
 * Full BrowserLeaks report in a normal window with restricted navigation. It
 * uses an in-memory session, and external links open in the default browser.
 */
export class ReportWindowController {
  private window: BrowserWindow | null = null
  private previousMenu: Menu | null = null

  present(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      if (!this.window.webContents.isLoading()) {
        this.window.reload()
      }
      return
    }

    const window = new BrowserWindow({
      width: 1080,
      height: 820,
      minWidth: 720,
      minHeight: 500,
      show: false,
      title: 'BrowserLeaks Report',
      autoHideMenuBar: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: REPORT_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false
      }
    })

    this.window = window
    this.installMenu()

    const reportSession = session.fromPartition(REPORT_PARTITION)
    reportSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    )
    reportSession.setPermissionCheckHandler(() => false)

    window.webContents.setUserAgent(chromeUserAgent())
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isBrowserLeaksUrl(url)) {
        window.loadURL(url)
      } else if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    window.webContents.on('will-navigate', (event, url) => {
      if (!isBrowserLeaksUrl(url)) {
        event.preventDefault()
        if (url.startsWith('https://') || url.startsWith('http://')) {
          void shell.openExternal(url)
        }
      }
    })

    window.webContents.on('did-start-loading', () => {
      window.setProgressBar(2)
    })

    window.webContents.on('did-stop-loading', () => {
      window.setProgressBar(-1)
    })

    window.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
    })

    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })

    window.on('closed', () => {
      this.window = null
      Menu.setApplicationMenu(this.previousMenu)
      this.previousMenu = null
    })

    void window
      .loadURL(BROWSERLEAKS_URL, {
        extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n'
      })
      .catch(() => {
        /* the page shows Chromium's own network error */
      })
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  private installMenu(): void {
    this.previousMenu = Menu.getApplicationMenu()

    const closeItem: MenuItemConstructorOptions = {
      label: 'Close',
      accelerator: 'CmdOrCtrl+W',
      click: () => this.window?.close()
    }

    const template: MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [closeItem]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => this.window?.reload()
          },
          {
            label: 'Open in Browser',
            click: () => {
              void shell.openExternal(BROWSERLEAKS_URL)
            }
          }
        ]
      }
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }
}
