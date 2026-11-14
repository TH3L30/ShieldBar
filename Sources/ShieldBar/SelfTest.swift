import Darwin
import Foundation
import ShieldBarCore

@MainActor
enum SelfTest {
    static func run() {
        write("ShieldBar self-test")
        write("Loading https://browserleaks.com/ip in an offscreen WebKit view…")
        write("")

        DispatchQueue.main.asyncAfter(deadline: .now() + 55) {
            write("FAIL: self-test exceeded 55 seconds.")
            exit(2)
        }

        Task { @MainActor in
            let startedAt = Date()
            let probe = BrowserLeaksProbe()

            do {
                let report = try await probe.probe()
                let evaluation = StatusEvaluator.evaluate(report)
                let duration = Date().timeIntervalSince(startedAt)

                write("Page IP:              \(redacted(report.pageIPv4))")
                write("IPv6:                 \(report.pageIPv6 == nil ? "not detected" : "detected")")
                write("Location:             \(report.locationLine ?? "unknown")")
                write("ISP:                  \(report.isp ?? "unknown")")
                write("WebRTC supported:     \(report.rtcSupported)")
                write("WebRTC completed:     \(report.rtcTestCompleted)")
                write("Local IPs exposed:    \(report.localAddresses.count)")
                write("WebRTC public IPs:    \(report.publicAddresses.count)")
                write("Public mismatches:    \(evaluation.publicMismatch.count)")
                write("Strict result:        \(evaluation.headline)")
                write("Verdict detail:       \(evaluation.detail)")
                write("Check duration:       \(String(format: "%.1f", duration))s")
                write("")

                let passed = report.rtcSupported
                    && report.rtcTestCompleted
                    && !report.pageIPv4.isEmpty

                if passed {
                    write("PASS: BrowserLeaks loaded and the IP + WebRTC results were readable.")
                    write("A red or amber strict verdict is a valid finding, not a test failure.")
                } else {
                    write("FAIL: The page loaded but a complete IP + WebRTC result was not available.")
                }

                flush()
                exit(passed ? 0 : 1)
            } catch {
                write("FAIL: \(error.localizedDescription)")
                flush()
                exit(1)
            }
        }
    }

    private static func redacted(_ address: String) -> String {
        if address.contains(":") {
            return "IPv6 present (hidden)"
        }
        let parts = address.split(separator: ".")
        if parts.count == 4 {
            return "\(parts[0]).\(parts[1]).x.x"
        }
        return "present (hidden)"
    }

    private static func write(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    private static func flush() {
        fflush(stdout)
    }
}
