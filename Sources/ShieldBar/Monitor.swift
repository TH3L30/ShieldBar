import AppKit
import Combine
import Foundation
import Network
import ShieldBarCore

@MainActor
final class Monitor: ObservableObject {
    private enum DefaultsKey {
        static let notifyOnLeak = "notifyOnLeak"
        static let hasSeenWelcome = "hasSeenWelcome"
    }

    @Published private(set) var status: ShieldStatus = .idle
    @Published private(set) var evaluation: StatusEvaluation = .idle
    @Published private(set) var report: BrowserLeaksReport?
    @Published private(set) var lastCheckedAt: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var nextCheckAt: Date?
    @Published private(set) var isChecking = false
    @Published private(set) var isNetworkAvailable = true
    @Published var showWelcome: Bool
    @Published var notifyOnLeak: Bool {
        didSet {
            defaults.set(notifyOnLeak, forKey: DefaultsKey.notifyOnLeak)
            if notifyOnLeak {
                notifications.requestAuthorizationIfNeeded()
            } else {
                notifications.cancelLeakNotifications()
            }
        }
    }

    var onNotificationTap: (() -> Void)?

    private let defaults = UserDefaults.standard
    private let probe = BrowserLeaksProbe()
    private let notifications = NotificationManager()
    private let pathMonitor = NWPathMonitor()
    private let pathQueue = DispatchQueue(label: "com.local.shieldbar.pathmonitor")

    private var timer: Timer?
    private var pendingCheck = false
    private var hasStarted = false
    private var popoverOpen = false
    private var protectionArmed = false
    private var lastPathSatisfied: Bool?
    private var lastKnownStatus: ShieldStatus?
    private var wakeObserver: NSObjectProtocol?

    init() {
        let defaults = UserDefaults.standard
        self.notifyOnLeak = defaults.object(forKey: DefaultsKey.notifyOnLeak) as? Bool ?? true
        self.showWelcome = !defaults.bool(forKey: DefaultsKey.hasSeenWelcome)
        notifications.onTap = { [weak self] in
            self?.onNotificationTap?()
        }
    }

    /// Builds a fully populated monitor for offscreen UI previews and tests.
    /// It never contacts BrowserLeaks or starts the path monitor.
    convenience init(
        previewReport: BrowserLeaksReport,
        showWelcome: Bool = false,
        nextCheckIn: TimeInterval = 17
    ) {
        self.init()
        let evaluation = StatusEvaluator.evaluate(previewReport)
        self.report = previewReport
        self.evaluation = evaluation
        self.status = evaluation.status
        self.lastKnownStatus = evaluation.status
        self.lastCheckedAt = previewReport.checkedAt
        self.nextCheckAt = Date().addingTimeInterval(nextCheckIn)
        self.showWelcome = showWelcome
    }

