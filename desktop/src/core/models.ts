import { IPAddressNormalizer } from './ip'

export type ShieldStatus =
  | 'idle'
  | 'checking'
  | 'clear'
  | 'localExposure'
  | 'publicLeak'
  | 'inconclusive'
  | 'offline'

export interface WebRTCAddress {
  address: string
  country?: string
  countryCode?: string
}

export interface BrowserLeaksReport {
  pageIPv4: string
  pageIPv6?: string
  countryCode?: string
  country?: string
  region?: string
  city?: string
  isp?: string
  organization?: string
  rtcSupported: boolean
  rtcTestCompleted: boolean
  rtcLocal: WebRTCAddress[]
  rtcPublic: WebRTCAddress[]
  rtcLocalText?: string
  rtcPublicText?: string
  rtcLeakText?: string
  rtcMismatchText?: string
  /** Epoch milliseconds. */
  checkedAt: number
  /** Probe duration in seconds. */
  duration: number
}

export interface StatusEvaluation {
  status: ShieldStatus
  headline: string
  detail: string
  publicMismatch: string[]
  localExposed: string[]
  publicAddresses: string[]
  pageAddresses: string[]
}

export const CHECKING_EVALUATION: StatusEvaluation = {
  status: 'checking',
  headline: 'Checking…',
  detail: 'Running the BrowserLeaks IP and WebRTC test.',
  publicMismatch: [],
  localExposed: [],
  publicAddresses: [],
  pageAddresses: []
}

export const IDLE_EVALUATION: StatusEvaluation = {
  status: 'idle',
  headline: 'Not checked yet',
  detail: 'Click Refresh to run the first BrowserLeaks check.',
  publicMismatch: [],
  localExposed: [],
  publicAddresses: [],
  pageAddresses: []
}

function trimmedOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function uniqueAddresses(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = IPAddressNormalizer.key(trimmed) ?? trimmed.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(trimmed)
    }
  }

  return result
}

export function pageAddresses(report: BrowserLeaksReport): string[] {
  return [report.pageIPv4, report.pageIPv6]
    .map(trimmedOrUndefined)
    .filter((value): value is string => Boolean(value))
}

export function reportPublicAddresses(report: BrowserLeaksReport): string[] {
  return uniqueAddresses(report.rtcPublic.map((entry) => entry.address))
}

export function reportLocalAddresses(report: BrowserLeaksReport): string[] {
  return uniqueAddresses(report.rtcLocal.map((entry) => entry.address))
}

export function locationLine(report: BrowserLeaksReport): string | null {
  const parts = [report.city, report.region, report.country]
    .map(trimmedOrUndefined)
    .filter((value): value is string => Boolean(value))
  return parts.length ? parts.join(', ') : null
}

export function shortStatusLabel(status: ShieldStatus): string {
  switch (status) {
    case 'clear':
      return 'Clear'
    case 'publicLeak':
      return 'Public leak'
    case 'localExposure':
      return 'Local IP exposed'
    case 'inconclusive':
      return 'Inconclusive'
    case 'offline':
      return 'Offline'
    case 'checking':
      return 'Checking'
    case 'idle':
      return 'Not checked'
  }
}

export function statusAccessibilityDescription(status: ShieldStatus): string {
  switch (status) {
    case 'clear':
      return 'Clear. WebRTC matches the public IP and no local IP is exposed.'
    case 'publicLeak':
      return 'Public IP leak. WebRTC sees a different public IP.'
    case 'localExposure':
      return 'Local IP exposed. WebRTC can see a private address.'
    case 'inconclusive':
      return 'Inconclusive. The WebRTC test did not return enough data to judge.'
    case 'offline':
      return 'Offline. BrowserLeaks could not be reached.'
    case 'checking':
      return 'Checking BrowserLeaks now.'
    case 'idle':
      return 'Not checked yet.'
  }
}
