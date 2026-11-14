import Darwin
import Foundation

public enum IPAddressNormalizer {
    /// Returns a stable comparison key for IPv4 and IPv6 addresses.
    /// This lets `2604:a880::1` match `2604:a880:0:0:0:0:0:1`.
    public static func key(for rawValue: String) -> String? {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if value.hasPrefix("["), value.hasSuffix("]") {
            value.removeFirst()
            value.removeLast()
        }

        if let zoneIndex = value.firstIndex(of: "%") {
            value = String(value[..<zoneIndex])
        }

        var ipv4 = in_addr()
        if value.withCString({ inet_pton(AF_INET, $0, &ipv4) }) == 1 {
            let bytes = withUnsafeBytes(of: &ipv4) { Data($0) }
            return "v4:" + bytes.map { String(format: "%02x", $0) }.joined()
        }

        var ipv6 = in6_addr()
        if value.withCString({ inet_pton(AF_INET6, $0, &ipv6) }) == 1 {
            let bytes = withUnsafeBytes(of: &ipv6) { Data($0) }
            return "v6:" + bytes.map { String(format: "%02x", $0) }.joined()
        }

        return nil
    }

    public static func isValid(_ rawValue: String) -> Bool {
        key(for: rawValue) != nil
    }
}
