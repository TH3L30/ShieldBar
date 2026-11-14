import { Notification } from 'electron'

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
}
