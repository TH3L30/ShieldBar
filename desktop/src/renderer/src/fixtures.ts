import type { ShieldState } from '../../shared/ipc'
import type { BrowserLeaksReport } from '../../core/models'
import { StatusEvaluator } from '../../core/evaluator'

const PREVIEW_NAMES = [
  'clear',
  'leak',
  'local',
  'welcome',
  'inconclusive',
  'offline',
  'update'
] as const

export type PreviewName = (typeof PREVIEW_NAMES)[number]

export function isPreviewName(value: string | null): value is PreviewName {
  return value !== null && (PREVIEW_NAMES as readonly string[]).includes(value)
}

function clearReport(): BrowserLeaksReport {
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
    rtcLocalText: 'n/a',
    rtcPublicText: '203.0.113.42',
    rtcLeakText: '✔ No Local IP Leak',
    checkedAt: Date.now() - 13_000,
    duration: 4.3
  }
}

function leakReport(): BrowserLeaksReport {
  return {
    pageIPv4: '203.0.113.42',
    countryCode: 'CA',
    country: 'Canada',
    region: 'Ontario',
    city: 'Toronto',
    isp: 'Example ISP',
    organization: 'Example Network',
    rtcSupported: true,
    rtcTestCompleted: true,
    rtcLocal: [],
    rtcPublic: [
      {
        address: '198.51.100.9',
        country: 'Greece',
        countryCode: 'GR'
      }
    ],
    rtcLocalText: 'n/a',
    rtcPublicText: '198.51.100.9',
    rtcMismatchText: "! WebRTC IP doesn't match your Remote IP",
    checkedAt: Date.now() - 7_000,
    duration: 4.8
  }
}

function localExposureReport(): BrowserLeaksReport {
  return {
    pageIPv4: '203.0.113.42',
    countryCode: 'CA',
    country: 'Canada',
    region: 'Ontario',
    city: 'Toronto',
    isp: 'Example ISP',
    organization: 'Example Network',
    rtcSupported: true,
    rtcTestCompleted: true,
    rtcLocal: [{ address: '192.168.1.12' }],
    rtcPublic: [{ address: '203.0.113.42' }],
    rtcLocalText: '192.168.1.12',
    rtcPublicText: '203.0.113.42',
    rtcLeakText: '✖ Local IP Leak',
    checkedAt: Date.now() - 22_000,
    duration: 4.1
  }
}

function inconclusiveReport(): BrowserLeaksReport {
  return {
    pageIPv4: '203.0.113.42',
    countryCode: 'CA',
    country: 'Canada',
    region: 'Ontario',
    city: 'Toronto',
    isp: 'Example ISP',
    organization: 'Example Network',
    rtcSupported: true,
    rtcTestCompleted: false,
    rtcLocal: [],
    rtcPublic: [],
    rtcLocalText: 'n/a',
    rtcPublicText: 'n/a',
    checkedAt: Date.now() - 18_000,
    duration: 9.2
  }
}

function baseState(report: BrowserLeaksReport): ShieldState {
  const evaluation = StatusEvaluator.evaluate(report)
  return {
    status: evaluation.status,
    evaluation,
    report,
    lastCheckedAt: report.checkedAt,
    nextCheckAt: Date.now() + 30_000,
    isChecking: false,
    lastError: null,
    notifyOnLeak: true,
    showWelcome: false
  }
}

export function previewState(name: PreviewName | null): ShieldState | null {
  if (!name) return null

  switch (name) {
    case 'clear':
      return baseState(clearReport())
    case 'welcome':
      return { ...baseState(clearReport()), showWelcome: true }
    case 'leak':
      return baseState(leakReport())
    case 'local':
      return baseState(localExposureReport())
    case 'inconclusive':
      return baseState(inconclusiveReport())
    case 'update':
      return {
        ...baseState(clearReport()),
        update: {
          phase: 'available',
          currentVersion: '1.1.2',
          latestVersion: '1.1.3',
          releaseUrl:
            'https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.3',
          notice: null,
          message: 'ShieldBar 1.1.3 is available.',
          autoCheck: true,
          dismissed: false,
          noticeSeen: true,
          lastCheckedAt: Date.now() - 20_000
        }
      }
    case 'offline': {
      const report = clearReport()
      const evaluation = StatusEvaluator.evaluate(report)
      return {
        ...baseState(report),
        status: 'offline',
        evaluation: {
          status: 'offline',
          headline: 'Offline',
          detail: 'No network connection. ShieldBar will retry automatically.',
          publicMismatch: [],
          localExposed: evaluation.localExposed,
          publicAddresses: evaluation.publicAddresses,
          pageAddresses: evaluation.pageAddresses
        },
        lastError: 'No network connection.',
        nextCheckAt: Date.now() + 60_000
      }
    }
  }
}
