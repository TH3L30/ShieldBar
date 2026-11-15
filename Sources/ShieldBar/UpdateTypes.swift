import Foundation
import ShieldBarCore

struct UpdateViewState {
    var phase: UpdatePhase = .idle
    var currentVersion = "1.1.3"
    var latestVersion: String?
    var releaseURL: URL?
    var notice: UpdateNotice?
    var message: String?
    var autoCheck = true
    var dismissed = false
    var noticeSeen = false
    var lastCheckedAt: Date?

    var updateAvailable: Bool {
        phase == .available && latestVersion != nil && !dismissed
    }
}

struct UpdateActionResult {
    var ok: Bool
    var message: String
}
