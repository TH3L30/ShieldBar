import Darwin
import Foundation

enum HelperClientError: LocalizedError {
    case notInstalled
    case socket(String)
    case timeout
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .notInstalled:
            return "The protection helper is not installed or is not running."
        case .socket(let message):
            return "Protection helper error: \(message)"
        case .timeout:
            return "The protection helper did not respond in time."
        case .invalidResponse(let message):
            return "The protection helper returned invalid data: \(message)"
        }
    }
}

struct HelperResponse: Decodable, Sendable {
    var ok: Bool
    var protocolVersion: Int?
    var version: String?
    var state: String?
    var triggered: Bool?
    var interfaces: [String]?
    var message: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case protocolVersion = "protocol"
        case version
        case state
        case triggered
        case interfaces
        case message
    }
}

struct HelperClient: Sendable {
    var socketPath = "/var/run/com.local.shieldbar.helper.sock"
    var timeout: TimeInterval = 8

    func status() async throws -> HelperResponse {
        try await request("status")
    }

    func disable() async throws -> HelperResponse {
        try await request("disable", timeout: 45)
    }

    func restore() async throws -> HelperResponse {
        try await request("restore", timeout: 60)
    }

    func request(_ command: String, timeout: TimeInterval? = nil) async throws -> HelperResponse {
        let effectiveTimeout = timeout ?? self.timeout
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let response = try Self.syncRequest(
                        socketPath: socketPath,
                        command: command,
                        timeout: effectiveTimeout
                    )
                    continuation.resume(returning: response)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func syncRequest(
        socketPath: String,
        command: String,
        timeout: TimeInterval
    ) throws -> HelperResponse {
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw HelperClientError.socket(String(cString: strerror(errno)))
        }
        defer { close(descriptor) }

        var sendTimeout = timeval(
            tv_sec: Int(timeout),
            tv_usec: suseconds_t((timeout - Double(Int(timeout))) * 1_000_000)
        )
        setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &sendTimeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &sendTimeout, socklen_t(MemoryLayout<timeval>.size))

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8) + [0]
        guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw HelperClientError.socket("socket path is too long")
        }

        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: pathBytes.count) { destination in
                for (index, byte) in pathBytes.enumerated() {
                    destination[index] = CChar(bitPattern: byte)
                }
            }
        }

        let connectResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                connect(
                    descriptor,
                    sockaddrPointer,
                    socklen_t(MemoryLayout<sockaddr_un>.size)
                )
            }
        }
        guard connectResult == 0 else {
            if errno == ECONNREFUSED || errno == ENOENT {
                throw HelperClientError.notInstalled
            }
            throw HelperClientError.socket(String(cString: strerror(errno)))
        }

        let request = try JSONSerialization.data(
            withJSONObject: ["command": command, "protocol": 1]
        ) + Data([0x0A])

        try request.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var written = 0
            while written < request.count {
                let result = Darwin.write(
                    descriptor,
                    base.advanced(by: written),
                    request.count - written
                )
                if result <= 0 {
                    throw HelperClientError.socket(String(cString: strerror(errno)))
                }
                written += result
            }
        }

        var responseData = Data()
        var buffer = [UInt8](repeating: 0, count: 65_536)
        while true {
            let count = buffer.withUnsafeMutableBytes { rawBuffer in
                Darwin.read(descriptor, rawBuffer.baseAddress, rawBuffer.count)
            }
            if count < 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK {
                    throw HelperClientError.timeout
                }
                throw HelperClientError.socket(String(cString: strerror(errno)))
            }
            if count == 0 { break }
            responseData.append(contentsOf: buffer.prefix(count))
            if responseData.contains(0x0A) { break }
            if responseData.count > 65_536 {
                throw HelperClientError.invalidResponse("response too large")
            }
        }

        guard let newline = responseData.firstIndex(of: 0x0A) else {
            throw HelperClientError.invalidResponse("missing newline")
        }
        let payload = responseData[..<newline]
        guard !payload.isEmpty else {
            throw HelperClientError.invalidResponse("empty response")
        }

        do {
            return try JSONDecoder().decode(HelperResponse.self, from: Data(payload))
        } catch {
            throw HelperClientError.invalidResponse(error.localizedDescription)
        }
    }
}
