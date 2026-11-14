import { describe, expect, it } from 'vitest'
import type { BrowserLeaksReport } from '../src/core/models'
import {
  baselineLabel,
  createBaseline,
  evaluateProtection,
  hasLikelyVpn,
  locationMismatch,
  normalizeSettings,
  vpnAdapters
} from '../src/core/protection'
import {
  DEFAULT_PROTECTION_SETTINGS,
  type ProtectionSettings
} from '../src/shared/protection'

function report(overrides: Partial<BrowserLeaksReport> = {}): BrowserLeaksReport {
  return {
    pageIPv4: '203.0.113.42',
    pageIPv6: '2001:db8::42',
    countryCode: 'CA',
    country: 'Canada',
    region: 'Ontario',
    city: 'Toronto',
    isp: 'Example ISP',
    organization: 'Example Network',
    rtcSupported: true,
    rtcTestCompleted: true,
    rtcLocal: [],
    rtcPublic: [{ address: '203.0.113.42' }],
    checkedAt: 1_700_000_000_000,
    duration: 4.2,
    ...overrides
  }
}

function settings(overrides: Partial<ProtectionSettings> = {}): ProtectionSettings {
  return { ...DEFAULT_PROTECTION_SETTINGS, ...overrides }
}

describe('createBaseline', () => {
  it('captures country by default', () => {
    const result = createBaseline(report(), ['country'], 'salt', 1234)

    expect(result.missing).toEqual([])
    expect(result.baseline?.countryCode).toBe('CA')
    expect(result.baseline?.capturedAt).toBe(1234)
    expect(baselineLabel(result.baseline!, ['country'])).toBe('Canada')
  })

  it('reports fields BrowserLeaks did not return', () => {
    const result = createBaseline(
      report({ region: undefined, city: undefined }),
      ['country', 'region', 'city'],
      'salt'
    )

    expect(result.baseline).toBeNull()
    expect(result.missing).toEqual(['region', 'city'])
  })

  it('hashes exact IP instead of retaining it', () => {
    const result = createBaseline(report(), ['country', 'exactIp'], 'salt')

    expect(result.baseline?.exactIpHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result.baseline)).not.toContain('203.0.113.42')
    expect(baselineLabel(result.baseline!, ['country', 'exactIp'])).toBe(
      'Canada · exact IP'
    )
  })

  it('uses organization when ISP is missing', () => {
    const result = createBaseline(
      report({ isp: undefined }),
      ['country', 'isp'],
      'salt'
    )

    expect(result.baseline?.isp).toBe('Example Network')
  })
})

describe('locationMismatch', () => {
  const baseline = createBaseline(
    report(),
    ['country', 'region', 'city', 'isp', 'exactIp'],
    'salt'
  ).baseline!

  it('matches an identical location', () => {
    expect(locationMismatch(report(), baseline, ['country'], 'salt')).toBe(false)
    expect(
      locationMismatch(
        report(),
        baseline,
        ['country', 'region', 'city', 'isp', 'exactIp'],
        'salt'
      )
    ).toBe(false)
  })

  it('detects a country change', () => {
    expect(
      locationMismatch(
        report({ countryCode: 'US', country: 'United States' }),
        baseline,
        ['country'],
        'salt'
      )
    ).toBe(true)
  })

  it('detects a region, city, or ISP change', () => {
    expect(
      locationMismatch(report({ region: 'Quebec' }), baseline, ['region'], 'salt')
    ).toBe(true)
    expect(
      locationMismatch(report({ city: 'Montreal' }), baseline, ['city'], 'salt')
    ).toBe(true)
    expect(
      locationMismatch(report({ isp: 'Other ISP' }), baseline, ['isp'], 'salt')
    ).toBe(true)
  })

  it('detects an exact IP change without storing the IP', () => {
    expect(
      locationMismatch(
        report({ pageIPv4: '198.51.100.9' }),
        baseline,
        ['exactIp'],
        'salt'
      )
    ).toBe(true)
  })

  it('uses the session salt for exact IP comparison', () => {
    expect(
      locationMismatch(report(), baseline, ['exactIp'], 'different-salt')
    ).toBe(true)
  })
})

