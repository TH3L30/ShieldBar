import CryptoKit
import Foundation
import Testing
@testable import ShieldBarCore

struct UpdateTests {
    private let privateKey = Curve25519.Signing.PrivateKey()

    private var publicKeyBase64: String {
        privateKey.publicKey.rawRepresentation.base64EncodedString()
    }

    private func signed(
        version: String = "1.1.2",
        releaseUrl: String = "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2",
        notice: UpdateNotice? = nil
    ) throws -> (Data, Data) {
        let manifest = UpdateManifest(
            version: version,
            releasedAt: "2026-11-15T00:00:00Z",
            releaseUrl: releaseUrl,
            notice: notice
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload = try encoder.encode(manifest)
        let signature = try privateKey.signature(for: payload)
        return (payload, signature)
    }

    @Test func verifiesSignedManifest() throws {
        let (payload, signature) = try signed()

        let parsed = try UpdateVerifier.parse(
            payload: payload,
            signature: signature,
            currentVersion: "1.1.1",
            publicKeyBase64: publicKeyBase64
        )

        #expect(parsed.available)
        #expect(parsed.manifest.version == "1.1.2")
    }

    @Test func sameVersionIsNotNewer() throws {
        let (payload, signature) = try signed()

        let parsed = try UpdateVerifier.parse(
            payload: payload,
            signature: signature,
            currentVersion: "1.1.2",
            publicKeyBase64: publicKeyBase64
        )

        #expect(parsed.available == false)
    }

    @Test func rejectsTamperedManifest() throws {
        var (payload, signature) = try signed()
        payload.append(0x20)

        #expect(
            throws: UpdateVerificationError.invalidSignature
        ) {
            _ = try UpdateVerifier.parse(
                payload: payload,
                signature: signature,
                currentVersion: "1.1.1",
                publicKeyBase64: publicKeyBase64
            )
        }
    }

    @Test func rejectsUntrustedReleaseURL() throws {
        let (payload, signature) = try signed(
            releaseUrl: "https://example.com/ShieldBar/releases/tag/v1.1.2"
        )

        #expect(
            throws: UpdateVerificationError.invalidReleaseURL
        ) {
            _ = try UpdateVerifier.parse(
                payload: payload,
                signature: signature,
                currentVersion: "1.1.1",
                publicKeyBase64: publicKeyBase64
            )
        }
    }

    @Test func acceptsValidNotice() throws {
        let notice = UpdateNotice(
            id: "security-2026-01",
            severity: .critical,
            title: "Security notice",
            message: "Please update.",
            url: "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2"
        )
        let (payload, signature) = try signed(notice: notice)

        let parsed = try UpdateVerifier.parse(
            payload: payload,
            signature: signature,
            currentVersion: "1.1.2",
            publicKeyBase64: publicKeyBase64
        )

        #expect(parsed.manifest.notice?.severity == .critical)
    }

    @Test func verifiesProductionSignedReleaseFixture() throws {
        let payload = """
        {
          "schema": 1,
          "version": "1.1.2",
          "releasedAt": "2026-11-15T02:29:53.394Z",
          "releaseUrl": "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2",
          "notice": null
        }

        """
        let signature = Data(
            base64Encoded: "ObGQidix3jRcR0qHzr8QN1gvIFt2+LUO8nKjeRW89JFdxvpcKzYLrXh3HMpTMqfxE05Fkx98IwLErBaj0zyfAw=="
        )!

        let parsed = try UpdateVerifier.parse(
            payload: Data(payload.utf8),
            signature: signature,
            currentVersion: "1.1.1"
        )

        #expect(parsed.available)
        #expect(parsed.manifest.version == "1.1.2")
    }

    @Test func comparesVersionsNumerically() {
        #expect(UpdateVerifier.isNewerVersion("1.2.0", than: "1.1.9"))
        #expect(UpdateVerifier.isNewerVersion("1.1.10", than: "1.1.9"))
        #expect(UpdateVerifier.isNewerVersion("1.1.2", than: "1.1.2") == false)
        #expect(UpdateVerifier.isNewerVersion("1.0.9", than: "1.1.0") == false)
    }

    @Test func restrictsReleaseURLs() {
        #expect(
            UpdateVerifier.isAllowedReleaseURL(
                "https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2"
            )
        )
        #expect(
            UpdateVerifier.isAllowedReleaseURL(
                "https://github.com/TH3L30/ShieldBar/releases/download/v1.1.2/file.zip"
            )
        )
        #expect(
            UpdateVerifier.isAllowedReleaseURL(
                "https://github.com/other/repo/releases/tag/v1.1.2"
            ) == false
        )
        #expect(
            UpdateVerifier.isAllowedReleaseURL(
                "https://example.com/TH3L30/ShieldBar/releases/tag/v1.1.2"
            ) == false
        )
    }
}
