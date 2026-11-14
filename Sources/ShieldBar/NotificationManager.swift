import Foundation
import UserNotifications

final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    var onTap: (() -> Void)?

    private var isRunningInAppBundle: Bool {
        Bundle.main.bundleURL.pathExtension == "app"
    }

    override init() {
        super.init()
    }

    func activate() {
        guard isRunningInAppBundle else { return }
        UNUserNotificationCenter.current().delegate = self
    }

    func requestAuthorizationIfNeeded() {
        guard isRunningInAppBundle else { return }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    func notifyPublicLeak() {
        guard isRunningInAppBundle else { return }
        let content = UNMutableNotificationContent()
        content.title = "ShieldBar: public IP leak"
        content.body = "WebRTC sees a different public IP than BrowserLeaks. Open ShieldBar for details."
        content.sound = .default
        content.threadIdentifier = "shieldbar-public-leak"

        let request = UNNotificationRequest(
            identifier: "shieldbar.public-leak.\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func cancelLeakNotifications() {
        guard isRunningInAppBundle else { return }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [
            "shieldbar.public-leak"
        ])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            DispatchQueue.main.async { [weak self] in
                self?.onTap?()
            }
        }
        completionHandler()
    }
}
