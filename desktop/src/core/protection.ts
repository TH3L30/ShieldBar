import { createHash } from 'node:crypto'
import type { BrowserLeaksReport } from './models'
import type {
  LocationField,
  ProtectionBaseline,
  ProtectionSettings,
  ProtectionTrigger
} from '../shared/protection'

export interface BaselineInternal extends ProtectionBaseline {
  exactIpHash?: string
}

export interface BaselineResult {
  baseline: BaselineInternal | null
  missing: LocationField[]
}

function text(value: string | undefined | null): string {
  return (value ?? '').trim()
}

function normalized(value: string | undefined | null): string {
  return text(value).toLowerCase()
}

function hashAddress(address: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${text(address)}`).digest('hex')
}

function hasCountry(report: BrowserLeaksReport): boolean {
  return Boolean(text(report.countryCode) || text(report.country))
}

function hasField(report: BrowserLeaksReport, field: LocationField): boolean {
  switch (field) {
    case 'country':
      return hasCountry(report)
    case 'region':
      return Boolean(text(report.region))
    case 'city':
      return Boolean(text(report.city))
    case 'isp':
      return Boolean(text(report.isp) || text(report.organization))
    case 'exactIp':
      return Boolean(text(report.pageIPv4))
  }
}

export function missingBaselineFields(
  report: BrowserLeaksReport,
  fields: LocationField[]
): LocationField[] {
  return fields.filter((field) => !hasField(report, field))
}

export function createBaseline(
  report: BrowserLeaksReport,
  fields: LocationField[],
  salt: string,
  now: number = Date.now()
): BaselineResult {
  const missing = missingBaselineFields(report, fields)
  if (missing.length > 0) {
    return { baseline: null, missing }
  }

  const baseline: BaselineInternal = {
    capturedAt: now,
    ...(text(report.countryCode)
      ? { countryCode: text(report.countryCode).toUpperCase() }
      : {}),
    ...(text(report.country) ? { country: text(report.country) } : {}),
    ...(text(report.region) ? { region: text(report.region) } : {}),
    ...(text(report.city) ? { city: text(report.city) } : {}),
    ...(text(report.isp)
      ? { isp: text(report.isp) }
      : text(report.organization)
        ? { isp: text(report.organization) }
        : {})
  }

  if (fields.includes('exactIp')) {
    baseline.exactIpHash = hashAddress(report.pageIPv4, salt)
  }

  return { baseline, missing: [] }
}

export function baselineLabel(
  baseline: ProtectionBaseline,
  fields: LocationField[]
): string {
  const parts: string[] = []
  if (fields.includes('country')) {
    parts.push(text(baseline.country) || text(baseline.countryCode) || 'Unknown country')
  }
  if (fields.includes('region') && text(baseline.region)) parts.push(text(baseline.region))
  if (fields.includes('city') && text(baseline.city)) parts.push(text(baseline.city))
  if (fields.includes('isp') && text(baseline.isp)) parts.push(text(baseline.isp))
  if (fields.includes('exactIp')) parts.push('exact IP')
  return parts.join(' · ') || 'No baseline fields'
}

export function locationMismatch(
  report: BrowserLeaksReport,
  baseline: BaselineInternal,
  fields: LocationField[],
  salt: string
): boolean {
  if (fields.includes('country')) {
    if (
      normalized(report.countryCode) !== normalized(baseline.countryCode) ||
      normalized(report.country) !== normalized(baseline.country)
    ) {
      // Compare on whichever identifier both sides have; country code is the
      // stable one when available.
      if (!text(baseline.countryCode) || !text(report.countryCode)) {
        if (normalized(report.country) !== normalized(baseline.country)) return true
      } else if (normalized(report.countryCode) !== normalized(baseline.countryCode)) {
        return true
      }
    }
  }

  if (fields.includes('region') && normalized(report.region) !== normalized(baseline.region)) {
    return true
  }
  if (fields.includes('city') && normalized(report.city) !== normalized(baseline.city)) {
    return true
  }
  if (fields.includes('isp')) {
    const current = text(report.isp) || text(report.organization)
    if (normalized(current) !== normalized(baseline.isp)) return true
  }
  if (fields.includes('exactIp')) {
    if (!baseline.exactIpHash) return true
    if (hashAddress(report.pageIPv4, salt) !== baseline.exactIpHash) return true
  }

  return false
}

export interface TriggerResult {
  trigger: ProtectionTrigger | null
  locationChanged: boolean
}

export function evaluateProtection(
  report: BrowserLeaksReport,
  status: string,
  settings: ProtectionSettings,
  baseline: BaselineInternal | null,
  salt: string
): TriggerResult {
  if (report.rtcSupported === false || !report.rtcTestCompleted) {
    return {
      trigger: settings.failClosed ? 'inconclusive' : null,
      locationChanged: false
    }
  }

  if (status === 'publicLeak' && settings.killOnPublicLeak) {
    return { trigger: 'publicLeak', locationChanged: false }
  }

  if (status === 'localExposure' && settings.killOnLocalExposure) {
    return { trigger: 'localExposure', locationChanged: false }
  }

  let locationChanged = false
  if (
    settings.killOnLocationChange &&
    baseline &&
    settings.locationFields.length > 0 &&
    status !== 'offline' &&
    status !== 'inconclusive'
  ) {
    locationChanged = locationMismatch(
      report,
      baseline,
      settings.locationFields,
      salt
    )
  }

  if (locationChanged) {
    return { trigger: 'locationChange', locationChanged: true }
  }

  if (status === 'inconclusive' && settings.failClosed) {
    return { trigger: 'inconclusive', locationChanged: false }
  }

  return { trigger: null, locationChanged: false }
}

const VPN_PATTERNS = [
  /(^|[^a-z])(wg|wireguard|tun|utun|tap|tailscale|nordlynx|mullvad|proton|openvpn|ppp|ipsec|zerotier|hamachi)/i
]

export function vpnAdapters(names: string[]): Array<{ name: string; likelyVpn: boolean }> {
  return names
    .filter((name) => !/^(lo|lo0)$/i.test(name))
    .map((name) => ({
      name,
      likelyVpn: VPN_PATTERNS.some((pattern) => pattern.test(name))
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function hasLikelyVpn(names: string[]): boolean {
  return vpnAdapters(names).some((adapter) => adapter.likelyVpn)
}

export function normalizeSettings(
  settings: Partial<ProtectionSettings> | undefined,
  defaults: ProtectionSettings
): ProtectionSettings {
  if (!settings) return { ...defaults }
  const locationFields = Array.isArray(settings.locationFields)
    ? Array.from(new Set(settings.locationFields.filter(isLocationField)))
    : defaults.locationFields

  return {
    enabled:
      typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
    killOnPublicLeak:
      typeof settings.killOnPublicLeak === 'boolean'
        ? settings.killOnPublicLeak
        : defaults.killOnPublicLeak,
    killOnLocalExposure:
      typeof settings.killOnLocalExposure === 'boolean'
        ? settings.killOnLocalExposure
        : defaults.killOnLocalExposure,
    killOnLocationChange:
      typeof settings.killOnLocationChange === 'boolean'
        ? settings.killOnLocationChange
        : defaults.killOnLocationChange,
    locationFields: locationFields.length > 0 ? locationFields : defaults.locationFields,
    failClosed:
      typeof settings.failClosed === 'boolean'
        ? settings.failClosed
        : defaults.failClosed,
    startAtLogin:
      typeof settings.startAtLogin === 'boolean'
        ? settings.startAtLogin
        : defaults.startAtLogin
  }
}

function isLocationField(value: unknown): value is LocationField {
  return (
    value === 'country' ||
    value === 'region' ||
    value === 'city' ||
    value === 'isp' ||
    value === 'exactIp'
  )
}
