import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../shared/ipc'
import type { ProtectionState } from '../shared/protection'

export class ProtectionWindowController {
  private window: BrowserWindow | null = null
  private pendingState: ProtectionState | null = null
  private rendererReady = false

  present(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }

    const window = new BrowserWindow({
      width: 720,
      height: 820,
      minWidth: 620,
      minHeight: 560,
      show: false,
      title: 'ShieldBar Protection',
      autoHideMenuBar: true,
      backgroundColor: '#f4f4f6',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })

    this.window = window
    this.rendererReady = false

    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })

    window.on('closed', () => {
      this.window = null
      this.rendererReady = false
    })

    window.webContents.on('did-finish-load', () => {
      this.rendererReady = true
      if (this.pendingState) {
        window.webContents.send(IPC_CHANNELS.protectionState, this.pendingState)
        this.pendingState = null
      }
    })

    void window.loadFile(join(__dirname, '../renderer/protection.html'))
  }

  sendState(state: ProtectionState): void {
    if (!this.window || this.window.isDestroyed()) {
      this.pendingState = state
      return
    }
    if (!this.rendererReady) {
      this.pendingState = state
      return
    }
    this.window.webContents.send(IPC_CHANNELS.protectionState, state)
  }

  isShown(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible())
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }
}
