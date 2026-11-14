import Testing
@testable import ShieldBarCore

struct StatusEvaluatorTests {
    private func report(
        pageIPv4: String = "203.0.113.42",
        pageIPv6: String? = nil,
        publicAddresses: [String] = ["203.0.113.42"],
        localAddresses: [String] = [],
        supported: Bool = true,
        completed: Bool = true
    ) -> BrowserLeaksReport {
        BrowserLeaksReport(
            pageIPv4: pageIPv4,
            pageIPv6: pageIPv6,
            rtcSupported: supported,
            rtcTestCompleted: completed,
            rtcLocal: localAddresses.map { WebRTCAddress(address: $0) },
            rtcPublic: publicAddresses.map { WebRTCAddress(address: $0) }
        )
    }

    @Test func matchingPublicAddressIsClear() {
        let evaluation = StatusEvaluator.evaluate(report())

        #expect(evaluation.status == .clear)
        #expect(evaluation.headline == "Clear")
        #expect(evaluation.publicMismatch.isEmpty)
        #expect(evaluation.localExposed.isEmpty)
    }

    @Test func differentPublicAddressIsLeak() {
        let evaluation = StatusEvaluator.evaluate(
            report(publicAddresses: ["198.51.100.9"])
        )

        #expect(evaluation.status == .publicLeak)
        #expect(evaluation.publicMismatch == ["198.51.100.9"])
    }

    @Test func localAddressWithoutPublicMismatchIsLocalExposure() {
        let evaluation = StatusEvaluator.evaluate(
            report(localAddresses: ["192.168.1.12"])
        )

        #expect(evaluation.status == .localExposure)
        #expect(evaluation.localExposed == ["192.168.1.12"])
    }

    @Test func localAndPublicLeakPrefersPublicLeak() {
        let evaluation = StatusEvaluator.evaluate(
            report(
                publicAddresses: ["198.51.100.9"],
                localAddresses: ["192.168.1.12"]
            )
        )

        #expect(evaluation.status == .publicLeak)
        #expect(evaluation.localExposed == ["192.168.1.12"])
    }

    @Test func ipv6EquivalentFormsMatch() {
        let evaluation = StatusEvaluator.evaluate(
            report(
                pageIPv6: "2604:a880:0:0:0:0:0:1",
                publicAddresses: ["2604:a880::1"]
            )
        )

        #expect(evaluation.status == .clear)
    }

    @Test func mismatchedIPV6IsLeak() {
        let evaluation = StatusEvaluator.evaluate(
            report(
                pageIPv6: "2604:a880::1",
                publicAddresses: ["2604:a880::2"]
            )
        )

        #expect(evaluation.status == .publicLeak)
    }

    @Test func noPublicCandidateIsInconclusive() {
        let evaluation = StatusEvaluator.evaluate(
            report(publicAddresses: [])
        )

        #expect(evaluation.status == .inconclusive)
        #expect(evaluation.detail.contains("No public WebRTC candidate"))
    }

    @Test func incompleteTestIsInconclusive() {
        let evaluation = StatusEvaluator.evaluate(
            report(completed: false)
        )

        #expect(evaluation.status == .inconclusive)
    }

    @Test func unsupportedWebRTCIsInconclusive() {
        let evaluation = StatusEvaluator.evaluate(
            report(supported: false)
        )

        #expect(evaluation.status == .inconclusive)
        #expect(evaluation.detail.contains("RTCPeerConnection"))
    }

    @Test func duplicatePublicAddressesAreDeduplicated() {
        let evaluation = StatusEvaluator.evaluate(
            report(publicAddresses: ["203.0.113.42", "203.0.113.42"])
        )

        #expect(evaluation.status == .clear)
        #expect(evaluation.publicAddresses.count == 1)
    }

    @Test func invalidPublicAddressIsTreatedAsMismatch() {
        let evaluation = StatusEvaluator.evaluate(
            report(publicAddresses: ["not-an-ip"])
        )

        #expect(evaluation.status == .publicLeak)
        #expect(evaluation.publicMismatch == ["not-an-ip"])
    }

    @Test func ipAddressNormalizerRejectsGarbage() {
        #expect(IPAddressNormalizer.isValid("999.1.1.1") == false)
        #expect(IPAddressNormalizer.isValid("hello") == false)
        #expect(IPAddressNormalizer.isValid("203.0.113.42"))
        #expect(IPAddressNormalizer.isValid("2001:db8::1"))
    }

    @Test func publicMismatchTakesPrecedenceOverLocalExposure() {
        let evaluation = StatusEvaluator.evaluate(
            report(
                publicAddresses: ["198.51.100.9", "203.0.113.42"],
                localAddresses: ["10.0.0.8"]
            )
        )

        #expect(evaluation.status == .publicLeak)
        #expect(evaluation.localExposed == ["10.0.0.8"])
    }

    @Test func emptyPageAddressIsInconclusive() {
        let evaluation = StatusEvaluator.evaluate(
            report(pageIPv4: "", publicAddresses: [])
        )

        #expect(evaluation.status == .inconclusive)
    }
}
