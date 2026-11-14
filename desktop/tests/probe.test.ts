import { describe, expect, it } from 'vitest'
import type { ProbePayload } from '../src/core/extraction'
import {
  isWebRTCFinal,
  makeReport,
  parsePayload,
  shouldFinish
} from '../src/core/probeLogic'

const finalPayload: ProbePayload = {
  readyState: 'complete',
  pageIPv4: '203.0.113.42',
  pageIPv6: '2001:db8::42',
  countryCode: 'CA',
  country: 'Canada (CA)',
  region: 'Ontario',
  city: 'Toronto',
  isp: 'Example ISP',
  organization: 'Example Network',
  rtcSupported: true,
  rtcLocalText: 'n/a',
  rtcPublicText: '203.0.113.42',
  rtcLocal: [],
  rtcPublic: [{ address: '203.0.113.42' }],
  rtcLocalLoading: false,
  rtcPublicLoading: false,
  rtcLeakText: '✔ No Local IP Leak',
  rtcMismatchText: null
}

describe('isWebRTCFinal', () => {
  it('accepts local n/a with a final public address', () => {
    expect(isWebRTCFinal(finalPayload)).toBe(true)
  })

  it('requires the local cell to be present', () => {
    expect(isWebRTCFinal({ ...finalPayload, rtcLocalText: null })).toBe(false)
    expect(isWebRTCFinal({ ...finalPayload, rtcLocalText: '   ' })).toBe(false)
  })

  it('requires the public cell to be present', () => {
    expect(isWebRTCFinal({ ...finalPayload, rtcPublicText: '' })).toBe(false)
  })

  it('is not final while either row is loading', () => {
    expect(
      isWebRTCFinal({ ...finalPayload, rtcLocalLoading: true })
    ).toBe(false)
    expect(
      isWebRTCFinal({ ...finalPayload, rtcPublicLoading: true })
    ).toBe(false)
  })
})

describe('shouldFinish', () => {
  it('never finishes before the document is complete', () => {
    expect(
      shouldFinish({ ...finalPayload, readyState: 'loading' }, 20_000)
    ).toBe(false)
  })

  it('never finishes without a page IPv4', () => {
    expect(shouldFinish({ ...finalPayload, pageIPv4: null }, 20_000)).toBe(false)
    expect(shouldFinish({ ...finalPayload, pageIPv4: '  ' }, 20_000)).toBe(false)
  })

  it('waits 1.2 seconds after final WebRTC rows', () => {
    expect(shouldFinish(finalPayload, 1_100)).toBe(false)
    expect(shouldFinish(finalPayload, 1_200)).toBe(true)
  })

  it('returns an incomplete result after 8 seconds when WebRTC never settles', () => {
    const incomplete = {
      ...finalPayload,
      rtcPublicText: null,
      rtcPublic: []
    }

    expect(shouldFinish(incomplete, 7_999)).toBe(false)
    expect(shouldFinish(incomplete, 8_000)).toBe(true)
  })

  it('does not finish while a row is loading', () => {
    expect(
      shouldFinish({ ...finalPayload, rtcPublicLoading: true }, 10_000)
    ).toBe(false)
  })

  it('handles unsupported WebRTC after one second', () => {
    const unsupported = {
      ...finalPayload,
      rtcSupported: false,
      rtcLocalText: null,
      rtcPublicText: null,
      rtcPublic: []
    }

    expect(shouldFinish(unsupported, 999)).toBe(false)
    expect(shouldFinish(unsupported, 1_000)).toBe(true)
  })
})

describe('makeReport', () => {
  it('builds a complete report with sanitized fields', () => {
    const report = makeReport(finalPayload, true, 1_000, 5_300)

    expect(report).not.toBeNull()
    expect(report?.pageIPv4).toBe('203.0.113.42')
    expect(report?.pageIPv6).toBe('2001:db8::42')
    expect(report?.countryCode).toBe('CA')
    expect(report?.country).toBe('Canada')
    expect(report?.rtcTestCompleted).toBe(true)
    expect(report?.checkedAt).toBe(5_300)
    expect(report?.duration).toBeCloseTo(4.3, 5)
  })

  it('rejects a missing page IPv4', () => {
    expect(
      makeReport({ ...finalPayload, pageIPv4: null }, true, 0, 1_000)
    ).toBeNull()
  })

  it('rejects a placeholder page IPv4', () => {
    for (const value of ['n/a', '-', '−', 'unknown', ' UNKNOWN ']) {
      expect(
        makeReport({ ...finalPayload, pageIPv4: value }, true, 0, 1_000)
      ).toBeNull()
    }
  })

  it('trims addresses and drops placeholders', () => {
    const report = makeReport(
      {
        ...finalPayload,
        rtcLocal: [
          { address: ' 192.168.1.12 ' },
          { address: 'n/a' },
          { address: '   ' }
        ],
        rtcPublic: [
          { address: ' 203.0.113.42 ', country: ' Canada ', countryCode: 'ca' }
        ]
      },
      true,
      0,
      1_000
    )

    expect(report?.rtcLocal).toEqual([{ address: '192.168.1.12' }])
    expect(report?.rtcPublic).toEqual([
      {
        address: '203.0.113.42',
        country: 'Canada',
        countryCode: 'CA'
      }
    ])
  })

  it('treats missing rtcSupported as unsupported', () => {
    const report = makeReport(
      { ...finalPayload, rtcSupported: undefined },
      true,
      0,
      1_000
    )

    expect(report?.rtcSupported).toBe(false)
  })

  it('preserves a local n/a text but does not invent an address', () => {
    const report = makeReport(finalPayload, true, 0, 1_000)

    expect(report?.rtcLocalText).toBe('n/a')
    expect(report?.rtcLocal).toEqual([])
  })

  it('does not accept an invalid country code', () => {
    const report = makeReport(
      { ...finalPayload, countryCode: 'Canada' },
      true,
      0,
      1_000
    )

    expect(report?.countryCode).toBeUndefined()
  })

  it('marks an incomplete probe as not completed', () => {
    const report = makeReport(finalPayload, false, 0, 36_000)

    expect(report?.rtcTestCompleted).toBe(false)
  })
})

describe('parsePayload', () => {
  it('parses a JSON object', () => {
    expect(parsePayload('{"pageIPv4":"203.0.113.42"}')?.pageIPv4).toBe(
      '203.0.113.42'
    )
  })

  it('rejects malformed data and non-objects', () => {
    expect(parsePayload('not json')).toBeNull()
    expect(parsePayload('null')).toBeNull()
    expect(parsePayload('[]')).toBeNull()
    expect(parsePayload('"text"')).toBeNull()
  })
})
