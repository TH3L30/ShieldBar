import { createPublicKey, verify } from 'node:crypto'
import type { UpdateManifest, UpdateNotice, UpdateSeverity } from '../shared/update'
import { UPDATE_RELEASE_PREFIX } from '../shared/update'
import { UPDATE_PUBLIC_KEY_BASE64 } from './updatePublicKey'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function verifyUpdateSignature(
  payload: Buffer,
  signature: Buffer,
  publicKeyBase64: string = UPDATE_PUBLIC_KEY_BASE64
): boolean {
  try {
    const raw = Buffer.from(publicKeyBase64, 'base64')
    if (raw.length !== 32) return false
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki'
    })
    return verify(null, payload, key, signature)
  } catch {
    return false
  }
}

export interface ParsedUpdate {
  manifest: UpdateManifest
  available: boolean
}

export function parseUpdateManifest(
  payload: Buffer,
  signature: Buffer,
  currentVersion: string,
  publicKeyBase64: string = UPDATE_PUBLIC_KEY_BASE64
): ParsedUpdate {
  if (!verifyUpdateSignature(payload, signature, publicKeyBase64)) {
    throw new Error('The update manifest signature is invalid.')
  }

  let value: unknown
  try {
    value = JSON.parse(payload.toString('utf8'))
  } catch {
    throw new Error('The update manifest is not valid JSON.')
  }

  const manifest = validateManifest(value)
  return {
    manifest,
    available: isNewerVersion(manifest.version, currentVersion)
  }
}

export function validateManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The update manifest has an invalid shape.')
  }
  const record = value as Record<string, unknown>

  if (record.schema !== 1) throw new Error('Unsupported update manifest schema.')
  const version = manifestVersion(record.version)
  const releasedAt = manifestText(record.releasedAt, 'releasedAt', 64)
  const releaseUrl = manifestText(record.releaseUrl, 'releaseUrl', 512)

  if (!isAllowedReleaseUrl(releaseUrl)) {
    throw new Error('The update manifest release URL is not allowed.')
  }
  if (Number.isNaN(Date.parse(releasedAt))) {
    throw new Error('The update manifest release date is invalid.')
  }

  const manifest: UpdateManifest = {
    schema: 1,
    version,
    releasedAt,
    releaseUrl
  }

  if (record.notice !== undefined && record.notice !== null) {
    manifest.notice = validateNotice(record.notice)
  }

  return manifest
}

function validateNotice(value: unknown): UpdateNotice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The update notice has an invalid shape.')
  }
  const record = value as Record<string, unknown>
  const id = manifestText(record.id, 'notice.id', 80)
  const severity = record.severity
  if (severity !== 'info' && severity !== 'warning' && severity !== 'critical') {
    throw new Error('The update notice severity is invalid.')
  }
  const title = manifestText(record.title, 'notice.title', 120)
  const message = manifestText(record.message, 'notice.message', 1000)
  const url =
    record.url === undefined || record.url === null
      ? undefined
      : manifestText(record.url, 'notice.url', 512)

  if (url && !isAllowedReleaseUrl(url)) {
    throw new Error('The update notice URL is not allowed.')
  }

  return {
    id,
    severity: severity as UpdateSeverity,
    title,
    message,
    ...(url ? { url } : {})
  }
}

function manifestText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`The update manifest is missing ${field}.`)
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`The update manifest has an invalid ${field}.`)
  }
  return trimmed
}

function manifestVersion(value: unknown): string {
  const version = manifestText(value, 'version', 32)
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('The update manifest version is invalid.')
  }
  return version
}

export function isAllowedReleaseUrl(url: string): boolean {
  return (
    url.startsWith(UPDATE_RELEASE_PREFIX) &&
    /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(url)
  )
}

export function isNewerVersion(latest: string, current: string): boolean {
  const left = versionParts(latest)
  const right = versionParts(current)
  if (!left || !right) return false

  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true
    if (left[index] < right[index]) return false
  }
  return false
}

function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