    deinit {
        timer?.invalidate()
        pathMonitor.cancel()
        if let wakeObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver)
        }
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true

        startPathMonitor()
        observeWake()
        notifications.activate()

        if notifyOnLeak {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                self?.notifications.requestAuthorizationIfNeeded()
            }
        }

        checkNow()
    }

    func checkNow() {
        guard hasStarted else { return }

        if isChecking {
            pendingCheck = true
            return
        }

        guard isNetworkAvailable else {
            setOffline(message: "No network connection.")
            scheduleNext()
            return
        }

        isChecking = true
        status = .checking
        evaluation = .checking
        lastError = nil
        nextCheckAt = nil
        timer?.invalidate()

        let previousStatus = lastKnownStatus

        Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                let report = try await self.probe.probe()
                self.report = report
                self.lastCheckedAt = report.checkedAt

                let evaluation = StatusEvaluator.evaluate(report)
                self.evaluation = evaluation
                self.status = evaluation.status
                self.lastKnownStatus = evaluation.status
                self.notifyIfNeeded(previous: previousStatus, current: evaluation.status)
            } catch {
                self.lastError = error.localizedDescription
                self.status = .offline
                self.evaluation = self.offlineEvaluation(message: error.localizedDescription)
                self.lastKnownStatus = .offline
            }

            self.isChecking = false
            self.scheduleNext()

            if self.pendingCheck {
                self.pendingCheck = false
                self.checkNow()
            }
        }
    }

    func setProtectionArmed(_ armed: Bool) {
        guard protectionArmed != armed else { return }
        protectionArmed = armed
        scheduleNext()
    }

    var isProtectionArmed: Bool {
        protectionArmed
    }

    func notifyProtectionTriggered(_ trigger: ProtectionTrigger) {
        notifications.notifyProtectionTriggered(trigger)
    }

    func requestNotificationAuthorization() {
        notifications.requestAuthorizationIfNeeded()
    }

    func notifyUpdateAvailable(_ version: String) {
        notifications.notifyUpdateAvailable(version)
    }

    func setPopoverOpen(_ open: Bool) {
        popoverOpen = open

        if open {
            let age = lastCheckedAt.map { Date().timeIntervalSince($0) } ?? .infinity
            if !isChecking && age > 8 {
                checkNow()
            } else {
                scheduleNext()
            }
        } else {
            scheduleNext()
        }
    }

    func dismissWelcome() {
        showWelcome = false
        defaults.set(true, forKey: DefaultsKey.hasSeenWelcome)
    }

    func toggleNotifications() {
        notifyOnLeak.toggle()
    }

    func relativeAge(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }

    var menuBarTooltip: String {
        var parts = ["ShieldBar — \(evaluation.headline)"]
        if let report {
            parts.append(report.pageIPv4)
        }
        if let lastCheckedAt {
            parts.append("checked \(relativeAge(since: lastCheckedAt))")
        }
        return parts.joined(separator: " · ")
    }

    private func scheduleNext() {
        timer?.invalidate()

        guard !isChecking else {
            nextCheckAt = nil
            return
        }

        let interval: TimeInterval
        if !isNetworkAvailable || status == .offline {
            interval = 60
        } else if protectionArmed {
            interval = 15
        } else if popoverOpen {
            interval = 30
        } else {
            interval = 15 * 60
        }

        let fireDate = Date().addingTimeInterval(interval)
        nextCheckAt = fireDate

        let timer = Timer(timeInterval: interval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.checkNow()
            }
        }
        timer.tolerance = min(interval * 0.1, 5)
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func setOffline(message: String) {
        lastError = message
        status = .offline
        evaluation = offlineEvaluation(message: message)
        lastKnownStatus = .offline
    }

    private func offlineEvaluation(message: String) -> StatusEvaluation {
        StatusEvaluation(
            status: .offline,
            headline: "Offline",
            detail: message,
            localExposed: report?.localAddresses ?? [],
            publicAddresses: report?.publicAddresses ?? [],
            pageAddresses: report?.pageAddresses ?? []
        )
    }

    private func notifyIfNeeded(previous: ShieldStatus?, current: ShieldStatus) {
        guard notifyOnLeak else { return }
        guard current == .publicLeak else { return }
        guard let previous, previous != .publicLeak else { return }
        notifications.notifyPublicLeak()
    }

    private func startPathMonitor() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor [weak self] in
                self?.handlePathUpdate(satisfied: satisfied)
            }
        }
        pathMonitor.start(queue: pathQueue)
    }

    private func handlePathUpdate(satisfied: Bool) {
        let previous = lastPathSatisfied
        lastPathSatisfied = satisfied
        isNetworkAvailable = satisfied

        if !satisfied {
            if !isChecking {
                setOffline(message: "No network connection. ShieldBar will retry automatically.")
                scheduleNext()
            }
            return
        }

        if previous == false {
            // Give DHCP/VPN routes a moment to settle before hitting the site.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.checkNow()
            }
        }
    }

    private func observeWake() {
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.checkNow()
            }
        }
    }
}
