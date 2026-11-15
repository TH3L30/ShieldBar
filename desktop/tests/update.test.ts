import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isAllowedReleaseUrl,
  isNewerVersion,
  parseUpdateManifest,
  validateManifest
} from '../src/main/updateVerifier'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyBase64 = publicKey
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('base64')

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    version: '1.1.2',
    releasedAt: '2026-11-15T00:00:00Z',
    releaseUrl: 'https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2',
    notice: null,
    ...overrides
  }
}

function signed(overrides: Record<string, unknown> = {}): {
  payload: Buffer
  signature: Buffer
} {
  const payload = Buffer.from(`${JSON.stringify(manifest(overrides), null, 2)}\n`)
  return {
    payload,
    signature: sign(null, payload, privateKey)
  }
}

describe('update manifest verification', () => {
  it('accepts a newer signed manifest', () => {
    const { payload, signature } = signed()
    const parsed = parseUpdateManifest(
      payload,
      signature,
      '1.1.1',
      publicKeyBase64
    )

    expect(parsed.available).toBe(true)
    expect(parsed.manifest.version).toBe('1.1.2')
  })

  it('treats the same version as up to date', () => {
    const { payload, signature } = signed()
    const parsed = parseUpdateManifest(
      payload,
      signature,
      '1.1.2',
      publicKeyBase64
    )

    expect(parsed.available).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const { payload, signature } = signed()
    payload[payload.length - 2] = 0x20

    expect(() =>
      parseUpdateManifest(payload, signature, '1.1.1', publicKeyBase64)
    ).toThrow(/signature/)
  })

  it('rejects a manifest signed by another key', () => {
    const { payload, signature } = signed()
    const other = generateKeyPairSync('ed25519')
    const otherPublic = other.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32)
      .toString('base64')

    expect(() =>
      parseUpdateManifest(payload, signature, '1.1.1', otherPublic)
    ).toThrow(/signature/)
  })

  it('rejects a release URL outside the repository', () => {
    const { payload, signature } = signed({
      releaseUrl: 'https://example.com/ShieldBar/releases/tag/v1.1.2'
    })

    expect(() =>
      parseUpdateManifest(payload, signature, '1.1.1', publicKeyBase64)
    ).toThrow(/release URL/)
  })

  it('accepts a valid security notice', () => {
    const { payload, signature } = signed({
      notice: {
        id: 'security-2026-01',
        severity: 'critical',
        title: 'Security notice',
        message: 'Please update.',
        url: 'https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2'
      }
    })
    const parsed = parseUpdateManifest(
      payload,
      signature,
      '1.1.2',
      publicKeyBase64
    )

    expect(parsed.manifest.notice?.severity).toBe('critical')
  })

  it('rejects an invalid notice URL', () => {
    const { payload, signature } = signed({
      notice: {
        id: 'bad',
        severity: 'info',
        title: 'Bad',
        message: 'Bad link',
        url: 'https://example.com/phishing'
      }
    })

    expect(() =>
      parseUpdateManifest(payload, signature, '1.1.1', publicKeyBase64)
    ).toThrow(/notice URL/)
  })
})

describe('update version rules', () => {
  it('compares numeric segments', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true)
    expect(isNewerVersion('1.1.10', '1.1.9')).toBe(true)
    expect(isNewerVersion('1.1.2', '1.1.2')).toBe(false)
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false)
  })

  it('accepts only the expected release host and prefix', () => {
    expect(
      isAllowedReleaseUrl(
        'https://github.com/TH3L30/ShieldBar/releases/tag/v1.1.2'
      )
    ).toBe(true)
    expect(
      isAllowedReleaseUrl(
        'https://github.com/TH3L30/ShieldBar/releases/download/v1.1.2/file.zip'
      )
    ).toBe(true)
    expect(
      isAllowedReleaseUrl('https://github.com/other/repo/releases/tag/v1.1.2')
    ).toBe(false)
    expect(
      isAllowedReleaseUrl(
        'https://github.com/TH3L30/ShieldBar.evil/releases/tag/v1.1.2'
      )
    ).toBe(false)
  })

  it('rejects unknown schema versions', () => {
    expect(() => validateManifest(manifest({ schema: 2 }))).toThrow(/schema/)
  })
})
