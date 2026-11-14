import Foundation
import Testing
@testable import ShieldBarCore

struct ProtectionTests {
    private func report(
        pageIPv4: String = "203.0.113.42",
        countryCode: String? = "CA",
        country: String? = "Canada",
        region: String? = "Ontario",
        city: String? = "Toronto",
        isp: String? = "Example ISP",
        organization: String? = "Example Network",
        completed: Bool = true
    ) -> BrowserLeaksReport {
        BrowserLeaksReport(
            pageIPv4: pageIPv4,
            countryCode: countryCode,
            country: country,
            region: region,
            city: city,
            isp: isp,
            organization: organization,
            rtcSupported: true,
            rtcTestCompleted: completed,
            rtcPublic: [WebRTCAddress(address: pageIPv4)]
        )
    }

    private func settings(
        publicLeak: Bool = true,
        localExposure: Bool = false,
        location: Bool = true,
        fields: [LocationField] = [.country],
        failClosed: Bool = false
    ) -> ProtectionSettings {
        ProtectionSettings(
            enabled: true,
            killOnPublicLeak: publicLeak,
            killOnLocalExposure: localExposure,
            killOnLocationChange: location,
            locationFields: fields,
            failClosed: failClosed
        )
    }

    @Test func baselineCapturesCountryAndHash() {
        let result = ProtectionEvaluator.createBaseline(
            report: report(),
            fields: [.country, .exactIp],
            salt: "salt"
        )

        #expect(result.missing.isEmpty)
        #expect(result.baseline?.countryCode == "CA")
        #expect(result.baseline?.exactIPHash?.count == 64)
        #expect(result.baseline?.exactIPHash?.contains("203.0.113.42") == false)
        #expect(
            ProtectionEvaluator.baselineLabel(result.baseline!, fields: [.country, .exactIp])
                == "Canada · exact IP"
        )
    }

    @Test func baselineReportsMissingFields() {
        let result = ProtectionEvaluator.createBaseline(
            report: report(region: nil, city: nil),
            fields: [.country, .region, .city],
            salt: "salt"
        )

        #expect(result.baseline == nil)
        #expect(result.missing == [.region, .city])
    }

    @Test func countryMismatchDetected() {
        let baseline = ProtectionEvaluator.createBaseline(
            report: report(),
            fields: [.country],
            salt: "salt"
        ).baseline!

        #expect(
            ProtectionEvaluator.locationMismatch(
                report: report(countryCode: "US", country: "United States"),
                baseline: baseline,
                fields: [.country],
                salt: "salt"
            )
        )
    }

    @Test func exactIPMismatchWithoutStoringAddress() {
        let baseline = ProtectionEvaluator.createBaseline(
            report: report(),
            fields: [.country, .exactIp],
            salt: "salt"
        ).baseline!

        #expect(
            ProtectionEvaluator.locationMismatch(
                report: report(pageIPv4: "198.51.100.9"),
                baseline: baseline,
                fields: [.exactIp],
                salt: "salt"
            )
        )
    }

    @Test func publicLeakTriggersImmediately() {
        let result = ProtectionEvaluator.evaluate(
            report: report(),
            status: .publicLeak,
            settings: settings(),
            baseline: nil,
            salt: "salt"
        )
        #expect(result.trigger == .publicLeak)
    }

    @Test func localExposureIsOptional() {
        let enabled = ProtectionEvaluator.evaluate(
            report: report(),
            status: .localExposure,
            settings: settings(localExposure: true),
            baseline: nil,
            salt: "salt"
        )
        let disabled = ProtectionEvaluator.evaluate(
            report: report(),
            status: .localExposure,
            settings: settings(localExposure: false),
            baseline: nil,
            salt: "salt"
        )
        #expect(enabled.trigger == .localExposure)
        #expect(disabled.trigger == nil)
    }

    @Test func locationChangeTriggersOnlyWhenEnabled() {
        let baseline = ProtectionEvaluator.createBaseline(
            report: report(),
            fields: [.country],
            salt: "salt"
        ).baseline!
        let changed = report(countryCode: "US", country: "United States")

        #expect(
            ProtectionEvaluator.evaluate(
                report: changed,
                status: .clear,
                settings: settings(location: true),
                baseline: baseline,
                salt: "salt"
            ).trigger == .locationChange
        )
        #expect(
            ProtectionEvaluator.evaluate(
                report: changed,
                status: .clear,
                settings: settings(location: false),
                baseline: baseline,
                salt: "salt"
            ).trigger == nil
        )
    }

    @Test func incompleteResultRespectsFailMode() {
        let failClosed = ProtectionEvaluator.evaluate(
            report: report(completed: false),
            status: .inconclusive,
            settings: settings(failClosed: true),
            baseline: nil,
            salt: "salt"
        )
        let failOpen = ProtectionEvaluator.evaluate(
            report: report(completed: false),
            status: .inconclusive,
            settings: settings(failClosed: false),
            baseline: nil,
            salt: "salt"
        )

        #expect(failClosed.trigger == .inconclusive)
        #expect(failOpen.trigger == nil)
    }

    @Test func locationIsNotCheckedOnInconclusiveResult() {
        let baseline = ProtectionEvaluator.createBaseline(
            report: report(),
            fields: [.country],
            salt: "salt"
        ).baseline!
        let result = ProtectionEvaluator.evaluate(
            report: report(countryCode: "US", country: "United States", completed: false),
            status: .inconclusive,
            settings: settings(failClosed: false),
            baseline: baseline,
            salt: "salt"
        )

        #expect(result.trigger == nil)
        #expect(result.locationChanged == false)
    }
}
