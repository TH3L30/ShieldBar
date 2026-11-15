import AppKit
import Foundation
import ShieldBarCore
import SwiftUI

/// Offscreen rendering used only by the developer preview flag.
/// It uses documentation-only IP ranges and never touches the network.
@MainActor
enum PreviewRenderer {
    static func run(directoryPath: String) {
        let directory = URL(fileURLWithPath: directoryPath, isDirectory: true)
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )

        let actions = DashboardActions(
            openFullReport: {},
            openProtection: {},
            restoreNetwork: {},
            quit: {},
            showAbout: {},
            openBrowserLeaks: {}
        )
        let previewProtection = ProtectionController(
            previewState: protectionPreviewState(triggered: false)
        )
        let previewUpdates = UpdateController(
            monitor: Monitor(previewReport: clearReport())
        )

        let previews: [(String, Monitor)] = [
            ("dashboard-clear", Monitor(previewReport: clearReport())),
            ("dashboard-leak", Monitor(previewReport: leakReport())),
            ("dashboard-local", Monitor(previewReport: localExposureReport())),
            ("dashboard-welcome", Monitor(
                previewReport: clearReport(),
                showWelcome: true,
                nextCheckIn: 24
            ))
        ]

        for (name, monitor) in previews {
            let view = DashboardView(
                monitor: monitor,
                protection: previewProtection,
                updates: previewUpdates,
                actions: actions
            )
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            renderer.proposedSize = ProposedViewSize(width: 386, height: nil)

            guard let image = renderer.nsImage,
                  let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                writeError("Could not render \(name)")
                continue
            }

