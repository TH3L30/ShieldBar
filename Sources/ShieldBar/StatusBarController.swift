import AppKit
import Combine
import SwiftUI

@MainActor
final class StatusBarController: NSObject, NSPopoverDelegate {
    var onOpenFullReport: (() -> Void)?
    var onOpenProtection: (() -> Void)?
    var onRestoreNetwork: (() -> Void)?

    private let monitor: Monitor
    private let protection: ProtectionController
    private let statusItem: NSStatusItem
    private let popover = NSPopover()
    private var hostingController: NSHostingController<DashboardView>?
    private var cancellables = Set<AnyCancellable>()
    private var lastPopoverClose: Date?

    init(monitor: Monitor, protection: ProtectionController) {
        self.monitor = monitor
        self.protection = protection
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        configureStatusItem()
        configurePopover()
        observeMonitor()
        observeProtection()
    }

    func showPopover() {
        guard !popover.isShown else { return }
        if let lastPopoverClose, Date().timeIntervalSince(lastPopoverClose) < 0.25 {
            return
        }
        guard let button = statusItem.button else { return }

        monitor.setPopoverOpen(true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        activateApp()
    }

    func hidePopover() {
        guard popover.isShown else { return }
        popover.performClose(nil)
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        button.image = MenuBarIcon.image(for: .idle)
        button.imagePosition = .imageOnly
        button.imageScaling = .scaleProportionallyDown
        button.target = self
        button.action = #selector(statusItemClicked)
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.toolTip = monitor.menuBarTooltip
        button.setAccessibilityLabel("ShieldBar")
        button.setAccessibilityHelp("Click to see the current BrowserLeaks IP and WebRTC status.")
    }

    private func configurePopover() {
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self

        let actions = DashboardActions(
            openFullReport: { [weak self] in
                guard let self else { return }
                self.hidePopover()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
                    self?.onOpenFullReport?()
                }
            },
            quit: {
                NSApp.terminate(nil)
            },
            showAbout: {
                NSApp.orderFrontStandardAboutPanel(nil)
            },
            openBrowserLeaks: {
                NSWorkspace.shared.open(URL(string: "https://browserleaks.com/ip")!)
            }
        )

        let view = DashboardView(monitor: monitor, actions: actions)
        let hosting = NSHostingController(rootView: view)
        hosting.sizingOptions = [.preferredContentSize]
        hostingController = hosting
        popover.contentViewController = hosting
    }

    private func observeMonitor() {
        monitor.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.refreshStatusItem()
                }
            }
            .store(in: &cancellables)
    }

    private func observeProtection() {
        protection.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.refreshStatusItem()
                }
            }
            .store(in: &cancellables)
    }

    func refreshProtection() {
        refreshStatusItem()
    }

    private func refreshStatusItem() {
        guard let button = statusItem.button else { return }
        let triggered = protection.viewState.triggered
        let armed = protection.viewState.armed

        if triggered {
            button.image = MenuBarIcon.image(for: .publicLeak)
            button.toolTip = "ShieldBar — NETWORK DISABLED by protection. Restore from the menu."
            button.setAccessibilityLabel("ShieldBar: network disabled")
            button.setAccessibilityHelp("Protection triggered and disabled networking. Restore from the menu.")
            return
        }

        button.image = MenuBarIcon.image(for: monitor.status)
        var tooltip = monitor.menuBarTooltip
        if armed {
            tooltip += " · Protection armed"
        }
        button.toolTip = tooltip
        button.setAccessibilityLabel("ShieldBar: \(monitor.status.shortLabel)\(armed ? ", protection armed" : "")")
        button.setAccessibilityHelp(monitor.status.accessibilityDescription)
    }

    @objc private func statusItemClicked() {
        if let event = NSApp.currentEvent,
           event.type == .rightMouseUp || event.modifierFlags.contains(.control) {
            showContextMenu()
            return
        }

        if popover.isShown {
            hidePopover()
        } else {
            showPopover()
        }
    }

    private func showContextMenu() {
        if popover.isShown {
            hidePopover()
        }

        let menu = NSMenu()

        if protection.viewState.triggered {
            menu.addItem(
                withTitle: "Restore Network",
                action: #selector(restoreNetwork),
                keyEquivalent: ""
            ).target = self
            menu.addItem(.separator())
        }

        menu.addItem(
            withTitle: monitor.isChecking ? "Checking…" : "Refresh Now",
            action: #selector(refreshNow),
            keyEquivalent: ""
        ).target = self
        menu.addItem(.separator())
        menu.addItem(
            withTitle: "Open Full BrowserLeaks Report…",
            action: #selector(openFullReport),
            keyEquivalent: ""
        ).target = self
        menu.addItem(.separator())

        let protectionTitle: String
        if protection.viewState.triggered {
            protectionTitle = "Protection (Network Disabled)…"
        } else if protection.viewState.armed {
            protectionTitle = "Protection (Armed)…"
        } else {
            protectionTitle = "Protection…"
        }
        menu.addItem(
            withTitle: protectionTitle,
            action: #selector(openProtection),
            keyEquivalent: ""
        ).target = self

        let notifyItem = NSMenuItem(
            title: "Notify on Public Leaks",
            action: #selector(toggleNotifications),
            keyEquivalent: ""
        )
        notifyItem.target = self
        notifyItem.state = monitor.notifyOnLeak ? .on : .off
        menu.addItem(notifyItem)

        menu.addItem(.separator())
        menu.addItem(
            withTitle: "About ShieldBar",
            action: #selector(showAbout),
            keyEquivalent: ""
        ).target = self
        menu.addItem(
            withTitle: "Quit ShieldBar",
            action: #selector(quit),
            keyEquivalent: "q"
        ).target = self

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func refreshNow() {
        monitor.checkNow()
    }

    @objc private func openFullReport() {
        onOpenFullReport?()
    }

    @objc private func openProtection() {
        onOpenProtection?()
    }

    @objc private func restoreNetwork() {
        onRestoreNetwork?()
    }

    @objc private func toggleNotifications() {
        monitor.toggleNotifications()
    }

    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(nil)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func activateApp() {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    // MARK: - NSPopoverDelegate

    func popoverDidClose(_ notification: Notification) {
        lastPopoverClose = Date()
        monitor.setPopoverOpen(false)
    }
}

struct DashboardActions {
    var openFullReport: () -> Void
    var quit: () -> Void
    var showAbout: () -> Void
    var openBrowserLeaks: () -> Void
}
