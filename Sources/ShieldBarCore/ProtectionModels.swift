import CryptoKit
import Foundation

public enum ProtectionTrigger: String, Codable, Equatable, Sendable, CaseIterable {
    case publicLeak
    case localExposure
    case locationChange
    case inconclusive

    public var label: String {
        switch self {
        case .publicLeak: return "public IP leak"
        case .localExposure: return "local IP exposure"
        case .locationChange: return "IP location change"
        case .inconclusive: return "inconclusive leak test"
        }
    }
}

public enum LocationField: String, Codable, Equatable, Hashable, Sendable, CaseIterable {
    case country
    case region
    case city
    case isp
    case exactIp

    public var label: String {
        switch self {
        case .country: return "Country"
        case .region: return "Region"
        case .city: return "City"
        case .isp: return "ISP / ASN"
        case .exactIp: return "Exact IP"
        }
    }
}

public struct ProtectionSettings: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var killOnPublicLeak: Bool
    public var killOnLocalExposure: Bool
    public var killOnLocationChange: Bool
    public var locationFields: [LocationField]
    public var failClosed: Bool
    public var startAtLogin: Bool

    public init(
        enabled: Bool = false,
        killOnPublicLeak: Bool = true,
        killOnLocalExposure: Bool = false,
        killOnLocationChange: Bool = true,
        locationFields: [LocationField] = [.country],
        failClosed: Bool = false,
        startAtLogin: Bool = false
    ) {
        self.enabled = enabled
        self.killOnPublicLeak = killOnPublicLeak
        self.killOnLocalExposure = killOnLocalExposure
        self.killOnLocationChange = killOnLocationChange
        self.locationFields = locationFields
        self.failClosed = failClosed
        self.startAtLogin = startAtLogin
    }

    public static let `default` = ProtectionSettings()
}

public struct ProtectionBaseline: Equatable, Sendable {
    public var countryCode: String?
    public var country: String?
    public var region: String?
    public var city: String?
    public var isp: String?
    public var exactIPHash: String?
    public var capturedAt: Date

    public init(
        countryCode: String? = nil,
        country: String? = nil,
        region: String? = nil,
        city: String? = nil,
        isp: String? = nil,
        exactIPHash: String? = nil,
        capturedAt: Date = Date()
    ) {
        self.countryCode = countryCode
        self.country = country
        self.region = region
        self.city = city
        self.isp = isp
        self.exactIPHash = exactIPHash
        self.capturedAt = capturedAt
    }
}

public struct ProtectionBaselineResult: Sendable {
    public var baseline: ProtectionBaseline?
    public var missing: [LocationField]

    public init(baseline: ProtectionBaseline?, missing: [LocationField]) {
        self.baseline = baseline
        self.missing = missing
    }
}

public struct ProtectionEvaluation: Equatable, Sendable {
    public var trigger: ProtectionTrigger?
    public var locationChanged: Bool

    public init(trigger: ProtectionTrigger? = nil, locationChanged: Bool = false) {
        self.trigger = trigger
        self.locationChanged = locationChanged
    }
}

