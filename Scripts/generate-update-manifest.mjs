#!/usr/bin/env node
/**
 * Generates a signed update manifest for a GitHub release.
 * Signing happens over the exact bytes of latest.json; the signature is
 * published as latest.json.sig.
 */
import { createPrivateKey, sign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const outputIndex = process.argv.indexOf('--output')
const outputDirectory =
  outputIndex !== -1 && process.argv[outputIndex + 1]
    ? path.resolve(process.argv[outputIndex + 1])
    : process.cwd()

const rawVersion = process.env.VERSION || process.env.GITHUB_REF_NAME || ''
const version = rawVersion.replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid release version: ${rawVersion || '(missing)'}`)
  process.exit(1)
}

const releaseUrl =
  process.env.RELEASE_URL ||
  `https://github.com/TH3L30/ShieldBar/releases/tag/v${version}`

if (!/^https:\/\/github\.com\/TH3L30\/ShieldBar\/releases\/tag\/v\d+\.\d+\.\d+$/.test(releaseUrl)) {
  console.error(`Invalid release URL: ${releaseUrl}`)
  process.exit(1)
}

const privateKeyPem = process.env.UPDATE_SIGNING_KEY
if (!privateKeyPem) {
  console.error('UPDATE_SIGNING_KEY is missing')
  process.exit(1)
}

let notice = null
if (process.env.UPDATE_NOTICE_JSON) {
  try {
    notice = JSON.parse(process.env.UPDATE_NOTICE_JSON)
  } catch {
    console.error('UPDATE_NOTICE_JSON is not valid JSON')
    process.exit(1)
  }
  if (
    !notice ||
    typeof notice !== 'object' ||
    typeof notice.id !== 'string' ||
    !['info', 'warning', 'critical'].includes(notice.severity) ||
    typeof notice.title !== 'string' ||
    typeof notice.message !== 'string'
  ) {
    console.error('UPDATE_NOTICE_JSON has an invalid shape')
    process.exit(1)
  }
  if (
    notice.url &&
    !notice.url.startsWith('https://github.com/TH3L30/ShieldBar/releases/')
  ) {
    console.error('UPDATE_NOTICE_JSON URL is not allowed')
    process.exit(1)
  }
}

const manifest = {
  schema: 1,
  version,
  releasedAt: process.env.RELEASED_AT || new Date().toISOString(),
  releaseUrl,
  notice
}

const payload = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
let privateKey
try {
  privateKey = createPrivateKey(privateKeyPem)
} catch {
  console.error('UPDATE_SIGNING_KEY is not a valid private key')
  process.exit(1)
}

const signature = sign(null, payload, privateKey)
mkdirSync(outputDirectory, { recursive: true })
writeFileSync(path.join(outputDirectory, 'latest.json'), payload)
writeFileSync(
  path.join(outputDirectory, 'latest.json.sig'),
  `${signature.toString('base64')}\n`,
  'utf8'
)

console.log(`Signed update manifest ${version} in ${outputDirectory}`)
