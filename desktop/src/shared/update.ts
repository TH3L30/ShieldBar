export type UpdateSeverity = 'info' | 'warning' | 'critical'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'notice'
  | 'error'
  | 'disabled'

export interface UpdateNotice {
  id: string
  severity: UpdateSeverity
  title: string
  message: string
  url?: string
}

export interface UpdateManifest {
  schema: 1
  version: string
  releasedAt: string
  releaseUrl: string
  notice?: UpdateNotice | null
}

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  notice: UpdateNotice | null
  message: string | null
  autoCheck: boolean
  dismissed: boolean
  noticeSeen: boolean
  lastCheckedAt: number | null
}

export interface UpdateActionResult {
  ok: boolean
  message: string
}

export const UPDATE_FEED_URL =
  'https://github.com/TH3L30/ShieldBar/releases/latest/download/latest.json'
export const UPDATE_FEED_SIGNATURE_URL = `${UPDATE_FEED_URL}.sig`
export const UPDATE_RELEASE_PREFIX =
  'https://github.com/TH3L30/ShieldBar/releases/'
