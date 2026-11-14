import type { BrowserLeaksReport, WebRTCAddress } from './models'
import type { ProbePayload } from './extraction'
import {
  cleanedCountry,
  isPlaceholder,
  normalizedCountryCode,
  sanitizedAddress,
  trimmedOrNull
} from './extraction'

/**
 * The test is only complete when both WebRTC cells have final values (the
 * local cell may legitimately say "n/a") and neither row is still animating.
 * The separate leak-verdict row is optional; the strict evaluator decides.
 */
export function isWebRTCFinal(payload: ProbePayload): boolean {
  const localText = trimmedOrNull(payload.rtcLocalText) ?? ''
  const publicText = trimmedOrNull(payload.rtcPublicText) ?? ''
  const loading = Boolean(payload.rtcLocalLoading || payload.rtcPublicLoading)
  return localText.length > 0 && publicText.length > 0 && !loading
}

/**
 * `elapsedMs` is measured from the page's did-finish-load event, exactly like
 * the macOS loadedAt-based gate.
 */
export function shouldFinish(payload: ProbePayload, elapsedMs: number): boolean {
  if (payload.readyState !== 'complete') return false
  if (!trimmedOrNull(payload.pageIPv4)) return false

  if (payload.rtcSupported === false) {
    return elapsedMs >= 1_000
  }

  if (payload.rtcLocalLoading || payload.rtcPublicLoading) {
    return false
  }

  if (isWebRTCFinal(payload)) {
    // The STUN test usually needs a moment even after the rows settle.
    return elapsedMs >= 1_200
  }

  // The page loaded but WebRTC never produced a final public-IP row. Return an
  // incomplete report instead of guessing.
  return elapsedMs >= 8_000
}

function addressList(
  values: ProbePayload['rtcLocal'] | ProbePayload['rtcPublic']
): WebRTCAddress[] {
  if (!Array.isArray(values)) return []

  const result: WebRTCAddress[] = []
  for (const value of values) {
    if (!value || typeof value.address !== 'string') continue
    const address = value.address.trim()
    if (!address || isPlaceholder(address)) continue

    const countryCode = normalizedCountryCode(value.countryCode)
    const originalCountry = trimmedOrNull(value.country)
    result.push({
      address,
      ...(originalCountry ? { country: originalCountry } : {}),
      ...(countryCode ? { countryCode } : {})
    })
  }
  return result
}

/**
 * Builds a report only when BrowserLeaks returned a usable public IPv4
 * address. Returns null for missing or placeholder page data.
 */
export function makeReport(
  payload: ProbePayload,
  completed: boolean,
  startedAtMs: number,
  finishedAtMs: number
): BrowserLeaksReport | null {
  const rawIPv4 = trimmedOrNull(payload.pageIPv4)
  if (!rawIPv4 || isPlaceholder(rawIPv4)) return null

  const countryCode = normalizedCountryCode(
    payload.countryCode ?? payload.pageIPv4CountryCode
  )
  const country = cleanedCountry(payload.country, countryCode)
  const pageIPv6 = sanitizedAddress(payload.pageIPv6)
  const region = trimmedOrNull(payload.region)
  const city = trimmedOrNull(payload.city)
  const isp = trimmedOrNull(payload.isp)
  const organization = trimmedOrNull(payload.organization)
  const rtcLocalText = trimmedOrNull(payload.rtcLocalText)
  const rtcPublicText = trimmedOrNull(payload.rtcPublicText)
  const rtcLeakText = trimmedOrNull(payload.rtcLeakText)
  const rtcMismatchText = trimmedOrNull(payload.rtcMismatchText)

  return {
    pageIPv4: rawIPv4,
    ...(pageIPv6 ? { pageIPv6 } : {}),
    ...(countryCode ? { countryCode } : {}),
    ...(country ? { country } : {}),
    ...(region ? { region } : {}),
    ...(city ? { city } : {}),
    ...(isp ? { isp } : {}),
    ...(organization ? { organization } : {}),
    rtcSupported: payload.rtcSupported ?? false,
    rtcTestCompleted: completed,
    rtcLocal: addressList(payload.rtcLocal),
    rtcPublic: addressList(payload.rtcPublic),
    ...(rtcLocalText ? { rtcLocalText } : {}),
    ...(rtcPublicText ? { rtcPublicText } : {}),
    ...(rtcLeakText ? { rtcLeakText } : {}),
    ...(rtcMismatchText ? { rtcMismatchText } : {}),
    checkedAt: finishedAtMs,
    duration: Math.max(0, (finishedAtMs - startedAtMs) / 1000)
  }
}

export function parsePayload(json: string): ProbePayload | null {
  try {
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as ProbePayload
  } catch {
    return null
  }
}