describe('evaluateProtection', () => {
  const baseline = createBaseline(report(), ['country'], 'salt').baseline

  it('kills on a public leak when enabled', () => {
    const result = evaluateProtection(
      report(),
      'publicLeak',
      settings({ killOnPublicLeak: true }),
      baseline,
      'salt'
    )

    expect(result.trigger).toBe('publicLeak')
  })

  it('ignores a public leak when the trigger is disabled', () => {
    const result = evaluateProtection(
      report({ countryCode: 'CA' }),
      'publicLeak',
      settings({ killOnPublicLeak: false, killOnLocationChange: false }),
      baseline,
      'salt'
    )

    expect(result.trigger).toBeNull()
  })

  it('kills on local exposure only when enabled', () => {
    const enabled = evaluateProtection(
      report(),
      'localExposure',
      settings({ killOnLocalExposure: true, killOnLocationChange: false }),
      baseline,
      'salt'
    )
    const disabled = evaluateProtection(
      report(),
      'localExposure',
      settings({ killOnLocalExposure: false, killOnLocationChange: false }),
      baseline,
      'salt'
    )

    expect(enabled.trigger).toBe('localExposure')
    expect(disabled.trigger).toBeNull()
  })

  it('kills on a country change only when enabled', () => {
    const changed = report({ countryCode: 'US', country: 'United States' })
    const enabled = evaluateProtection(
      changed,
      'clear',
      settings({ killOnLocationChange: true }),
      baseline,
      'salt'
    )
    const disabled = evaluateProtection(
      changed,
      'clear',
      settings({ killOnLocationChange: false }),
      baseline,
      'salt'
    )

    expect(enabled.trigger).toBe('locationChange')
    expect(disabled.trigger).toBeNull()
  })

  it('treats an incomplete test as inconclusive, not a leak', () => {
    const result = evaluateProtection(
      report({ rtcTestCompleted: false }),
      'inconclusive',
      settings({ failClosed: true }),
      baseline,
      'salt'
    )

    expect(result.trigger).toBe('inconclusive')
  })

  it('fail-open leaves inconclusive results alone', () => {
    const result = evaluateProtection(
      report({ rtcTestCompleted: false }),
      'inconclusive',
      settings({ failClosed: false }),
      baseline,
      'salt'
    )

    expect(result.trigger).toBeNull()
  })

  it('does not check location on an inconclusive result', () => {
    const result = evaluateProtection(
      report({ countryCode: 'US', country: 'United States' }),
      'inconclusive',
      settings({ failClosed: false }),
      baseline,
      'salt'
    )

    expect(result.trigger).toBeNull()
    expect(result.locationChanged).toBe(false)
  })
})

describe('VPN adapters', () => {
  it('detects common tunnel names', () => {
    const adapters = vpnAdapters([
      'en0',
      'utun3',
      'wg0',
      'Tailscale',
      'Ethernet 2',
      'lo0'
    ])

    expect(hasLikelyVpn(['utun3', 'en0'])).toBe(true)
    expect(hasLikelyVpn(['en0', 'Ethernet 2'])).toBe(false)
    expect(adapters.find((adapter) => adapter.name === 'lo0')).toBeUndefined()
    expect(adapters.find((adapter) => adapter.name === 'utun3')?.likelyVpn).toBe(
      true
    )
    expect(
      adapters.find((adapter) => adapter.name === 'Ethernet 2')?.likelyVpn
    ).toBe(false)
  })
})

describe('normalizeSettings', () => {
  it('keeps valid fields and rejects unknown ones', () => {
    const result = normalizeSettings(
      {
        enabled: true,
        locationFields: ['country', 'city', 'garbage' as never]
      },
      DEFAULT_PROTECTION_SETTINGS
    )

    expect(result.enabled).toBe(true)
    expect(result.locationFields).toEqual(['country', 'city'])
  })

  it('falls back to the default fields when none remain', () => {
    const result = normalizeSettings(
      { locationFields: [] },
      DEFAULT_PROTECTION_SETTINGS
    )

    expect(result.locationFields).toEqual(DEFAULT_PROTECTION_SETTINGS.locationFields)
  })
})
