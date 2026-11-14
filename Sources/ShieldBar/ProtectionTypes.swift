import Foundation
import ShieldBarCore

enum ProtectionPhase: String {
    case unavailable
    case ready
    case armed
    case triggering
    case triggered
    case restoring
    case error

    var label: String {
        switch self {
        case .unavailable: return "Helper missing"
        case .ready: return "Ready"
        case .armed: return "Armed"
        case .triggering: return "Triggering"
        case .triggered: return "Network disabled"
        case .restoring: return "Restoring"
        case .error: return "Error"
        }
    }
}

struct ProtectionActionResult {
    var ok: Bool
    var message: String
}

struct VPNAdapterInfo: Identifiable, Equatable {
    var id: String { name }
    var name: String
    var likelyVPN: Bool
}

struct RemoteSessionInfo: Equatable {
    var detected: Bool
    var kind: String?

    static let none = RemoteSessionInfo(detected: false, kind: nil)
}

struct ProtectionViewState {
    var phase: ProtectionPhase = .unavailable
    var helperInstalled = false
    var helperVersion: String?
    var settings = ProtectionSettings.default
    var baselineLabel: String?
    var baselineCapturedAt: Date?
    var armed = false
    var triggered = false
    var message: String?
    var lastTrigger: ProtectionTrigger?
    var vpnAdapters: [VPNAdapterInfo] = []
    var remoteSession = RemoteSessionInfo.none
    var currentStatus: ShieldStatus = .idle
    var currentHeadline = "Not checked yet"
    var lastCheckedAt: Date?
    var canSetBaseline = false
    var canArm = false
}
