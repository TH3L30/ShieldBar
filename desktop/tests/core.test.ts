import { describe, expect, it } from 'vitest'
import type { BrowserLeaksReport } from '../src/core/models'
import {
  pageAddresses,
  reportLocalAddresses,
  reportPublicAddresses
} from '../src/core/models'
import { IPAddressNormalizer } from '../src/core/ip'
import { StatusEvaluator } from '../src/core/evaluator'
import { checkIntervalMs } from '../src/core/schedule'

function report(
  overrides: Partial<BrowserLeaksReport> & {
    publicAddresses?: string[]
    localAddresses?: string[]
    supported?: boolean
    completed?: boolean
  } = {}
): BrowserLeaksReport {
  const {
    publicAddresses = ['203.0.113.42'],
    localAddresses = [],
    supported = true,
    completed = true,
    ...rest
  } = overrides

  return {
    pageIPv4: '203.0.113.42',
    rtcSupported: supported,
    rtcTestCompleted: completed,
    rtcLocal: localAddresses.map((address) => ({ address })),
    rtcPublic: publicAddresses.map((address) => ({ address })),
    checkedAt: 1_700_000_000_000,
    duration: 4.2,
    ...rest
  }
}

describe('StatusEvaluator', () => {
  it('matching public address is clear', () => {
    const evaluation = StatusEvaluator.evaluate(report())

    expect(evaluation.status).toBe('clear')
    expect(evaluation.headline).toBe('Clear')
    expect(evaluation.publicMismatch).toEqual([])
    expect(evaluation.localExposed).toEqual([])
  })

  it('different public address is a leak', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({ publicAddresses: ['198.51.100.9'] })
    )

    expect(evaluation.status).toBe('publicLeak')
    expect(evaluation.publicMismatch).toEqual(['198.51.100.9'])
  })

  it('local address without public mismatch is local exposure', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({ localAddresses: ['192.168.1.12'] })
    )

    expect(evaluation.status).toBe('localExposure')
    expect(evaluation.localExposed).toEqual(['192.168.1.12'])
  })

  it('prefers public leak over local exposure', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({
        publicAddresses: ['198.51.100.9'],
        localAddresses: ['192.168.1.12']
      })
    )

    expect(evaluation.status).toBe('publicLeak')
    expect(evaluation.localExposed).toEqual(['192.168.1.12'])
  })

  it('matches equivalent IPv6 forms', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({
        pageIPv6: '2604:a880:0:0:0:0:0:1',
        publicAddresses: ['2604:a880::1']
      })
    )

    expect(evaluation.status).toBe('clear')
  })

  it('treats a mismatched IPv6 address as a leak', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({
        pageIPv6: '2604:a880::1',
        publicAddresses: ['2604:a880::2']
      })
    )

    expect(evaluation.status).toBe('publicLeak')
  })

  it('no public candidate is inconclusive', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({ publicAddresses: [] })
    )

    expect(evaluation.status).toBe('inconclusive')
    expect(evaluation.detail).toContain('No public WebRTC candidate')
  })

  it('incomplete test is inconclusive', () => {
    const evaluation = StatusEvaluator.evaluate(report({ completed: false }))

    expect(evaluation.status).toBe('inconclusive')
  })

  it('unsupported WebRTC is inconclusive', () => {
    const evaluation = StatusEvaluator.evaluate(report({ supported: false }))

    expect(evaluation.status).toBe('inconclusive')
    expect(evaluation.detail).toContain('RTCPeerConnection')
  })

  it('deduplicates public addresses', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({ publicAddresses: ['203.0.113.42', '203.0.113.42'] })
    )

    expect(evaluation.status).toBe('clear')
    expect(evaluation.publicAddresses).toHaveLength(1)
  })

  it('treats an invalid public address as a mismatch', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({ publicAddresses: ['not-an-ip'] })
    )

    expect(evaluation.status).toBe('publicLeak')
    expect(evaluation.publicMismatch).toEqual(['not-an-ip'])
  })

  it('rejects garbage with the address normalizer', () => {
    expect(IPAddressNormalizer.isValid('999.1.1.1')).toBe(false)
    expect(IPAddressNormalizer.isValid('hello')).toBe(false)
    expect(IPAddressNormalizer.isValid('203.0.113.42')).toBe(true)
    expect(IPAddressNormalizer.isValid('2001:db8::1')).toBe(true)
  })

  it('public mismatch takes precedence over local exposure', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({
        publicAddresses: ['198.51.100.9', '203.0.113.42'],
        localAddresses: ['10.0.0.8']
      })
    )

    expect(evaluation.status).toBe('publicLeak')
    expect(evaluation.localExposed).toEqual(['10.0.0.8'])
  })

  it('empty page address is inconclusive', () => {
    const evaluation = StatusEvaluator.evaluate(
      report({ pageIPv4: '', publicAddresses: [] })
    )

    expect(evaluation.status).toBe('inconclusive')
  })
})

