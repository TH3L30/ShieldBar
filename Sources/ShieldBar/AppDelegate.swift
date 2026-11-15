import AppKit
import Darwin
import Foundation
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private lazy var monitor = Monitor()
    private lazy var protection = ProtectionController(monitor: monitor)
    private lazy var updates = UpdateController(monitor: monitor)
    private var statusBarController: StatusBarController?
    private var fullReportController: FullReportWindowController?
    private var protectionWindowController: ProtectionWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildMainMenu()

        if CommandLine.arguments.contains("--restore-network") {
            restoreNetworkFromCLI()
            return
        }

        if CommandLine.arguments.contains("--check-updates") {
            Task {
                let controller = UpdateController(monitor: monitor)
                let result = await controller.check(manual: true)
                print("Update check: \(result.message)")
                print("Version: \(controller.viewState.currentVersion) · phase: \(controller.viewState.phase.rawValue)")
                exit(result.ok ? 0 : 1)
            }
            return
        }

        if CommandLine.arguments.contains("--self-test") {
            SelfTest.run()
            return
        }

        if let previewIndex = CommandLine.arguments.firstIndex(of: "--render-preview") {
            let path: String
            if previewIndex + 1 < CommandLine.arguments.count {
                path = CommandLine.arguments[previewIndex + 1]
            } else {
                path = NSTemporaryDirectory() + "ShieldBar-Preview"
            }
            PreviewRenderer.run(directoryPath: path)
            return
        }

        let statusBar = StatusBarController(
            monitor: monitor,
            protection: protection,
            updates: updates
        )
        statusBar.onOpenFullReport = { [weak self] in
            self?.openFullReport()
        }
        statusBar.onOpenProtection = { [weak self] in
            self?.openProtection()
        }
        statusBar.onRestoreNetwork = { [weak self] in
            self?.restoreNetworkFromUI()
        }
        statusBar.onCheckForUpdates = { [weak self] in
            self?.checkForUpdates()
        }
        statusBarController = statusBar

        monitor.onNotificationTap = { [weak self] in
            guard let self else { return }
            if self.protection.isTriggered {
                self.openProtection()
            } else {
                self.statusBarController?.showPopover()
            }
        }

        monitor.start()
        protection.start()
        updates.start()

        if monitor.showWelcome, !protection.isTriggered {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak statusBar] in
                statusBar?.showPopover()
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self, self.protection.isTriggered else { return }
            self.openProtection()
        }

        if CommandLine.arguments.contains("--open-protection") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                self?.openProtection()
            }
        }
    }

    func applicationShouldTerminate(
        _ sender: NSApplication
    ) -> NSApplication.TerminateReply {
        if protection.isTriggered {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "Your network is still disabled"
            alert.informativeText = "Quitting ShieldBar will leave networking disabled until you restore it from the helper or your operating system."
            alert.addButton(withTitle: "Keep ShieldBar Running")
            alert.addButton(withTitle: "Quit")
            return alert.runModal() == .alertFirstButtonReturn ? .terminateCancel : .terminateNow
        }

        if protection.isArmed {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Kill switch is armed"
            alert.informativeText = "Quitting stops monitoring and disarms the kill switch."
            alert.addButton(withTitle: "Keep ShieldBar Running")
            alert.addButton(withTitle: "Quit and Disarm")
            if alert.runModal() == .alertFirstButtonReturn {
                return .terminateCancel
            }
            _ = protection.disarm()
        }

        return .terminateNow
    }

    private func openProtection() {
        if protectionWindowController == nil {
            protectionWindowController = ProtectionWindowController(controller: protection)
        }
        protectionWindowController?.present()
    }

    private func restoreNetworkFromUI() {
        Task {
            let result = await protection.restoreNetwork()
            if !result.ok {
                let alert = NSAlert()
                alert.alertStyle = .critical
                alert.messageText = "Could not restore networking"
                alert.informativeText = result.message
                alert.addButton(withTitle: "OK")
                alert.runModal()
            }
        }
    }

    private func checkForUpdates() {
        Task {
            let result = await updates.check(manual: true)
            let state = updates.viewState

            if !result.ok {
                let alert = NSAlert()
                alert.alertStyle = .warning
                alert.messageText = "Could not check for updates"
                alert.informativeText = result.message
                alert.addButton(withTitle: "OK")
                alert.runModal()
                return
            }

            if state.updateAvailable, let version = state.latestVersion {
                let alert = NSAlert()
                alert.alertStyle = .informational
                alert.messageText = "ShieldBar \(version) is available"
                alert.informativeText = "ShieldBar does not install updates automatically. Open the release page to download it."
                alert.addButton(withTitle: "View Release")
                alert.addButton(withTitle: "Later")
                if alert.runModal() == .alertFirstButtonReturn {
                    updates.openRelease()
                }
                return
            }

            if let notice = state.notice {
                let alert = NSAlert()
                alert.alertStyle = notice.severity == .critical ? .critical : .informational
                alert.messageText = notice.title
                alert.informativeText = notice.message
                alert.addButton(withTitle: notice.url == nil ? "OK" : "View Release")
                if notice.url != nil, alert.runModal() == .alertFirstButtonReturn {
                    updates.openRelease()
                }
                return
            }

            let alert = NSAlert()
            alert.alertStyle = .informational
            alert.messageText = "ShieldBar is up to date"
            alert.informativeText = "You are running ShieldBar \(state.currentVersion)."
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    private func restoreNetworkFromCLI() {
        Task {
            do {
                let response = try await HelperClient().restore()
                let message = response.message ?? (response.ok ? "Networking restored." : "Restore failed.")
                print(message)
                exit(response.ok ? 0 : 1)
            } catch {
                FileHandle.standardError.write(
                    Data("FAIL: \(error.localizedDescription)\n".utf8)
                )
                exit(1)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func openFullReport() {
        if fullReportController == nil {
            fullReportController = FullReportWindowController()
        }
        fullReportController?.present()
    }

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About ShieldBar",
            action: #selector(showAboutPanel),
            keyEquivalent: ""
        ).target = self
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Hide ShieldBar",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit ShieldBar",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(
            withTitle: "Undo",
            action: Selector(("undo:")),
            keyEquivalent: "z"
        )
        editMenu.addItem(
            withTitle: "Redo",
            action: Selector(("redo:")),
            keyEquivalent: "Z"
        )
        editMenu.addItem(.separator())
        editMenu.addItem(
            withTitle: "Cut",
            action: #selector(NSText.cut(_:)),
            keyEquivalent: "x"
        )
        editMenu.addItem(
            withTitle: "Copy",
            action: #selector(NSText.copy(_:)),
            keyEquivalent: "c"
        )
        editMenu.addItem(
            withTitle: "Paste",
            action: #selector(NSText.paste(_:)),
            keyEquivalent: "v"
        )
        editMenu.addItem(
            withTitle: "Select All",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        editMenuItem.submenu = editMenu

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(
            withTitle: "Close",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        windowMenuItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    @objc private func showAboutPanel() {
        let credits = NSAttributedString(
            string: "IP address and WebRTC data from browserleaks.com.\nShieldBar is not affiliated with BrowserLeaks.\n\nChecks run through an embedded WebKit view. No history is stored.",
            attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: NSColor.secondaryLabelColor
            ]
        )
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }
}
