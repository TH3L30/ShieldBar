import AppKit
import ShieldBarCore
import SwiftUI

@MainActor
struct DashboardView: View {
    @ObservedObject var monitor: Monitor
    let actions: DashboardActions

    @State private var copiedIP = false
    @State private var showSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            header
            if monitor.showWelcome {
                welcomeCard
            }
            ipCard
            webRTCard
            freshness
            actionButtons
            settings
            attribution
        }
        .padding(16)
        .frame(width: 386)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(nsImage: MenuBarIcon.image(for: monitor.status, size: 38))
                .frame(width: 38, height: 38)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(monitor.evaluation.headline)
                    .font(.system(size: 16.5, weight: .semibold))
                Text(monitor.evaluation.detail)
                    .font(.system(size: 11.5))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(4)
            }

            Spacer(minLength: 0)
        }
    }

    private var welcomeCard: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "menubar.rectangle")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.accentColor)

            VStack(alignment: .leading, spacing: 2) {
                Text("ShieldBar lives in the menu bar")
                    .font(.system(size: 11.5, weight: .semibold))
                Text("Click the shield anytime. This card updates itself while it is open.")
                    .font(.system(size: 10.5))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            Button {
                monitor.dismissWelcome()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss welcome message")
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.accentColor.opacity(0.09))
        )
    }

    private var ipCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionHeader("IP Address", systemImage: "network")
                Spacer()
                if monitor.status == .offline, monitor.report != nil {
                    Text("LAST KNOWN")
                        .font(.system(size: 8, weight: .bold))
                        .tracking(0.4)
                        .foregroundColor(.orange)
                }
            }

            if let report = monitor.report {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: report.pageIPv4)
                        .font(.system(size: 22, weight: .semibold, design: .monospaced))
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    Button {
                        copy(report.pageIPv4)
                    } label: {
                        Image(systemName: copiedIP ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(copiedIP ? .green : .secondary)
                    }
                    .buttonStyle(.plain)
                    .help(copiedIP ? "Copied" : "Copy public IP address")
                    .accessibilityLabel("Copy public IP address")

                    Spacer(minLength: 0)
                }

                detailRow(
                    "Location",
                    value: locationValue(for: report),
                    monospaced: false
                )
                detailRow(
                    "ISP",
                    value: report.isp ?? "Unknown",
                    monospaced: false
                )
                detailRow(
                    "IPv6",
                    value: report.pageIPv6 ?? "Not detected",
                    monospaced: report.pageIPv6 != nil
                )
            } else if monitor.isChecking {
                HStack(spacing: 7) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading BrowserLeaks…")
                        .font(.system(size: 11.5))
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
            } else {
                Text("No IP result yet. Press Refresh to run a check.")
                    .font(.system(size: 11.5))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .cardStyle()
    }

    private var webRTCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("WebRTC Leak Check", systemImage: "antenna.radiowaves.left.and.right")

            if let report = monitor.report {
                HStack(spacing: 6) {
                    Text("BrowserLeaks")
                        .font(.system(size: 10.5))
                        .foregroundColor(.secondary)
                    Spacer(minLength: 0)
                    Text(leakVerdictText)
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundColor(verdictColor)
                        .multilineTextAlignment(.trailing)
                }

                detailRow(
                    "Local IP",
                    value: report.localAddresses.isEmpty
                        ? "None exposed"
                        : report.localAddresses.joined(separator: ", "),
                    monospaced: !report.localAddresses.isEmpty,
                    valueColor: report.localAddresses.isEmpty ? .green : .orange
                )
                detailRow(
                    "WebRTC IP",
                    value: report.publicAddresses.isEmpty
                        ? "No candidate"
                        : report.publicAddresses.joined(separator: ", "),
                    monospaced: !report.publicAddresses.isEmpty,
                    valueColor: publicWebRTCColor
                )

                if monitor.status == .publicLeak {
                    warningLine(
                        "WebRTC sees a different public IP than BrowserLeaks. VPN or proxy traffic may be bypassing the tunnel.",
                        systemImage: "exclamationmark.triangle.fill",
                        color: .red
                    )
                } else if monitor.status == .localExposure {
                    warningLine(
                        "A private/local IP is visible to WebRTC sites.",
                        systemImage: "exclamationmark.triangle.fill",
                        color: .orange
                    )
                } else if monitor.status == .inconclusive {
                    warningLine(
                        "Not enough data to judge. ShieldBar will not show green without a complete result.",
                        systemImage: "questionmark.circle.fill",
                        color: .orange
                    )
                }

                Text("WebRTC public should match the IP BrowserLeaks sees; local addresses should not appear at all.")
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("The WebRTC test runs together with the IP check.")
                    .font(.system(size: 11.5))
                    .foregroundColor(.secondary)
            }
        }
        .cardStyle()
    }

    private var freshness: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 6) {
                if monitor.isChecking {
                    ProgressView()
                        .controlSize(.mini)
                }
                Text(freshnessText(now: context.date))
                    .font(.system(size: 10.5))
                    .foregroundColor(.secondary)
                    .monospacedDigit()

                Spacer(minLength: 0)

                if monitor.status == .offline, monitor.lastCheckedAt != nil {
                    Text("STALE")
                        .font(.system(size: 8, weight: .bold))
                        .tracking(0.4)
                        .foregroundColor(.orange)
                }
            }
        }
    }

    private var actionButtons: some View {
        HStack(spacing: 8) {
            Button {
                monitor.checkNow()
            } label: {
                Label(
                    monitor.isChecking ? "Checking…" : "Refresh",
                    systemImage: "arrow.clockwise"
                )
                .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .disabled(monitor.isChecking)
            .help("Run a fresh BrowserLeaks IP and WebRTC test now")

            Button {
                actions.openFullReport()
            } label: {
                Label("Full Report", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .help("Open the full BrowserLeaks report in a separate window")
        }
    }

    private var settings: some View {
        DisclosureGroup(isExpanded: $showSettings) {
            VStack(alignment: .leading, spacing: 9) {
                Toggle("Notify me when a public leak appears", isOn: $monitor.notifyOnLeak)
                    .toggleStyle(.switch)
                    .controlSize(.small)
                    .font(.system(size: 11))

                Text("Notifications never include IP addresses. They fire only when the status changes to a public leak.")
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 10) {
                    Button("About ShieldBar") {
                        actions.showAbout()
                    }
                    Spacer(minLength: 0)
                    Button("Quit ShieldBar") {
                        actions.quit()
                    }
                }
                .font(.system(size: 10.5))
                .buttonStyle(.borderless)
            }
            .padding(.top, 8)
        } label: {
            Label("Settings", systemImage: "gearshape")
                .font(.system(size: 10.5, weight: .medium))
                .foregroundColor(.secondary)
        }
        .disclosureGroupStyle(.automatic)
    }

    private var attribution: some View {
        HStack(spacing: 4) {
            Text("Data from BrowserLeaks · not affiliated")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)

            Spacer(minLength: 0)

            Button {
                actions.openBrowserLeaks()
            } label: {
                Text("Visit site")
                    .foregroundColor(.accentColor)
                    .underline()
            }
            .buttonStyle(.plain)
            .font(.system(size: 9))
        }
    }

    private var leakVerdictText: String {
        guard let report = monitor.report else { return "Not checked" }
        if let text = report.rtcLeakText, !text.isEmpty {
            return text
        }
        if !monitor.evaluation.publicMismatch.isEmpty {
            return "Public IP mismatch"
        }
        if !monitor.evaluation.localExposed.isEmpty {
            return "Local IP exposed"
        }
        if report.rtcTestCompleted && !report.publicAddresses.isEmpty {
            return "No local leak detected"
        }
        return "Incomplete result"
    }

    private var verdictColor: Color {
        guard let text = monitor.report?.rtcLeakText?.lowercased() else {
            switch monitor.status {
            case .clear: return .green
            case .publicLeak: return .red
            case .localExposure, .inconclusive: return .orange
            default: return .secondary
            }
        }
        if text.contains("no local") || text.contains("no leak") {
            return .green
        }
        if text.contains("leak") || text.contains("mismatch") {
            return .orange
        }
        return .secondary
    }

    private var publicWebRTCColor: Color {
        guard let report = monitor.report else { return .secondary }
        if report.publicAddresses.isEmpty { return .orange }
        if !monitor.evaluation.publicMismatch.isEmpty { return .red }
        return .primary
    }

    private func locationValue(for report: BrowserLeaksReport) -> String {
        let flag = flagEmoji(for: report.countryCode)
        let location = report.locationLine ?? "Unknown"
        if let flag {
            return "\(flag) \(location)"
        }
        return location
    }

    private func flagEmoji(for code: String?) -> String? {
        guard let code, code.count == 2 else { return nil }
        var scalars = String.UnicodeScalarView()
        for scalar in code.uppercased().unicodeScalars {
            guard scalar.value >= 65, scalar.value <= 90,
                  let flagScalar = UnicodeScalar(127397 + scalar.value) else {
                return nil
            }
            scalars.append(flagScalar)
        }
        return String(scalars)
    }

    private func detailRow(
        _ label: String,
        value: String,
        monospaced: Bool,
        valueColor: Color = .primary
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.system(size: 10.5))
                .foregroundColor(.secondary)
                .frame(width: 76, alignment: .leading)

            Text(verbatim: value)
                .font(.system(size: 11, design: monospaced ? .monospaced : .default))
                .foregroundColor(valueColor)
                .textSelection(.enabled)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .semibold))
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.55)
        }
        .foregroundColor(.secondary)
    }

    private func warningLine(_ text: String, systemImage: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 10))
                .foregroundColor(color)
            Text(text)
                .font(.system(size: 10))
                .foregroundColor(color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func freshnessText(now: Date) -> String {
        if monitor.isChecking {
            return "Running BrowserLeaks test…"
        }

        guard let lastCheckedAt = monitor.lastCheckedAt else {
            return "Not checked yet"
        }

        var text = "Checked \(monitor.relativeAge(since: lastCheckedAt, now: now))"

        if let nextCheckAt = monitor.nextCheckAt {
            let seconds = max(0, Int(nextCheckAt.timeIntervalSince(now)))
            if seconds >= 60 {
                let minutes = seconds / 60
                let remainder = seconds % 60
                text += " · next in \(minutes)m \(String(format: "%02d", remainder))s"
            } else {
                text += " · next in \(seconds)s"
            }
        }

        return text
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        copiedIP = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            copiedIP = false
        }
    }
}

private struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
            )
    }
}

private extension View {
    func cardStyle() -> some View {
        modifier(CardStyle())
    }
}
