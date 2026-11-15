import AppKit
import SwiftUI
import ShieldBarCore

struct ProtectionView: View {
    @ObservedObject var controller: ProtectionController
    @State private var acknowledgeRemote = false
    @State private var acknowledgeNoVPN = false
    @State private var notice: String?
    @State private var busy: String?
    private let scrollable: Bool

    init(controller: ProtectionController, scrollable: Bool = true) {
        _controller = ObservedObject(wrappedValue: controller)
        self.scrollable = scrollable
    }

    private var state: ProtectionViewState { controller.viewState }

    var body: some View {
        Group {
            if scrollable {
                ScrollView {
                    content
                }
            } else {
                content
            }
        }
        .frame(minWidth: 620, minHeight: 560)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            warningBanner

            if let notice {
                Text(notice)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color.accentColor.opacity(0.08))
                    )
            }

            if state.triggered {
                killBanner
            }

            masterPanel
            helperPanel
            baselinePanel
            triggersPanel
            armPanel

            Text("Beta protection is off by default. Test on a spare machine before relying on it.")
                .font(.system(size: 9.5))
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
        .padding(22)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 28, weight: .medium))
                .foregroundColor(.white)
                .frame(width: 44, height: 44)
                .background(
                    LinearGradient(
                        colors: [Color.cyan, Color.blue],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Text("Protection")
                        .font(.system(size: 22, weight: .semibold))
                    Text("BETA")
                        .font(.system(size: 8, weight: .bold))
                        .tracking(0.6)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.15))
                        .foregroundColor(.orange)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                Text("Kill switch and location guard")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text(state.phase.label)
                .font(.system(size: 10, weight: .medium))
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(phaseColor.opacity(0.12))
                .foregroundColor(phaseColor)
                .clipShape(Capsule())
        }
    }

    private var warningBanner: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Protection can disable every network interface.")
                    .font(.system(size: 11.5, weight: .semibold))
                Text("It is off by default, needs a one-time admin helper, and must be restored manually.")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.orange.opacity(0.09))
        )
    }

    private var killBanner: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("NETWORK DISABLED")
                    .font(.system(size: 8, weight: .bold))
                    .tracking(1)
                    .foregroundColor(Color.red.opacity(0.8))
                Text("Protection stopped your connection")
                    .font(.system(size: 16, weight: .semibold))
                Text(
                    state.lastTrigger.map { "Triggered by \($0.label). Restore only when you are ready to reconnect." }
                        ?? "The helper reports that networking is disabled."
                )
                .font(.system(size: 10.5))
                .foregroundColor(.secondary)
            }

            Spacer()

            Button {
                Task { await restore() }
            } label: {
                Text(busy == "restore" ? "Restoring…" : "Restore Network")
                    .frame(minWidth: 120)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .controlSize(.large)
            .disabled(busy != nil)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.red.opacity(0.09))
        )
    }

    private var masterPanel: some View {
        panel(
            step: "1",
            title: "Master switch",
            detail: "Enables the protection controls below."
        ) {
            Toggle("Enable protection", isOn: binding(\.enabled))
                .toggleStyle(.switch)
        }
    }

    private var helperPanel: some View {
        panel(
            step: "2",
            title: "Privileged helper",
            detail: "A tiny root service. It only accepts status, disable, and restore commands."
        ) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.helperInstalled
                        ? "Helper installed\(state.helperVersion.map { " · v\($0)" } ?? "")"
                        : "Helper not installed")
                        .font(.system(size: 11.5, weight: .semibold))
                    Text(state.helperInstalled
                        ? "You will be asked for admin approval only when installing or removing it."
                        : "Installing requires one administrator approval. Without it, ShieldBar cannot disable networking.")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if state.helperInstalled {
                    HStack(spacing: 6) {
                        Button(busy == "install" ? "Repairing…" : "Repair") {
                            Task { await installHelper() }
                        }
                        .disabled(busy != nil)
                        Button(busy == "uninstall" ? "Removing…" : "Remove helper") {
                            Task { await uninstallHelper() }
                        }
                        .disabled(busy != nil)
                    }
                } else {
                    Button(busy == "install" ? "Waiting for approval…" : "Install helper") {
                        Task { await installHelper() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy != nil)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
        }
    }

    private var baselinePanel: some View {
        panel(
            step: "3",
            title: "Safe baseline",
            detail: "Capture the location you trust for this session. Nothing is written to disk."
        ) {
            HStack(spacing: 8) {
                Text("CURRENT CHECK")
                    .font(.system(size: 8, weight: .bold))
                    .tracking(0.6)
                    .foregroundColor(.secondary)
                Text(state.currentHeadline)
                    .font(.system(size: 11.5, weight: .semibold))
                Spacer()
                Text(lastCheckedText)
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
            }

            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("BASELINE")
                        .font(.system(size: 8, weight: .bold))
                        .tracking(0.6)
                        .foregroundColor(.secondary)
                    Text(state.baselineLabel ?? "No baseline captured")
                        .font(.system(size: 11.5, weight: .semibold))
                    Text(state.baselineCapturedAt.map {
                        "Captured \(relativeAge($0)) · \(state.settings.locationFields.map(\.label).joined(separator: ", "))"
                    } ?? "Run a check, wait for Clear, then set the current location as safe.")
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button(busy == "baseline" ? "Capturing…" : "Set current as safe") {
                    let result = controller.setBaseline()
                    notice = result.message
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy != nil || !state.canSetBaseline)
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
        }
    }

    private var triggersPanel: some View {
        panel(
            step: "4",
            title: "Triggers",
            detail: "Choose what should cut the connection."
        ) {
            VStack(spacing: 0) {
                triggerToggle(
                    title: "Public IP leak",
                    detail: "WebRTC sees a different public IP. Recommended.",
                    keyPath: \.killOnPublicLeak
                )
                Divider()
                triggerToggle(
                    title: "Local IP exposure",
                    detail: "WebRTC exposes a private/local address. Common on LANs.",
                    keyPath: \.killOnLocalExposure
                )
                Divider()
                triggerToggle(
                    title: "IP location change",
                    detail: "The public location no longer matches the baseline.",
                    keyPath: \.killOnLocationChange
                )
                Divider()
                triggerToggle(
                    title: "Inconclusive result",
                    detail: "Blocked or incomplete data. Off means fail-open; on means fail-closed.",
                    keyPath: \.failClosed
                )
            }
            .padding(.horizontal, 12)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )

            Text("LOCATION FIELDS")
                .font(.system(size: 8, weight: .bold))
                .tracking(0.6)
                .foregroundColor(.secondary)
                .padding(.top, 4)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], alignment: .leading, spacing: 7) {
                ForEach(LocationField.allCases, id: \.self) { field in
                    Toggle(field.label, isOn: fieldBinding(field))
                        .toggleStyle(.checkbox)
                        .font(.system(size: 10.5))
                }
            }

            Text(state.settings.locationFields.contains(.exactIp)
                ? "Exact IP is strictest: every VPN server rotation will trigger."
                : "Country is the stable default. Add fields only if you accept more false triggers.")
                .font(.system(size: 9.5))
                .foregroundColor(.secondary)

            Divider()

            Toggle("Start ShieldBar at login", isOn: binding(\.startAtLogin))
                .toggleStyle(.switch)
                .font(.system(size: 10.5))
        }
    }

    private var armPanel: some View {
        panel(
            step: "5",
            title: state.armed ? "Armed" : "Arm protection",
            detail: "Arming starts a full BrowserLeaks check every 15 seconds."
        ) {
            VStack(alignment: .leading, spacing: 7) {
                Text("DETECTED ADAPTERS")
                    .font(.system(size: 8, weight: .bold))
                    .tracking(0.6)
                    .foregroundColor(.secondary)
                if state.vpnAdapters.isEmpty {
                    Text("No non-loopback adapters detected.")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                } else {
                    HStack(spacing: 6) {
                        ForEach(state.vpnAdapters) { adapter in
                            Text(adapter.name + (adapter.likelyVPN ? " · VPN" : ""))
                                .font(.system(size: 9.5, design: .monospaced))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(
                                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                                        .fill(adapter.likelyVPN
                                            ? Color.green.opacity(0.1)
                                            : Color.primary.opacity(0.05))
                                )
                                .foregroundColor(adapter.likelyVPN ? .green : .primary)
                        }
                    }
                }
                if !state.vpnAdapters.contains(where: { $0.likelyVPN }) {
                    Text("No likely VPN adapter was detected. Confirm your VPN manually below.")
                        .font(.system(size: 9.5))
                        .foregroundColor(.orange)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )

            if state.remoteSession.detected {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Remote session detected\(state.remoteSession.kind.map { " (\($0))" } ?? "")")
                            .font(.system(size: 11, weight: .semibold))
                        Text("If protection fires, this session will lose access to the machine.")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .padding(11)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(Color.orange.opacity(0.09))
                )
            }

            if !state.triggered {
                if state.armed {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Protection is armed")
                                .font(.system(size: 11.5, weight: .semibold))
                            Text(state.baselineLabel ?? state.message ?? "")
                                .font(.system(size: 9.5))
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Button("Disarm") {
                            let result = controller.disarm()
                            notice = result.message
                        }
                        .disabled(busy != nil)
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(Color.green.opacity(0.08))
                    )
                } else {
                    if state.remoteSession.detected {
                        Toggle("I understand a remote session will be disconnected.", isOn: $acknowledgeRemote)
                            .font(.system(size: 10))
                    }
                    if !state.vpnAdapters.contains(where: { $0.likelyVPN }) {
                        Toggle("I confirm my VPN is connected even though no adapter was detected.", isOn: $acknowledgeNoVPN)
                            .font(.system(size: 10))
                    }

                    Button {
                        Task { await arm() }
                    } label: {
                        Text(busy == "arm" ? "Arming…" : "Arm kill switch")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .controlSize(.large)
                    .disabled(
                        busy != nil ||
                        !state.canArm ||
                        (state.remoteSession.detected && !acknowledgeRemote) ||
                        (!state.vpnAdapters.contains(where: { $0.likelyVPN }) && !acknowledgeNoVPN)
                    )

                    Text(armHint)
                        .font(.system(size: 9.5))
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }

            if let message = state.message, !state.triggered {
                Text(message)
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
            }
        }
    }

    private var armHint: String {
        if !state.settings.enabled { return "Enable the master switch first." }
        if !state.helperInstalled { return "Install the privileged helper first." }
        if state.baselineLabel == nil { return "Set a safe baseline first." }
        if state.currentStatus != .clear { return "Wait for a Clear result before arming." }
        return "Arming will check BrowserLeaks every 15 seconds."
    }

    private var lastCheckedText: String {
        guard let date = state.lastCheckedAt else { return "Not checked yet" }
        return "Checked \(relativeAge(date))"
    }

    private var phaseColor: Color {
        switch state.phase {
        case .armed: return .green
        case .triggered, .triggering, .error: return .red
        case .restoring: return .blue
        case .ready: return .blue
        case .unavailable: return .secondary
        }
    }

    private func panel<Content: View>(
        step: String,
        title: String,
        detail: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 9) {
                Text(step)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(.accentColor)
                    .frame(width: 21, height: 21)
                    .background(Color.accentColor.opacity(0.1))
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13.5, weight: .semibold))
                    Text(detail)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            content()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(nsColor: .windowBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        )
    }

    private func triggerToggle(
        title: String,
        detail: String,
        keyPath: WritableKeyPath<ProtectionSettings, Bool>
    ) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 11, weight: .medium))
                Text(detail)
                    .font(.system(size: 9.5))
                    .foregroundColor(.secondary)
            }
            Spacer()
            Toggle("", isOn: binding(keyPath))
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .padding(.vertical, 8)
    }

    private func binding(_ keyPath: WritableKeyPath<ProtectionSettings, Bool>) -> Binding<Bool> {
        Binding(
            get: { state.settings[keyPath: keyPath] },
            set: { value in
                var next = state.settings
                next[keyPath: keyPath] = value
                controller.updateSettings(next)
            }
        )
    }

    private func fieldBinding(_ field: LocationField) -> Binding<Bool> {
        Binding(
            get: { state.settings.locationFields.contains(field) },
            set: { selected in
                var next = state.settings
                if selected {
                    if !next.locationFields.contains(field) {
                        next.locationFields.append(field)
                    }
                } else if next.locationFields.count > 1 {
                    next.locationFields.removeAll { $0 == field }
                }
                controller.updateSettings(next)
            }
        )
    }

    private func installHelper() async {
        busy = "install"
        let result = await controller.installHelper()
        notice = result.message
        busy = nil
    }

    private func uninstallHelper() async {
        busy = "uninstall"
        let result = await controller.uninstallHelper()
        notice = result.message
        busy = nil
    }

    private func arm() async {
        busy = "arm"
        let result = await controller.arm(
            acknowledgeRemote: acknowledgeRemote,
            acknowledgeNoVPN: acknowledgeNoVPN
        )
        notice = result.message
        busy = nil
    }

    private func restore() async {
        busy = "restore"
        let result = await controller.restoreNetwork()
        notice = result.message
        busy = nil
    }

    private func relativeAge(_ date: Date) -> String {
        let seconds = max(0, Int(Date().timeIntervalSince(date)))
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        return "\(minutes / 60)h ago"
    }
}
