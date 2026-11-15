import { Notification } from 'electron'
import {
  protectionTriggerLabel,
  type ProtectionTrigger
} from '../shared/protection'

/**
 * Leak-only notifications. The body never contains an IP address, and nothing
 * is sent when notifications are unavailable.
 */
export class NotificationController {
  private readonly active = new Set<Notification>()
  private readonly onClick: () => void

  constructor(onClick: () => void) {
    this.onClick = onClick
  }

  isSupported(): boolean {
    return Notification.isSupported()
  }

  notifyPublicLeak(): void {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: 'ShieldBar: public IP leak',
      body: 'WebRTC sees a different public IP than BrowserLeaks. Open ShieldBar for details.',
      silent: false,
      timeoutType: 'default'
    })

    this.active.add(notification)

    const forget = (): void => {
      this.active.delete(notification)
    }

    notification.on('click', () => {
      forget()
      this.onClick()
    })
    notification.on('close', forget)
    notification.on('failed', forget)
    notification.show()
  }

  notifyUpdateAvailable(version: string, onOpen: () => void): void {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: `ShieldBar ${version} is available`,
      body: 'Open the release page to download the new version. Update alerts never download or install anything automatically.',
      silent: false,
      timeoutType: 'default'
    })

    this.active.add(notification)
    const forget = (): void => {
      this.active.delete(notification)
    }
    notification.on('click', () => {
      forget()
      onOpen()
    })
    notification.on('close', forget)
    notification.on('failed', forget)
    notification.show()
  }

  notifyProtectionTriggered(trigger: ProtectionTrigger): void {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: 'ShieldBar disabled networking',
      body: `Protection triggered by ${protectionTriggerLabel(trigger)}. Open ShieldBar to restore your connection.`,
      silent: false,
      timeoutType: 'never'
    })

    this.active.add(notification)
    const forget = (): void => {
      this.active.delete(notification)
    }
    notification.on('click', () => {
      forget()
      this.onClick()
    })
    notification.on('close', forget)
    notification.on('failed', forget)
    notification.show()
  }
}