public enum ProtectionEvaluator {
    private static func text(_ value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func normalized(_ value: String?) -> String {
        text(value).lowercased()
    }

    private static func hashAddress(_ address: String, salt: String) -> String {
        let digest = SHA256.hash(data: Data("\(salt):\(text(address))".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func hasField(_ report: BrowserLeaksReport, _ field: LocationField) -> Bool {
        switch field {
        case .country:
            return !text(report.countryCode).isEmpty || !text(report.country).isEmpty
        case .region:
            return !text(report.region).isEmpty
        case .city:
            return !text(report.city).isEmpty
        case .isp:
            return !text(report.isp).isEmpty || !text(report.organization).isEmpty
        case .exactIp:
            return !text(report.pageIPv4).isEmpty
        }
    }

    public static func missingFields(
        report: BrowserLeaksReport,
        fields: [LocationField]
    ) -> [LocationField] {
        fields.filter { !hasField(report, $0) }
    }

    public static func createBaseline(
        report: BrowserLeaksReport,
        fields: [LocationField],
        salt: String,
        now: Date = Date()
    ) -> ProtectionBaselineResult {
        let missing = missingFields(report: report, fields: fields)
        guard missing.isEmpty else {
            return ProtectionBaselineResult(baseline: nil, missing: missing)
        }

        var baseline = ProtectionBaseline(capturedAt: now)
        baseline.countryCode = text(report.countryCode).isEmpty
            ? nil
            : text(report.countryCode).uppercased()
        baseline.country = text(report.country).isEmpty ? nil : text(report.country)
        baseline.region = text(report.region).isEmpty ? nil : text(report.region)
        baseline.city = text(report.city).isEmpty ? nil : text(report.city)
        let isp = text(report.isp).isEmpty ? report.organization : report.isp
        baseline.isp = text(isp).isEmpty ? nil : text(isp)

        if fields.contains(.exactIp) {
            baseline.exactIPHash = hashAddress(report.pageIPv4, salt: salt)
        }

        return ProtectionBaselineResult(baseline: baseline, missing: [])
    }

    public static func baselineLabel(
        _ baseline: ProtectionBaseline,
        fields: [LocationField]
    ) -> String {
        var parts: [String] = []
        if fields.contains(.country) {
            parts.append(text(baseline.country).isEmpty
                ? (text(baseline.countryCode).isEmpty ? "Unknown country" : text(baseline.countryCode))
                : text(baseline.country))
        }
        if fields.contains(.region), !text(baseline.region).isEmpty {
            parts.append(text(baseline.region))
        }
        if fields.contains(.city), !text(baseline.city).isEmpty {
            parts.append(text(baseline.city))
        }
        if fields.contains(.isp), !text(baseline.isp).isEmpty {
            parts.append(text(baseline.isp))
        }
        if fields.contains(.exactIp) {
            parts.append("exact IP")
        }
        return parts.isEmpty ? "No baseline fields" : parts.joined(separator: " · ")
    }

    public static func locationMismatch(
        report: BrowserLeaksReport,
        baseline: ProtectionBaseline,
        fields: [LocationField],
        salt: String
    ) -> Bool {
        if fields.contains(.country) {
            let baselineCode = normalized(baseline.countryCode)
            let reportCode = normalized(report.countryCode)
            if !baselineCode.isEmpty, !reportCode.isEmpty {
                if baselineCode != reportCode { return true }
            } else if normalized(report.country) != normalized(baseline.country) {
                return true
            }
        }

        if fields.contains(.region),
           normalized(report.region) != normalized(baseline.region) {
            return true
        }
        if fields.contains(.city),
           normalized(report.city) != normalized(baseline.city) {
            return true
        }
        if fields.contains(.isp) {
            let current = text(report.isp).isEmpty ? report.organization : report.isp
            if normalized(current) != normalized(baseline.isp) { return true }
        }
        if fields.contains(.exactIp) {
            guard let expected = baseline.exactIPHash else { return true }
            if hashAddress(report.pageIPv4, salt: salt) != expected { return true }
        }

        return false
    }

    public static func evaluate(
        report: BrowserLeaksReport,
        status: ShieldStatus,
        settings: ProtectionSettings,
        baseline: ProtectionBaseline?,
        salt: String
    ) -> ProtectionEvaluation {
        if !report.rtcSupported || !report.rtcTestCompleted {
            return ProtectionEvaluation(
                trigger: settings.failClosed ? .inconclusive : nil
            )
        }

        if status == .publicLeak, settings.killOnPublicLeak {
            return ProtectionEvaluation(trigger: .publicLeak)
        }

        if status == .localExposure, settings.killOnLocalExposure {
            return ProtectionEvaluation(trigger: .localExposure)
        }

        if settings.killOnLocationChange,
           let baseline,
           !settings.locationFields.isEmpty,
           status != .offline,
           status != .inconclusive {
            let changed = locationMismatch(
                report: report,
                baseline: baseline,
                fields: settings.locationFields,
                salt: salt
            )
            if changed {
                return ProtectionEvaluation(trigger: .locationChange, locationChanged: true)
            }
        }

        if status == .inconclusive, settings.failClosed {
            return ProtectionEvaluation(trigger: .inconclusive)
        }

        return ProtectionEvaluation()
    }
}
