import CryptoKit
import Foundation

public enum UpdateSeverity: String, Codable, Sendable {
    case info
    case warning
    case critical
}

public struct UpdateNotice: Codable, Equatable, Sendable {
    public var id: String
    public var severity: UpdateSeverity
    public var title: String
    public var message: String
    public var url: String?

    public init(
        id: String,
        severity: UpdateSeverity,
        title: String,
        message: String,
        url: String? = nil
    ) {
        self.id = id
        self.severity = severity
        self.title = title
        self.message = message
        self.url = url
    }
}

public struct UpdateManifest: Codable, Equatable, Sendable {
    public var schema: Int
    public var version: String
    public var releasedAt: String
    public var releaseUrl: String
    public var notice: UpdateNotice?

    public init(
        schema: Int = 1,
        version: String,
        releasedAt: String,
        releaseUrl: String,
        notice: UpdateNotice? = nil
    ) {
        self.schema = schema
        self.version = version
        self.releasedAt = releasedAt
        self.releaseUrl = releaseUrl
        self.notice = notice
    }
}

public enum UpdatePhase: String, Sendable {
    case idle
    case checking
    case upToDate
    case available
    case notice
    case error
    case disabled
}

public enum UpdateVerificationError: LocalizedError {
    case invalidSignature
    case invalidJSON
    case unsupportedSchema
    case invalidVersion
    case invalidDate
    case invalidReleaseURL
    case invalidNotice

    public var errorDescription: String? {
        switch self {
        case .invalidSignature: return "The update manifest signature is invalid."
        case .invalidJSON: return "The update manifest is not valid JSON."
        case .unsupportedSchema: return "Unsupported update manifest schema."
        case .invalidVersion: return "The update manifest version is invalid."
        case .invalidDate: return "The update manifest release date is invalid."
        case .invalidReleaseURL: return "The update manifest release URL is not allowed."
        case .invalidNotice: return "The update notice is invalid."
        }
    }
}

public enum UpdateVerifier {
    public static let productionPublicKeyBase64 =
        "sZ6zcLMOxjlDfxJNC30eO0XrnIr11e6dUE1MHES7rMw="
    public static let releasePrefix = "https://github.com/TH3L30/ShieldBar/releases/"

    public static func verify(
        payload: Data,
        signature: Data,
        publicKeyBase64: String = productionPublicKeyBase64
    ) -> Bool {
        guard let rawKey = Data(base64Encoded: publicKeyBase64),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: rawKey)
        else {
            return false
        }
        return key.isValidSignature(signature, for: payload)
    }

    public static func parse(
        payload: Data,
        signature: Data,
        currentVersion: String,
        publicKeyBase64: String = productionPublicKeyBase64
    ) throws -> (manifest: UpdateManifest, available: Bool) {
        guard verify(payload: payload, signature: signature, publicKeyBase64: publicKeyBase64) else {
            throw UpdateVerificationError.invalidSignature
        }

        let decoder = JSONDecoder()
        guard var manifest = try? decoder.decode(UpdateManifest.self, from: payload) else {
            throw UpdateVerificationError.invalidJSON
        }
        guard manifest.schema == 1 else {
            throw UpdateVerificationError.unsupportedSchema
        }
        guard isValidVersion(manifest.version) else {
            throw UpdateVerificationError.invalidVersion
        }
        guard ISO8601DateFormatter().date(from: manifest.releasedAt) != nil else {
            throw UpdateVerificationError.invalidDate
        }
        guard isAllowedReleaseURL(manifest.releaseUrl) else {
            throw UpdateVerificationError.invalidReleaseURL
        }

        if let notice = manifest.notice {
            guard !notice.id.isEmpty, notice.id.count <= 80,
                  !notice.title.isEmpty, notice.title.count <= 120,
                  !notice.message.isEmpty, notice.message.count <= 1000,
                  notice.severity == .info || notice.severity == .warning || notice.severity == .critical
            else {
                throw UpdateVerificationError.invalidNotice
            }
            if let url = notice.url, !isAllowedReleaseURL(url) {
                throw UpdateVerificationError.invalidNotice
            }
        } else {
            manifest.notice = nil
        }

        return (manifest, isNewerVersion(manifest.version, than: currentVersion))
    }

    public static func isNewerVersion(_ latest: String, than current: String) -> Bool {
        guard let left = versionParts(latest), let right = versionParts(current) else {
            return false
        }
        for index in 0..<3 {
            if left[index] != right[index] {
                return left[index] > right[index]
            }
        }
        return false
    }

    public static func isAllowedReleaseURL(_ rawValue: String) -> Bool {
        guard rawValue.hasPrefix(releasePrefix),
              let url = URL(string: rawValue),
              url.scheme == "https",
              url.host == "github.com"
        else {
            return false
        }
        return !rawValue.contains(" ")
    }

    private static func isValidVersion(_ value: String) -> Bool {
        versionParts(value) != nil
    }

    private static func versionParts(_ value: String) -> [Int]? {
        let parts = value.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var numbers: [Int] = []
        for part in parts {
            guard let number = Int(part), number >= 0 else { return nil }
            numbers.append(number)
        }
        return numbers
    }
}
