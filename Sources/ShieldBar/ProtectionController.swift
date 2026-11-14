import Combine
import Darwin
import Foundation
import ShieldBarCore

@MainActor
final class ProtectionController: ObservableObject {
    @Published private(set) var viewState = ProtectionViewState()

    var onProtectionChanged: (() -> Void)?
    var onNotificationTap: (() -> Void)?

    private let monitor: Monitor
    private let helper = HelperClient()
    private let settingsKey = "protectionSettings"
    private let salt = UUID().uuidString
    private var settings: ProtectionSettings
    private var baseline: ProtectionBaseline?
    private var phase: ProtectionPhase = .unavailable
    private var armed = false
    private var triggered = false
    private var message: String?
    private var lastTrigger: ProtectionTrigger?
    private var helperInstalled = false
    private var helperVersion: String?
    private var lastEvaluatedAt: Date?
    private var pendingLocationConfirm = false
    private var confirmWorkItem: DispatchWorkItem?
    private var interfaceTimer: Timer?
    private var lastInterfaceSignature = ""
    private var remoteCache: (checkedAt: Date, value: RemoteSessionInfo)?
    private var cancellables = Set<AnyCancellable>()

    init(monitor: Monitor) {
        self.monitor = monitor
        self.settings = Self.loadSettings()

        monitor.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                DispatchQueue.main.async {
                    self?.monitorDidUpdate()
                }
            }
            .store(in: &cancellables)

