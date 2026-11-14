import { BrowserWindow, screen } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'node:path'
import {
  POPOVER_MAX_HEIGHT,
  POPOVER_MIN_HEIGHT,
  POPOVER_WIDTH
} from '../shared/constants'
import { IPC_CHANNELS, type ShieldState } from '../shared/ipc'

export interface PopoverOptions {
  onVisibilityChange?: (open: boolean) => void
}

/**
 * Frameless popover anchored to the tray icon. It is created lazily and hides
 * on blur, like an NSPopover. On Linux/Wayland, tray bounds can be empty, so
 * the cursor position is used as a fallback anchor.
 */
export class PopoverController {
  private readonly options: PopoverOptions
  private window: BrowserWindow | null = null
  private anchor: Rectangle | null = null
  private contentHeight = POPOVER_MIN_HEIGHT
  private wantsVisible = false
  private visible = false
  private rendererReady = false
  private pendingState: ShieldState | null = null
  private lastHiddenAt = 0
  private destroying = false

  constructor(options: PopoverOptions = {}) {
    this.options = options
  }

  show(anchor?: Rectangle | null): void {
    if (anchor) this.anchor = anchor
    this.wantsVisible = true

    const window = this.ensureWindow()
    if (!window) return

    this.positionWindow()

    if (window.isVisible()) {
      window.focus()
      return
    }

    if (window.webContents.isLoadingMainFrame()) {
      // ready-to-show reveals it once the dashboard has painted.
      return
    }

    this.reveal()
  }

  hide(): void {
    this.wantsVisible = false
    if (!this.window || this.window.isDestroyed()) return
    if (this.window.isVisible()) {
      this.window.hide()
    }
    this.markHidden()
  }

  toggle(anchor?: Rectangle | null): void {
    if (this.visible) {
      this.hide()
      return
    }

    // Clicking the tray while the popover is open triggers blur first. Ignore
    // the immediate click so it closes instead of instantly reopening.
    if (Date.now() - this.lastHiddenAt < 250) return
    this.show(anchor)
  }

  isShown(): boolean {
    return this.visible
  }

  sendState(state: ShieldState): void {
    if (!this.window || this.window.isDestroyed()) {
      this.pendingState = state
      return
    }

    if (!this.rendererReady) {
      this.pendingState = state
      return
    }

    this.window.webContents.send(IPC_CHANNELS.state, state)
  }

  setContentHeight(height: number): void {
    if (!Number.isFinite(height)) return

    const clamped = Math.round(
      Math.min(POPOVER_MAX_HEIGHT, Math.max(POPOVER_MIN_HEIGHT, height))
    )
    if (clamped === this.contentHeight) return

    this.contentHeight = clamped
    if (!this.window || this.window.isDestroyed()) return

    const bounds = this.window.getBounds()
    const next = this.positionFor(bounds.x, bounds.y, clamped)
    this.window.setBounds({ ...next, width: POPOVER_WIDTH, height: clamped }, false)
  }

  destroy(): void {
    this.destroying = true
    this.wantsVisible = false
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  private ensureWindow(): BrowserWindow | null {
    if (this.window && !this.window.isDestroyed()) return this.window

    const window = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: this.contentHeight,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })

    try {
      window.setAlwaysOnTop(true, 'pop-up-menu')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      /* optional window-manager features */
    }

    window.on('ready-to-show', () => {
      if (this.wantsVisible) this.reveal()
    })

    window.on('blur', () => {
      if (this.destroying) return
      if (window.webContents.isDevToolsOpened()) return
      this.hide()
    })

    window.on('close', (event) => {
      if (this.destroying) return
      event.preventDefault()
      this.hide()
    })

    window.on('closed', () => {
      this.window = null
      if (this.visible) {
        this.visible = false
        this.options.onVisibilityChange?.(false)
      }
    })

    window.webContents.on('did-finish-load', () => {
      this.rendererReady = true
      if (this.pendingState) {
        window.webContents.send(IPC_CHANNELS.state, this.pendingState)
        this.pendingState = null
      }
      if (this.wantsVisible && !this.visible) this.reveal()
    })

    window.webContents.on('did-fail-load', () => {
      process.stderr.write('ShieldBar: the popover renderer failed to load.\n')
    })

    void window.loadFile(join(__dirname, '../renderer/index.html'))
    this.window = window
    return window
  }

  private reveal(): void {
    const window = this.window
    if (!window || window.isDestroyed() || !this.wantsVisible) return

    this.positionWindow()
    window.show()
    window.focus()

    if (!this.visible) {
      this.visible = true
      this.options.onVisibilityChange?.(true)
    }
  }

  private markHidden(): void {
    this.lastHiddenAt = Date.now()
    if (!this.visible) return
    this.visible = false
    this.options.onVisibilityChange?.(false)
  }

  private positionWindow(): void {
    if (!this.window || this.window.isDestroyed()) return
    const bounds = this.window.getBounds()
    const next = this.positionFor(bounds.x, bounds.y, this.contentHeight)
    this.window.setBounds(
      { ...next, width: POPOVER_WIDTH, height: this.contentHeight },
      false
    )
  }

  private positionFor(
    _currentX: number,
    _currentY: number,
    height: number
  ): { x: number; y: number } {
    const anchor = this.anchor
    const fallback = screen.getCursorScreenPoint()
    const point = anchor
      ? { x: anchor.x + Math.round(anchor.width / 2), y: anchor.y }
      : { x: fallback.x, y: fallback.y }

    const display = screen.getDisplayNearestPoint(point)
    const area = display.workArea

    let x: number
    let y: number

    if (anchor && anchor.width > 0 && anchor.height > 0) {
      x = Math.round(anchor.x + anchor.width / 2 - POPOVER_WIDTH / 2)
      const trayInBottomHalf = anchor.y > area.y + area.height / 2
      y = trayInBottomHalf
        ? anchor.y - height - 6
        : anchor.y + anchor.height + 6
    } else {
      // No usable tray geometry (common on Wayland). Anchor near the cursor.
      x = fallback.x - Math.round(POPOVER_WIDTH / 2)
      const cursorInBottomHalf = fallback.y > area.y + area.height / 2
      y = cursorInBottomHalf ? fallback.y - height - 8 : fallback.y + 8
    }

    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - POPOVER_WIDTH - 8))
    y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8))

    return { x, y }
  }
}
