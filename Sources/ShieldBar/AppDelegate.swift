import AppKit
import Foundation
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private lazy var monitor = Monitor()
    private var statusBarController: StatusBarController?
    private var fullReportController: FullReportWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildMainMenu()

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

        let statusBar = StatusBarController(monitor: monitor)
        statusBar.onOpenFullReport = { [weak self] in
            self?.openFullReport()
        }
        statusBarController = statusBar
        monitor.start()

        if monitor.showWelcome {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak statusBar] in
                statusBar?.showPopover()
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
