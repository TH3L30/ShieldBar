import AppKit
import Combine
import Foundation
import ShieldBarCore

@MainActor
final class UpdateController: ObservableObject {
    @Published private(set) var viewState = UpdateViewState()

    private let monitor: Monitor
    private let defaults = UserDefaults.standard
    private var startupWorkItem: DispatchWorkItem?
    private var timer: Timer?
    private var checking = false

    private enum Keys {
        static let autoCheck = "autoCheckUpdates"
        static let lastNotifiedVersion = "lastNotifiedUpdateVersion"
        static let dismissedVersion = "dismissedUpdateVersion"
        static let lastSeenNotice = "lastSeenUpdateNoticeId"
    }

    init(monitor: Monitor) {
        self.monitor = monitor
        let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
            ?? "1.1.3"
        let auto = defaults.object(forKey: Keys.autoCheck) as? Bool ?? true
        viewState = UpdateViewState(
            phase: auto ? .idle : .disabled,
            currentVersion: current,
            latestVersion: nil,
            releaseURL: nil,
            notice: nil,
            message: nil,
            autoCheck: auto,
            dismissed: false,
            noticeSeen: false,
            lastCheckedAt: nil
        )
    }

    convenience init(previewState: UpdateViewState) {
        let report = BrowserLeaksReport(
            pageIPv4: "203.0.113.42",
            countryCode: "CA",
            country: "Canada",
            region: "Ontario",
            city: "Toronto",
            isp: "Example ISP",
            checkedAt: Date().addingTimeInterval(-14)
        )
        self.init(monitor: Monitor(previewReport: report))
        self.viewState = previewState
    }

    func start() {
        guard viewState.autoCheck else { return }
        scheduleStartupCheck()
        scheduleDailyCheck()
    }

    func shutdown() {
        startupWorkItem?.cancel()
        startupWorkItem = nil
        timer?.invalidate()
        timer = nil
    }

    func check(manual: Bool) async -> UpdateActionResult {
        guard !checking else {
            return UpdateActionResult(ok: false, message: "An update check is already running.")
        }
        guard manual || viewState.autoCheck else {
            return UpdateActionResult(ok: false, message: "Automatic update checks are disabled.")
        }

        checking = true
        viewState.phase = .checking
        viewState.message = manual ? "Checking for updates…" : viewState.message
        if manual {
            objectWillChange.send()
        }

        defer { checking = false }

        guard let manifestURL = URL(string: "https://github.com/TH3L30/ShieldBar/releases/latest/download/latest.json"),
              let signatureURL = URL(string: manifestURL.absoluteString + ".sig")
        else {
            return fail("The update feed URL is invalid.")
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration)

        do {
            let (manifestData, manifestResponse) = try await session.data(from: manifestURL)
            let (signatureData, signatureResponse) = try await session.data(from: signatureURL)

            guard (manifestResponse as? HTTPURLResponse)?.statusCode == 200,
                  (signatureResponse as? HTTPURLResponse)?.statusCode == 200
            else {
                return fail("The update feed is unavailable.")
            }
            guard let signatureText = String(data: signatureData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                let signature = Data(base64Encoded: signatureText),
                signature.count == 64
            else {
                return fail("The update signature is invalid.")
            }

            let parsed = try UpdateVerifier.parse(
                payload: manifestData,
                signature: signature,
                currentVersion: viewState.currentVersion
            )
            let manifest = parsed.manifest
            let available = parsed.available
            let dismissed = available
                && defaults.string(forKey: Keys.dismissedVersion) == manifest.version
            let notice = manifest.notice.flatMap {
                defaults.string(forKey: Keys.lastSeenNotice) == $0.id ? nil : $0
            }

            if available, !dismissed,
               defaults.string(forKey: Keys.lastNotifiedVersion) != manifest.version {
                monitor.requestNotificationAuthorization()
                monitor.notifyUpdateAvailable(manifest.version)
                defaults.set(manifest.version, forKey: Keys.lastNotifiedVersion)
            }

            viewState.phase = available ? .available : (notice != nil ? .notice : .upToDate)
            viewState.currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
                ?? viewState.currentVersion
            viewState.latestVersion = manifest.version
            viewState.releaseURL = URL(string: manifest.releaseUrl)
            viewState.notice = notice
            viewState.message = available
                ? "ShieldBar \(manifest.version) is available."
                : (notice?.title ?? "ShieldBar is up to date.")
            viewState.autoCheck = defaults.object(forKey: Keys.autoCheck) as? Bool ?? true
            viewState.dismissed = dismissed
            viewState.noticeSeen = notice == nil
            viewState.lastCheckedAt = Date()

            return UpdateActionResult(ok: true, message: viewState.message ?? "")
        } catch {
            return fail(error.localizedDescription)
        }
    }

    func dismiss() {
        if let notice = viewState.notice {
            defaults.set(notice.id, forKey: Keys.lastSeenNotice)
        }
        if let version = viewState.latestVersion {
            defaults.set(version, forKey: Keys.dismissedVersion)
        }
        viewState.notice = nil
        viewState.noticeSeen = true
        viewState.dismissed = true
    }

    func openRelease() {
        let raw = viewState.notice?.url ?? viewState.releaseURL?.absoluteString
        guard let raw, let url = URL(string: raw),
              UpdateVerifier.isAllowedReleaseURL(raw)
        else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    func setAutoCheck(_ enabled: Bool) {
        defaults.set(enabled, forKey: Keys.autoCheck)
        viewState.autoCheck = enabled

        if !enabled {
            startupWorkItem?.cancel()
            startupWorkItem = nil
            timer?.invalidate()
            timer = nil
            if viewState.phase == .idle || viewState.phase == .checking {
                viewState.phase = .disabled
            }
            return
        }

        scheduleDailyCheck()
        if viewState.phase == .idle || viewState.phase == .disabled {
            Task { _ = await check(manual: false) }
        }
    }

    private func scheduleStartupCheck() {
        startupWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                _ = await self.check(manual: false)
            }
        }
        startupWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    private func scheduleDailyCheck() {
        timer?.invalidate()
        let timer = Timer(timeInterval: 24 * 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.viewState.autoCheck else { return }
                _ = await self.check(manual: false)
            }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func fail(_ message: String) -> UpdateActionResult {
        viewState.phase = .error
        viewState.message = message
        viewState.lastCheckedAt = Date()
        return UpdateActionResult(ok: false, message: message)
    }
}