describe('IPAddressNormalizer', () => {
  it('accepts bracketed IPv6 addresses', () => {
    expect(IPAddressNormalizer.key('[2001:db8::1]')).toBe(
      IPAddressNormalizer.key('2001:db8::1')
    )
  })

  it('strips IPv6 zone identifiers', () => {
    expect(IPAddressNormalizer.key('fe80::1%en0')).toBe(
      IPAddressNormalizer.key('fe80::1')
    )
  })

  it('keeps IPv4-mapped IPv6 distinct from plain IPv4', () => {
    const mapped = IPAddressNormalizer.key('::ffff:203.0.113.42')
    const plain = IPAddressNormalizer.key('203.0.113.42')

    expect(mapped).toMatch(/^v6:/)
    expect(plain).toMatch(/^v4:/)
    expect(mapped).not.toBe(plain)
  })

  it('normalizes IPv4 and IPv6 to stable lengths', () => {
    expect(IPAddressNormalizer.key('203.0.113.42')).toBe('v4:cb00712a')
    expect(IPAddressNormalizer.key('2001:db8::1')).toBe(
      'v6:20010db8000000000000000000000001'
    )
  })

  it('returns null for empty or malformed values', () => {
    expect(IPAddressNormalizer.key('')).toBeNull()
    expect(IPAddressNormalizer.key('   ')).toBeNull()
    expect(IPAddressNormalizer.key('[not-an-ip]')).toBeNull()
  })
})

describe('report helpers', () => {
  it('trims and deduplicates addresses by normalized key', () => {
    const value = report({
      publicAddresses: [' 203.0.113.42 ', '203.0.113.42'],
      localAddresses: [' 192.168.1.12 ']
    })

    expect(reportPublicAddresses(value)).toEqual(['203.0.113.42'])
    expect(reportLocalAddresses(value)).toEqual(['192.168.1.12'])
  })

  it('collects non-empty page addresses', () => {
    expect(pageAddresses(report({ pageIPv6: '2001:db8::42' }))).toEqual([
      '203.0.113.42',
      '2001:db8::42'
    ])
    expect(pageAddresses(report({ pageIPv4: '', pageIPv6: '  ' }))).toEqual([])
  })
})

describe('checkIntervalMs', () => {
  it('uses 60s while offline', () => {
    expect(
      checkIntervalMs({
        status: 'offline',
        isNetworkAvailable: true,
        popoverOpen: true
      })
    ).toBe(60_000)
  })

  it('uses 60s without a network path', () => {
    expect(
      checkIntervalMs({
        status: 'clear',
        isNetworkAvailable: false,
        popoverOpen: false
      })
    ).toBe(60_000)
  })

  it('uses 30s while the popover is open', () => {
    expect(
      checkIntervalMs({
        status: 'clear',
        isNetworkAvailable: true,
        popoverOpen: true
      })
    ).toBe(30_000)
  })

  it('uses 15 minutes in the background', () => {
    expect(
      checkIntervalMs({
        status: 'clear',
        isNetworkAvailable: true,
        popoverOpen: false
      })
    ).toBe(900_000)
  })
})
