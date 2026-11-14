import { app, Menu, Tray, nativeImage } from 'electron'
import type { MenuItemConstructorOptions, Rectangle } from 'electron'
import { join } from 'node:path'
import type { ShieldState } from '../shared/ipc'
import type { ShieldStatus } from '../core/models'
import { shortStatusLabel } from '../core/models'

export interface TrayActions {
  onToggle: () => void
  onRefresh: () => void
  onOpenReport: () => void
  onToggleNotifications: () => void
  onAbout: () => void
  onQuit: () => void
}

function resourcesDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources')
}

export class TrayController {
  private readonly tray: Tray
  private readonly actions: TrayActions
  private state: ShieldState | null = null

  constructor(actions: TrayActions) {
    this.actions = actions
    this.tray = new Tray(this.statusImage('idle'))
    this.tray.setToolTip('ShieldBar')

    this.tray.on('click', () => this.actions.onToggle())
    this.tray.on('double-click', () => this.actions.onToggle())
    this.tray.setContextMenu(this.buildMenu(null))
  }

  update(state: ShieldState): void {
    this.state = state

    const image = this.statusImage(state.status)
    try {
      this.tray.setImage(image)
    } catch {
      /* keep the previous icon if the platform rejects the image */
    }

    this.tray.setToolTip(this.buildTooltip(state))
    this.tray.setContextMenu(this.buildMenu(state))
  }

  getBounds(): Rectangle | null {
    try {
      const bounds = this.tray.getBounds()
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
      return bounds
    } catch {
      return null
    }
  }

  destroy(): void {
    this.tray.destroy()
  }

  private statusImage(status: ShieldStatus): Electron.NativeImage {
    const name = `${status}-32.png`
    const trayPath = join(resourcesDirectory(), 'tray', name)
    let image = nativeImage.createFromPath(trayPath)
    if (image.isEmpty()) {
      const fallback = join(resourcesDirectory(), 'icon.png')
      image = nativeImage.createFromPath(fallback)
    }
    return image
  }

  private buildTooltip(state: ShieldState): string {
    const parts = [`ShieldBar — ${state.evaluation.headline}`]
    if (state.report?.pageIPv4) parts.push(state.report.pageIPv4)
    if (state.lastCheckedAt) {
      parts.push(`checked ${this.relativeAge(state.lastCheckedAt)}`)
    }
    return parts.join(' · ')
  }

  private relativeAge(timestamp: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    if (seconds < 5) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  private buildMenu(state: ShieldState | null): Menu {
    const checking = state?.isChecking ?? false
    const notify = state?.notifyOnLeak ?? true
    const status = state?.status ?? 'idle'

    const template: MenuItemConstructorOptions[] = [
      {
        label: `Open ShieldBar (${shortStatusLabel(status)})`,
        click: () => this.actions.onToggle()
      },
      {
        label: checking ? 'Checking…' : 'Refresh Now',
        enabled: !checking,
        click: () => this.actions.onRefresh()
      },
      {
        label: 'Open Full BrowserLeaks Report…',
        click: () => this.actions.onOpenReport()
      },
      { type: 'separator' },
      {
        label: 'Notify on Public Leaks',
        type: 'checkbox',
        checked: notify,
        click: () => this.actions.onToggleNotifications()
      },
      { type: 'separator' },
      {
        label: 'About ShieldBar',
        click: () => this.actions.onAbout()
      },
      {
        label: 'Quit ShieldBar',
        click: () => this.actions.onQuit()
      }
    ]

    return Menu.buildFromTemplate(template)
  }
}