            do {
                try png.write(to: directory.appendingPathComponent("\(name).png"))
                write("Rendered \(name).png")
            } catch {
                writeError("Could not write \(name): \(error.localizedDescription)")
            }
        }

        renderProtectionPreviews(to: directory)
        renderUpdatePreview(to: directory)
        renderIconSheet(to: directory.appendingPathComponent("menu-bar-icons.png"))

        write("Preview directory: \(directory.path)")
        fflush(stdout)
        exit(0)
    }

    private static func clearReport() -> BrowserLeaksReport {
        BrowserLeaksReport(
            pageIPv4: "203.0.113.42",
            pageIPv6: "2001:db8::42",
            countryCode: "CA",
            country: "Canada",
            region: "Ontario",
            city: "Toronto",
            isp: "Example ISP",
            organization: "Example Network",
            rtcSupported: true,
            rtcTestCompleted: true,
            rtcPublic: [WebRTCAddress(address: "203.0.113.42")],
            rtcLocalText: "n/a",
            rtcPublicText: "203.0.113.42",
            rtcLeakText: "✔ No Local IP Leak",
            checkedAt: Date().addingTimeInterval(-13),
            duration: 4.3
        )
    }

    private static func leakReport() -> BrowserLeaksReport {
        BrowserLeaksReport(
            pageIPv4: "203.0.113.42",
            pageIPv6: nil,
            countryCode: "CA",
            country: "Canada",
            region: "Ontario",
            city: "Toronto",
            isp: "Example ISP",
            organization: "Example Network",
            rtcSupported: true,
            rtcTestCompleted: true,
            rtcPublic: [WebRTCAddress(address: "198.51.100.9", country: "Greece", countryCode: "GR")],
            rtcLocalText: "n/a",
            rtcPublicText: "198.51.100.9",
            rtcLeakText: "✔ No Local IP Leak",
            rtcMismatchText: "! WebRTC IP doesn't match your Remote IP",
            checkedAt: Date().addingTimeInterval(-7),
            duration: 4.8
        )
    }

    private static func localExposureReport() -> BrowserLeaksReport {
        BrowserLeaksReport(
            pageIPv4: "203.0.113.42",
            pageIPv6: nil,
            countryCode: "CA",
            country: "Canada",
            region: "Ontario",
            city: "Toronto",
            isp: "Example ISP",
            organization: "Example Network",
            rtcSupported: true,
            rtcTestCompleted: true,
            rtcLocal: [WebRTCAddress(address: "192.168.1.12")],
            rtcPublic: [WebRTCAddress(address: "203.0.113.42")],
            rtcLocalText: "192.168.1.12",
            rtcPublicText: "203.0.113.42",
            rtcLeakText: "✖ Local IP Leak",
            checkedAt: Date().addingTimeInterval(-22),
            duration: 4.1
        )
    }

    private static func renderUpdatePreview(to directory: URL) {
        var updateState = UpdateViewState()
        updateState.phase = .available
        updateState.currentVersion = "1.1.1"
        updateState.latestVersion = "1.1.2"
        updateState.releaseURL = URL(
            string: "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2"
        )
        updateState.message = "ShieldBar 1.1.2 is available."
        updateState.autoCheck = true
        updateState.dismissed = false
        updateState.noticeSeen = true
        updateState.lastCheckedAt = Date().addingTimeInterval(-20)

        let protection = ProtectionController(
            previewState: protectionPreviewState(triggered: false)
        )
        let monitor = Monitor(previewReport: clearReport())
        let actions = DashboardActions(
            openFullReport: {},
            openProtection: {},
            restoreNetwork: {},
            quit: {},
            showAbout: {},
            openBrowserLeaks: {}
        )
        let view = DashboardView(
            monitor: monitor,
            protection: protection,
            updates: UpdateController(previewState: updateState),
            actions: actions
        )
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        renderer.proposedSize = ProposedViewSize(width: 386, height: nil)

        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:])
        else {
            writeError("Could not render dashboard-update")
            return
        }

        do {
            try png.write(to: directory.appendingPathComponent("dashboard-update.png"))
            write("Rendered dashboard-update.png")
        } catch {
            writeError("Could not write dashboard-update: \(error.localizedDescription)")
        }
    }

    private static func renderProtectionPreviews(to directory: URL) {
        for triggered in [false, true] {
            let controller = ProtectionController(
                previewState: protectionPreviewState(triggered: triggered)
            )
            let view = ProtectionView(controller: controller, scrollable: false)
            let hosting = NSHostingView(rootView: view)
            hosting.frame = NSRect(x: 0, y: 0, width: 720, height: 1500)
            hosting.layoutSubtreeIfNeeded()

            let fitting = hosting.fittingSize
            let height = max(700, min(1500, fitting.height))
            hosting.frame = NSRect(x: 0, y: 0, width: 720, height: height)

            let window = NSWindow(
                contentRect: NSRect(x: -20_000, y: -20_000, width: 720, height: height),
                styleMask: [.titled],
                backing: .buffered,
                defer: false
            )
            window.contentView = hosting
            window.isReleasedWhenClosed = false
            window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            window.displayIfNeeded()

            // Let SwiftUI and AppKit controls perform an initial layout/draw.
            RunLoop.current.run(until: Date().addingTimeInterval(0.35))
            hosting.layoutSubtreeIfNeeded()
            window.displayIfNeeded()

            guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
                writeError("Could not render protection preview")
                window.orderOut(nil)
                continue
            }
            hosting.cacheDisplay(in: hosting.bounds, to: rep)

            guard let png = rep.representation(using: .png, properties: [:]) else {
                writeError("Could not encode protection preview")
                window.orderOut(nil)
                continue
            }

            let name = triggered ? "protection-triggered" : "protection-ready"
            do {
                try png.write(to: directory.appendingPathComponent("\(name).png"))
                write("Rendered \(name).png")
            } catch {
                writeError("Could not write \(name): \(error.localizedDescription)")
            }
            window.orderOut(nil)
        }
    }

    private static func protectionPreviewState(triggered: Bool) -> ProtectionViewState {
        var state = ProtectionViewState()
        state.phase = triggered ? .triggered : .ready
        state.helperInstalled = true
        state.helperVersion = "1.1.2"
        state.settings = ProtectionSettings(
            enabled: true,
            killOnPublicLeak: true,
            killOnLocalExposure: false,
            killOnLocationChange: true,
            locationFields: [.country],
            failClosed: false,
            startAtLogin: true
        )
        state.baselineLabel = triggered ? nil : "Canada · Ontario · Toronto"
        state.baselineCapturedAt = triggered ? nil : Date().addingTimeInterval(-120)
        state.armed = false
        state.triggered = triggered
        state.message = triggered
            ? "Network disabled: public IP leak."
            : "Baseline captured for this session."
        state.lastTrigger = triggered ? .publicLeak : nil
        state.vpnAdapters = [
            VPNAdapterInfo(name: "utun3", likelyVPN: true),
            VPNAdapterInfo(name: "en0", likelyVPN: false)
        ]
        state.remoteSession = .none
        state.currentStatus = .clear
        state.currentHeadline = "Clear"
        state.lastCheckedAt = Date().addingTimeInterval(-14)
        state.canSetBaseline = !triggered
        state.canArm = !triggered
        return state
    }

    private static func renderIconSheet(to url: URL) {
        let statuses = ShieldStatus.allCases
        let cell = NSSize(width: 72, height: 76)
        let size = NSSize(width: cell.width * CGFloat(statuses.count), height: cell.height)
        let image = NSImage(size: size)

        image.lockFocus()
        NSColor(calibratedWhite: 0.12, alpha: 1).setFill()
        NSRect(origin: .zero, size: size).fill()

        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 8),
            .foregroundColor: NSColor(calibratedWhite: 0.8, alpha: 1)
        ]

        for (index, status) in statuses.enumerated() {
            let icon = MenuBarIcon.image(for: status, size: 34)
            let x = CGFloat(index) * cell.width + (cell.width - icon.size.width) / 2
            icon.draw(in: NSRect(x: x, y: 32, width: icon.size.width, height: icon.size.height))

            let label = status.shortLabel as NSString
            let labelSize = label.size(withAttributes: attributes)
            label.draw(
                at: NSPoint(
                    x: CGFloat(index) * cell.width + (cell.width - labelSize.width) / 2,
                    y: 14
                ),
                withAttributes: attributes
            )
        }
        image.unlockFocus()

        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            return
        }
        try? png.write(to: url)
        write("Rendered menu-bar-icons.png")
    }

    private static func write(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    private static func writeError(_ line: String) {
        FileHandle.standardError.write(Data((line + "\n").utf8))
    }
}
