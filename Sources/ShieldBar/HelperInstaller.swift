import Foundation

enum HelperInstaller {
    static func helperURL() -> URL? {
        if let resources = Bundle.main.resourceURL {
            let candidate = resources
                .appendingPathComponent("helper")
                .appendingPathComponent("shieldbar-helper")
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }

        if let executable = Bundle.main.executableURL {
            let candidate = executable
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("Resources/helper/shieldbar-helper")
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }

        return nil
    }

    static func install() async -> ProtectionActionResult {
        guard let helper = helperURL() else {
            return ProtectionActionResult(
                ok: false,
                message: "The helper binary is missing from the app bundle. Rebuild with Scripts/build-app.sh."
            )
        }

        let command = "\(shellQuote(helper.path)) install --uid \(getuid()) --gid \(getgid())"
        return await runElevated(command: command, success: "Protection helper installed.")
    }

    static func uninstall() async -> ProtectionActionResult {
        guard let helper = helperURL() else {
            return ProtectionActionResult(ok: false, message: "The helper binary is missing.")
        }
        return await runElevated(
            command: "\(shellQuote(helper.path)) uninstall",
            success: "Protection helper removed."
        )
    }

    private static func runElevated(
        command: String,
        success: String
    ) async -> ProtectionActionResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let script = "do shell script \(appleScriptQuote(command)) with administrator privileges"
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                process.arguments = ["-e", script]

                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr

                do {
                    try process.run()
                    process.waitUntilExit()

                    let output = String(
                        data: stdout.fileHandleForReading.readDataToEndOfFile(),
                        encoding: .utf8
                    )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    let errorOutput = String(
                        data: stderr.fileHandleForReading.readDataToEndOfFile(),
                        encoding: .utf8
                    )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

                    if process.terminationStatus == 0 {
                        continuation.resume(
                            returning: ProtectionActionResult(
                                ok: true,
                                message: output.isEmpty ? success : output
                            )
                        )
                        return
                    }

                    let message = errorOutput.isEmpty ? output : errorOutput
                    let cancelled = message.lowercased().contains("user canceled")
                        || message.lowercased().contains("user cancelled")
                    continuation.resume(
                        returning: ProtectionActionResult(
                            ok: false,
                            message: cancelled
                                ? "Administrator approval was canceled."
                                : (message.isEmpty
                                    ? "The helper installer failed."
                                    : message)
                        )
                    )
                } catch {
                    continuation.resume(
                        returning: ProtectionActionResult(
                            ok: false,
                            message: error.localizedDescription
                        )
                    )
                }
            }
        }
    }

    private static func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private static func appleScriptQuote(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(escaped)\""
    }
}
