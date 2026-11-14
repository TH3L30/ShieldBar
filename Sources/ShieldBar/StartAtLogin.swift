import Foundation

enum StartAtLogin {
    private static let label = "com.local.shieldbar"

    static func apply(_ enabled: Bool) {
        guard Bundle.main.bundleURL.pathExtension == "app" else { return }

        let fileManager = FileManager.default
        guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            return
        }
        let directory = library.appendingPathComponent("LaunchAgents", isDirectory: true)
        let plist = directory.appendingPathComponent("\(label).plist")

        if !enabled {
            try? fileManager.removeItem(at: plist)
            return
        }

        guard let executable = Bundle.main.executableURL?.path else { return }

        let payload: [String: Any] = [
            "Label": label,
            "ProgramArguments": [executable],
            "RunAtLoad": true,
            "KeepAlive": false,
            "ProcessType": "Interactive"
        ]

        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try PropertyListSerialization.data(
                fromPropertyList: payload,
                format: .xml,
                options: 0
            )
            try data.write(to: plist, options: .atomic)
        } catch {
            FileHandle.standardError.write(
                Data("ShieldBar: could not update start-at-login: \(error.localizedDescription)\n".utf8)
            )
        }
    }
}