        refreshViewState()
    }

    convenience init(previewState: ProtectionViewState) {
        let report = BrowserLeaksReport(
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
            checkedAt: Date().addingTimeInterval(-14)
        )
        self.init(monitor: Monitor(previewReport: report))
        self.viewState = previewState
    }

    var isArmed: Bool { armed }
    var isTriggered: Bool { triggered }

    func start() {
        StartAtLogin.apply(settings.startAtLogin)
        Task { await refreshHelper() }
    }

    func shutdown() {
        interfaceTimer?.invalidate()
        interfaceTimer = nil
        confirmWorkItem?.cancel()
        confirmWorkItem = nil
        cancellables.removeAll()
    }

    func installHelper() async -> ProtectionActionResult {
        if triggered {
            let restored = await restoreNetwork()
            guard restored.ok else {
                return ProtectionActionResult(
                    ok: false,
                    message: "Restore networking before reinstalling: \(restored.message)"
                )
            }
        }
        if armed {
            _ = disarm()
        }

        let result = await HelperInstaller.install()
        message = result.message
        if result.ok {
            await refreshHelper()
        } else {
            phase = .unavailable
            refreshViewState()
        }
        return result
    }

    func uninstallHelper() async -> ProtectionActionResult {
        if triggered {
            let restored = await restoreNetwork()
            guard restored.ok else {
                return ProtectionActionResult(
                    ok: false,
                    message: "Restore networking before uninstalling: \(restored.message)"
                )
            }
        }
        if armed {
            _ = disarm()
        }

        let result = await HelperInstaller.uninstall()
        message = result.message
        if result.ok {
            helperInstalled = false
            helperVersion = nil
            phase = .unavailable
        }
        refreshViewState()
        return result
    }

    func setBaseline() -> ProtectionActionResult {
        guard settings.enabled else {
            return ProtectionActionResult(ok: false, message: "Enable Protection first.")
        }
        guard monitor.status == .clear, let report = monitor.report else {
            return ProtectionActionResult(
                ok: false,
                message: "Run a check and wait for a Clear result before setting a baseline."
            )
        }

        let result = ProtectionEvaluator.createBaseline(
            report: report,
            fields: settings.locationFields,
            salt: salt
        )
        guard let captured = result.baseline else {
            let missing = result.missing.map(\.label).joined(separator: ", ")
            return ProtectionActionResult(
                ok: false,
                message: "BrowserLeaks did not return: \(missing)."
            )
        }

        baseline = captured
        message = "Baseline captured for this session."
        refreshViewState()
        return ProtectionActionResult(ok: true, message: message ?? "")
    }

    func arm(
        acknowledgeRemote: Bool,
        acknowledgeNoVPN: Bool
    ) async -> ProtectionActionResult {
        guard settings.enabled else {
            return ProtectionActionResult(ok: false, message: "Enable Protection first.")
        }
        guard helperInstalled else {
            return ProtectionActionResult(ok: false, message: "Install the protection helper first.")
        }
        guard !triggered else {
            return ProtectionActionResult(
                ok: false,
                message: "Networking is disabled. Restore it before arming again."
            )
        }
        guard !armed else {
            return ProtectionActionResult(ok: true, message: "Protection is already armed.")
        }
        guard let captured = baseline else {
            return ProtectionActionResult(ok: false, message: "Set a safe baseline before arming.")
        }
        guard !monitor.isChecking else {
            return ProtectionActionResult(ok: false, message: "Wait for the current check to finish.")
        }
        guard monitor.status == .clear, monitor.report != nil else {
            return ProtectionActionResult(
                ok: false,
                message: "Arming requires a known Clear result and a captured baseline."
            )
        }

        let remote = detectRemoteSession()
        if remote.detected, !acknowledgeRemote {
            return ProtectionActionResult(
                ok: false,
                message: "Remote session detected (\(remote.kind ?? "remote")). Confirm the risk first."
            )
        }

        let adapters = vpnAdapters(interfaceNames())
        if !adapters.contains(where: { $0.likelyVPN }), !acknowledgeNoVPN {
            return ProtectionActionResult(
                ok: false,
                message: "No VPN adapter was detected. Confirm that your VPN is connected."
            )
        }

        monitor.requestNotificationAuthorization()
        armed = true
        triggered = false
        phase = .armed
        message = "Armed · \(ProtectionEvaluator.baselineLabel(captured, fields: settings.locationFields))"
        lastEvaluatedAt = nil
        pendingLocationConfirm = false
        monitor.setProtectionArmed(true)
        monitor.checkNow()
        startInterfacePolling()
        refreshViewState()
        return ProtectionActionResult(ok: true, message: message ?? "")
    }

    func disarm() -> ProtectionActionResult {
        guard armed else {
            return ProtectionActionResult(ok: true, message: "Protection is not armed.")
        }

        armed = false
        pendingLocationConfirm = false
        lastEvaluatedAt = nil
        confirmWorkItem?.cancel()
        confirmWorkItem = nil
        stopInterfacePolling()
        monitor.setProtectionArmed(false)
        phase = helperInstalled ? .ready : .unavailable
        message = "Protection disarmed."
        refreshViewState()
        return ProtectionActionResult(ok: true, message: message ?? "")
    }

    func restoreNetwork() async -> ProtectionActionResult {
        guard triggered else {
            return ProtectionActionResult(ok: true, message: "Networking was not disabled.")
        }

        phase = .restoring
        message = "Restoring network interfaces…"
        refreshViewState()

        do {
            let response = try await helper.restore()
            guard response.ok else {
                phase = .triggered
                message = response.message ?? "Could not restore all interfaces."
                refreshViewState()
                return ProtectionActionResult(ok: false, message: message ?? "")
            }

            triggered = false
            armed = false
            phase = .ready
            lastTrigger = nil
            baseline = nil
            message = "Networking restored. Set a new baseline before arming again."
            monitor.setProtectionArmed(false)
            monitor.checkNow()
            refreshViewState()
            return ProtectionActionResult(ok: true, message: message ?? "")
        } catch {
            phase = .triggered
            message = error.localizedDescription
            refreshViewState()
            return ProtectionActionResult(ok: false, message: message ?? "")
        }
    }

    func updateSettings(_ next: ProtectionSettings) {
        var normalized = next
        var seen = Set<LocationField>()
        normalized.locationFields = next.locationFields.filter { seen.insert($0).inserted }
        if normalized.locationFields.isEmpty {
            normalized.locationFields = ProtectionSettings.default.locationFields
        }

        let previous = settings
        if !normalized.enabled, armed {
            _ = disarm()
        }
        if Set(previous.locationFields) != Set(normalized.locationFields) {
            if armed {
                _ = disarm()
            }
            baseline = nil
        }
        if previous.startAtLogin != normalized.startAtLogin {
            StartAtLogin.apply(normalized.startAtLogin)
        }

        settings = normalized
        persistSettings()
        refreshViewState()
    }

    private func refreshHelper() async {
        do {
            let response = try await helper.status()
            helperInstalled = response.ok
            helperVersion = response.version

            if response.triggered == true {
                triggered = true
                armed = false
                phase = .triggered
                message = "Networking is currently disabled by ShieldBar. Restore it before arming."
                stopInterfacePolling()
                monitor.setProtectionArmed(false)
            } else if !triggered {
                phase = armed ? .armed : .ready
                if !armed { message = nil }
            }
        } catch {
            helperInstalled = false
            helperVersion = nil
            if !triggered {
                phase = armed ? .error : .unavailable
            }
            message = armed
                ? "Protection helper became unavailable while armed."
                : "Install the protection helper to enable the kill switch."
        }
        refreshViewState()
    }

    private func monitorDidUpdate() {
        refreshViewState()

        guard armed, !triggered, !monitor.isChecking else { return }
        guard let checkedAt = monitor.lastCheckedAt else { return }
        guard lastEvaluatedAt != checkedAt else { return }

        if monitor.status == .offline || monitor.report == nil {
            lastEvaluatedAt = checkedAt
            message = "Protection degraded: BrowserLeaks is unreachable."
            refreshViewState()
            return
        }

        guard let report = monitor.report else { return }
        let evaluation = ProtectionEvaluator.evaluate(
            report: report,
            status: monitor.status,
            settings: settings,
            baseline: baseline,
            salt: salt
        )

        if evaluation.trigger == .publicLeak
            || evaluation.trigger == .localExposure
            || evaluation.trigger == .inconclusive {
            lastEvaluatedAt = checkedAt
            if let trigger = evaluation.trigger {
                Task { await self.triggerKill(trigger) }
            }
            return
        }

        if evaluation.trigger == .locationChange {
            if pendingLocationConfirm {
                lastEvaluatedAt = checkedAt
                Task { await self.triggerKill(.locationChange) }
                return
            }

            pendingLocationConfirm = true
            lastEvaluatedAt = checkedAt
            message = "Location change detected. Confirming in 2 seconds…"
            refreshViewState()

            confirmWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                Task { @MainActor in
                    guard self.armed, !self.triggered else { return }
                    self.monitor.checkNow()
                }
            }
            confirmWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
            return
        }

        if pendingLocationConfirm {
            pendingLocationConfirm = false
            message = nil
        }
        lastEvaluatedAt = checkedAt
    }

    private func triggerKill(_ trigger: ProtectionTrigger) async {
        guard armed, !triggered else { return }

        phase = .triggering
        message = "Disabling all network interfaces…"
        refreshViewState()

        var lastMessage = "The protection helper did not respond."
        for attempt in 0..<2 {
            do {
                let response = try await helper.disable()
                if response.triggered == true {
                    triggered = true
                    armed = false
                    phase = .triggered
                    lastTrigger = trigger
                    baseline = nil
                    pendingLocationConfirm = false
                    confirmWorkItem?.cancel()
                    confirmWorkItem = nil
                    stopInterfacePolling()
                    monitor.setProtectionArmed(false)
                    message = "Network disabled: \(trigger.label)."
                    monitor.notifyProtectionTriggered(trigger)
                    refreshViewState()
                    return
                }
                lastMessage = response.message ?? lastMessage
            } catch {
                lastMessage = error.localizedDescription
            }

            if attempt == 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }

        phase = .error
        message = "Could not disable networking: \(lastMessage)"
        refreshViewState()
    }

    private func startInterfacePolling() {
        stopInterfacePolling()
        lastInterfaceSignature = interfaceSignature()
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.pollInterfaces()
            }
        }
        interfaceTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func stopInterfacePolling() {
        interfaceTimer?.invalidate()
        interfaceTimer = nil
    }

    private func pollInterfaces() {
        let next = interfaceSignature()
        guard next != lastInterfaceSignature else { return }
        lastInterfaceSignature = next
        if armed, !triggered {
            monitor.checkNow()
        }
        refreshViewState()
    }

    private func refreshViewState() {
        let adapters = vpnAdapters(interfaceNames())
        let baselineLabel = baseline.map {
            ProtectionEvaluator.baselineLabel($0, fields: settings.locationFields)
        }

        viewState = ProtectionViewState(
            phase: phase,
            helperInstalled: helperInstalled,
            helperVersion: helperVersion,
            settings: settings,
            baselineLabel: baselineLabel,
            baselineCapturedAt: baseline?.capturedAt,
            armed: armed,
            triggered: triggered,
            message: message,
            lastTrigger: lastTrigger,
            vpnAdapters: adapters,
            remoteSession: detectRemoteSession(),
            currentStatus: monitor.status,
            currentHeadline: monitor.evaluation.headline,
            lastCheckedAt: monitor.lastCheckedAt,
            canSetBaseline: settings.enabled && monitor.status == .clear && monitor.report != nil,
            canArm: settings.enabled
                && helperInstalled
                && baseline != nil
                && monitor.status == .clear
                && !armed
                && !triggered
        )
        onProtectionChanged?()
    }

    private func interfaceNames() -> [String] {
        var pointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&pointer) == 0, let first = pointer else { return [] }
        defer { freeifaddrs(pointer) }

        var names = Set<String>()
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let current = cursor {
            let name = String(cString: current.pointee.ifa_name)
            if current.pointee.ifa_flags & UInt32(IFF_LOOPBACK) == 0 {
                names.insert(name)
            }
            cursor = current.pointee.ifa_next
        }
        return names.sorted()
    }

    private func interfaceSignature() -> String {
        interfaceNames().joined(separator: "|")
    }

    private func vpnAdapters(_ names: [String]) -> [VPNAdapterInfo] {
        let patterns = [
            "wg", "wireguard", "tun", "utun", "tap", "tailscale", "nordlynx",
            "mullvad", "proton", "openvpn", "ppp", "ipsec", "zerotier", "hamachi"
        ]
        return names.map { name in
            let lower = name.lowercased()
            return VPNAdapterInfo(
                name: name,
                likelyVPN: patterns.contains { lower.contains($0) }
            )
        }
    }

    private func detectRemoteSession() -> RemoteSessionInfo {
        if let cached = remoteCache, Date().timeIntervalSince(cached.checkedAt) < 30 {
            return cached.value
        }

        var result = RemoteSessionInfo.none
        let environment = ProcessInfo.processInfo.environment
        if environment["SSH_CONNECTION"] != nil || environment["SSH_TTY"] != nil {
            result = RemoteSessionInfo(detected: true, kind: "SSH")
        } else {
            for process in ["screensharingd", "ARDAgent", "vncserver", "Xvnc", "tvnserver"] {
                let task = Process()
                task.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
                task.arguments = ["-x", process]
                task.standardOutput = FileHandle.nullDevice
                task.standardError = FileHandle.nullDevice
                if (try? task.run()) != nil {
                    task.waitUntilExit()
                    if task.terminationStatus == 0 {
                        result = RemoteSessionInfo(detected: true, kind: "screen sharing")
                        break
                    }
                }
            }
        }

        remoteCache = (Date(), result)
        return result
    }

    private static func loadSettings() -> ProtectionSettings {
        guard let data = UserDefaults.standard.data(forKey: "protectionSettings"),
              let decoded = try? JSONDecoder().decode(ProtectionSettings.self, from: data) else {
            return .default
        }
        var normalized = decoded
        if normalized.locationFields.isEmpty {
            normalized.locationFields = ProtectionSettings.default.locationFields
        }
        return normalized
    }

    private func persistSettings() {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        UserDefaults.standard.set(data, forKey: settingsKey)
    }
}
