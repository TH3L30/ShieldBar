import Foundation

public struct WebRTCAddress: Codable, Equatable, Hashable, Sendable {
    public var address: String
    public var country: String?
    public var countryCode: String?

    public init(address: String, country: String? = nil, countryCode: String? = nil) {
        self.address = address
        self.country = country
        self.countryCode = countryCode
    }
}

public struct BrowserLeaksReport: Codable, Equatable, Sendable {
    public var pageIPv4: String
    public var pageIPv6: String?
    public var countryCode: String?
    public var country: String?
    public var region: String?
    public var city: String?
    public var isp: String?
    public var organization: String?
    public var rtcSupported: Bool
    public var rtcTestCompleted: Bool
    public var rtcLocal: [WebRTCAddress]
    public var rtcPublic: [WebRTCAddress]
    public var rtcLocalText: String?
    public var rtcPublicText: String?
    public var rtcLeakText: String?
    public var rtcMismatchText: String?
    public var checkedAt: Date
    public var duration: TimeInterval

    public init(
        pageIPv4: String,
        pageIPv6: String? = nil,
        countryCode: String? = nil,
        country: String? = nil,
        region: String? = nil,
        city: String? = nil,
        isp: String? = nil,
        organization: String? = nil,
        rtcSupported: Bool = true,
        rtcTestCompleted: Bool = true,
        rtcLocal: [WebRTCAddress] = [],
        rtcPublic: [WebRTCAddress] = [],
        rtcLocalText: String? = nil,
        rtcPublicText: String? = nil,
        rtcLeakText: String? = nil,
        rtcMismatchText: String? = nil,
        checkedAt: Date = Date(),
        duration: TimeInterval = 0
    ) {
        self.pageIPv4 = pageIPv4
        self.pageIPv6 = pageIPv6
        self.countryCode = countryCode
        self.country = country
        self.region = region
        self.city = city
        self.isp = isp
        self.organization = organization
        self.rtcSupported = rtcSupported
        self.rtcTestCompleted = rtcTestCompleted
        self.rtcLocal = rtcLocal
        self.rtcPublic = rtcPublic
        self.rtcLocalText = rtcLocalText
        self.rtcPublicText = rtcPublicText
        self.rtcLeakText = rtcLeakText
        self.rtcMismatchText = rtcMismatchText
        self.checkedAt = checkedAt
        self.duration = duration
    }

    public var pageAddresses: [String] {
        [pageIPv4, pageIPv6].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }
    }

    public var publicAddresses: [String] {
        uniqueAddresses(rtcPublic.map(\.address))
    }

    public var localAddresses: [String] {
        uniqueAddresses(rtcLocal.map(\.address))
    }

    public var locationLine: String? {
        let parts = [city, region, country]
            .compactMap { value -> String? in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private func uniqueAddresses(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for value in values {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let key = IPAddressNormalizer.key(for: trimmed) ?? trimmed.lowercased()
            if seen.insert(key).inserted {
                result.append(trimmed)
            }
        }
        return result
    }
}

public enum ShieldStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case idle
    case checking
    case clear
    case localExposure
    case publicLeak
    case inconclusive
    case offline

    public var isLeak: Bool {
        self == .publicLeak || self == .localExposure
    }

    public var isFailure: Bool {
        self == .offline || self == .inconclusive
    }
}

public struct StatusEvaluation: Equatable, Sendable {
    public var status: ShieldStatus
    public var headline: String
    public var detail: String
    public var publicMismatch: [String]
    public var localExposed: [String]
    public var publicAddresses: [String]
    public var pageAddresses: [String]

    public init(
        status: ShieldStatus,
        headline: String,
        detail: String,
        publicMismatch: [String] = [],
        localExposed: [String] = [],
        publicAddresses: [String] = [],
        pageAddresses: [String] = []
    ) {
        self.status = status
        self.headline = headline
        self.detail = detail
        self.publicMismatch = publicMismatch
        self.localExposed = localExposed
        self.publicAddresses = publicAddresses
        self.pageAddresses = pageAddresses
    }

    public static let checking = StatusEvaluation(
        status: .checking,
        headline: "Checking…",
        detail: "Running the BrowserLeaks IP and WebRTC test."
    )

    public static let idle = StatusEvaluation(
        status: .idle,
        headline: "Not checked yet",
        detail: "Click Refresh to run the first BrowserLeaks check."
    )
}

public enum StatusEvaluator {
    public static func evaluate(_ report: BrowserLeaksReport) -> StatusEvaluation {
        let pageAddresses = report.pageAddresses
        let publicAddresses = report.publicAddresses
        let localAddresses = report.localAddresses

        guard report.rtcSupported else {
            return StatusEvaluation(
                status: .inconclusive,
                headline: "Inconclusive",
                detail: "This WebKit build did not expose RTCPeerConnection, so the WebRTC leak test could not run.",
                localExposed: localAddresses,
                publicAddresses: publicAddresses,
                pageAddresses: pageAddresses
            )
        }

        guard report.rtcTestCompleted else {
            return StatusEvaluation(
                status: .inconclusive,
                headline: "Inconclusive",
                detail: "The BrowserLeaks WebRTC test did not finish. The page may have changed, or the test may be blocked.",
                localExposed: localAddresses,
                publicAddresses: publicAddresses,
                pageAddresses: pageAddresses
            )
        }

        guard !pageAddresses.isEmpty else {
            return StatusEvaluation(
                status: .inconclusive,
                headline: "Inconclusive",
                detail: "BrowserLeaks did not return a public IP to compare against.",
                localExposed: localAddresses,
                publicAddresses: publicAddresses
            )
        }

        guard !publicAddresses.isEmpty else {
            return StatusEvaluation(
                status: .inconclusive,
                headline: "Inconclusive",
                detail: "No public WebRTC candidate was returned. UDP or STUN may be blocked on this network.",
                localExposed: localAddresses,
                publicAddresses: publicAddresses,
                pageAddresses: pageAddresses
            )
        }

        let pageKeys = Set(pageAddresses.compactMap(IPAddressNormalizer.key(for:)))
        let mismatch = publicAddresses.filter { address in
            guard let key = IPAddressNormalizer.key(for: address) else { return true }
            return !pageKeys.contains(key)
        }

        if !mismatch.isEmpty {
            return StatusEvaluation(
                status: .publicLeak,
                headline: "Public IP leak",
                detail: "WebRTC sees a different public IP than BrowserLeaks. If you are using a VPN or proxy, traffic may be bypassing it.",
                publicMismatch: mismatch,
                localExposed: localAddresses,
                publicAddresses: publicAddresses,
                pageAddresses: pageAddresses
            )
        }

        if !localAddresses.isEmpty {
            return StatusEvaluation(
                status: .localExposure,
                headline: "Local IP exposed",
                detail: "WebRTC exposed a local/private IP, but the public IP matches BrowserLeaks. This is a privacy exposure, not a public-IP leak.",
                localExposed: localAddresses,
                publicAddresses: publicAddresses,
                pageAddresses: pageAddresses
            )
        }

        return StatusEvaluation(
            status: .clear,
            headline: "Clear",
            detail: "The WebRTC test sees the same public IP as BrowserLeaks, and no local IPs were exposed.",
            publicAddresses: publicAddresses,
            pageAddresses: pageAddresses
        )
    }
}
