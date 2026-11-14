export type ProtectionPhase =
  | 'unavailable'
  | 'ready'
  | 'arming'
  | 'armed'
  | 'triggering'
  | 'triggered'
  | 'restoring'
  | 'error'

export type LocationField = 'country' | 'region' | 'city' | 'isp' | 'exactIp'

export type ProtectionTrigger =
  | 'publicLeak'
  | 'localExposure'
  | 'locationChange'
  | 'inconclusive'

export interface ProtectionSettings {
  enabled: boolean
  killOnPublicLeak: boolean
  killOnLocalExposure: boolean
  killOnLocationChange: boolean
  locationFields: LocationField[]
  failClosed: boolean
  startAtLogin: boolean
}

export interface ProtectionBaseline {
  countryCode?: string
  country?: string
  region?: string
  city?: string
  isp?: string
  capturedAt: number
}

export interface ProtectionBaselineView {
  label: string
  fields: LocationField[]
  capturedAt: number
}

export interface ProtectionSummary {
  phase: ProtectionPhase
  armed: boolean
  triggered: boolean
  beta: true
  message: string | null
  lastTrigger: ProtectionTrigger | null
  baselineLabel: string | null
}

export interface VpnAdapter {
  name: string
  likelyVpn: boolean
}

export interface RemoteSession {
  detected: boolean
  kind: string | null
}

export interface ProtectionState extends ProtectionSummary {
  helperInstalled: boolean
  helperVersion: string | null
  settings: ProtectionSettings
  baseline: ProtectionBaselineView | null
  vpnAdapters: VpnAdapter[]
  remoteSession: RemoteSession
  lastCheckedAt: number | null
  currentStatus: string
  currentHeadline: string
  canSetBaseline: boolean
  canArm: boolean
}

export interface ProtectionActionResult {
  ok: boolean
  message: string
}

export const DEFAULT_PROTECTION_SETTINGS: ProtectionSettings = {
  enabled: false,
  killOnPublicLeak: true,
  killOnLocalExposure: false,
  killOnLocationChange: true,
  locationFields: ['country'],
  failClosed: false,
  startAtLogin: false
}

export const ALL_LOCATION_FIELDS: LocationField[] = [
  'country',
  'region',
  'city',
  'isp',
  'exactIp'
]

export function protectionTriggerLabel(trigger: ProtectionTrigger): string {
  switch (trigger) {
    case 'publicLeak':
      return 'public IP leak'
    case 'localExposure':
      return 'local IP exposure'
    case 'locationChange':
      return 'IP location change'
    case 'inconclusive':
      return 'inconclusive leak test'
  }
}
