import ipaddr from 'ipaddr.js'

/**
 * Returns a stable comparison key for IPv4 and IPv6 addresses.
 * IPv4 keys are `v4:` plus 8 lowercase hex characters; IPv6 keys are `v6:`
 * plus 32 lowercase hex characters. Garbage returns null.
 *
 * Mirrors the macOS `inet_pton` behavior: bracketed addresses and zone ids
 * are accepted, and an IPv4-mapped IPv6 address stays an IPv6 key.
 */
export const IPAddressNormalizer = {
  key(rawValue: string): string | null {
    let value = rawValue.trim()
    if (!value) return null

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1)
    }

    const zoneIndex = value.indexOf('%')
    if (zoneIndex !== -1) {
      value = value.slice(0, zoneIndex)
    }

    if (!value) return null

    let parsed: ipaddr.IPv4 | ipaddr.IPv6
    try {
      parsed = ipaddr.parse(value)
    } catch {
      return null
    }

    const bytes = parsed.toByteArray()
    const hex = bytes
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    return parsed.kind() === 'ipv4' ? `v4:${hex}` : `v6:${hex}`
  },

  isValid(rawValue: string): boolean {
    return IPAddressNormalizer.key(rawValue) !== null
  }
}
