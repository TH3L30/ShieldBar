import { app, Menu, Tray, nativeImage } from 'electron'
import type { MenuItemConstructorOptions, Rectangle } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ShieldState } from '../shared/ipc'
import type { ShieldStatus } from '../core/models'
import { shortStatusLabel } from '../core/models'
import type { ProtectionSummary } from '../shared/protection'

type TrayImageName = ShieldStatus | 'armed' | 'killed'

export interface TrayActions {
  onToggle: () => void
  onRefresh: () => void
  onOpenReport: () => void
  onToggleNotifications: () => void
  onOpenProtection: () => void
  onRestoreNetwork: () => void
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

  update(state: ShieldState, protection?: ProtectionSummary): void {
    this.state = state

    const imageName: TrayImageName = protection?.triggered
      ? 'killed'
      : protection?.armed
        ? 'armed'
        : state.status
    const image = this.statusImage(imageName)
    try {
      this.tray.setImage(image)
    } catch {
      /* keep the previous icon if the platform rejects the image */
    }

    this.tray.setToolTip(this.buildTooltip(state, protection))
    this.tray.setContextMenu(this.buildMenu(state, protection))
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

  private statusImage(status: TrayImageName): Electron.NativeImage {
    const trayDirectory = join(resourcesDirectory(), 'tray')

    try {
      const image = nativeImage.createEmpty()
      const representations: Array<[number, number]> = [
        [16, 1],
        [32, 2],
        [48, 3]
      ]

      for (const [size, scaleFactor] of representations) {
        const buffer = readFileSync(join(trayDirectory, `${status}-${size}.png`))
        image.addRepresentation({
          scaleFactor,
          width: size,
          height: size,
          buffer
        })
      }

      if (!image.isEmpty()) return image
    } catch {
      /* fall through to the single-file fallback */
    }

    const fallbackPath = join(trayDirectory, `${status}-32.png`)
    let image = nativeImage.createFromPath(fallbackPath)
    if (image.isEmpty()) {
      image = nativeImage.createFromPath(join(resourcesDirectory(), 'icon.png'))
    }
    return image
  }

  private buildTooltip(
    state: ShieldState,
    protection?: ProtectionSummary
  ): string {
    if (protection?.triggered) {
      return 'ShieldBar — NETWORK DISABLED by protection. Restore from the tray menu.'
    }

    const parts = [`ShieldBar — ${state.evaluation.headline}`]
    if (protection?.armed) parts.push('Protection armed')
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

  private buildMenu(
    state: ShieldState | null,
    protection?: ProtectionSummary
  ): Menu {
    const checking = state?.isChecking ?? false
    const notify = state?.notifyOnLeak ?? true
    const status = state?.status ?? 'idle'

    const template: MenuItemConstructorOptions[] = []

    if (protection?.triggered) {
      template.push(
        {
          label: 'Restore Network',
          click: () => this.actions.onRestoreNetwork()
        },
        { type: 'separator' }
      )
    }

    template.push(
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
        label: protection?.armed
          ? 'Protection (Armed)…'
          : protection?.triggered
            ? 'Protection (Network Disabled)…'
            : 'Protection…',
        click: () => this.actions.onOpenProtection()
      },
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
    )

    return Menu.buildFromTemplate(template)
  }
}
