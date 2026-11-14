#!/usr/bin/env node
/**
 * Generates every icon used by the Windows/Linux build. Idempotent.
 * macOS `sips` extracts the largest representation of the existing .icns when
 * available; otherwise a vector fallback matching the native icon is drawn.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktop, '..')
const resourcesDir = path.join(desktop, 'resources')
const trayDir = path.join(resourcesDir, 'tray')
const buildDir = path.join(desktop, 'build')
const linuxIconsDir = path.join(buildDir, 'icons')
const tmpDir = path.join(buildDir, '.icon-tmp')

const STATUSES = [
  'idle',
  'checking',
  'clear',
  'localExposure',
  'publicLeak',
  'inconclusive',
  'offline',
  'armed',
  'killed'
]

const COLORS = {
  idle: '#9e9ea6',
  checking: '#0a85ff',
  clear: '#29c76b',
  localExposure: '#ff9e0a',
  publicLeak: '#ff453b',
  inconclusive: '#f7b500',
  offline: '#8f8f96',
  armed: '#0a85ff',
  killed: '#b91c1c'
}

const SHIELD_PATH =
  'M9 .9 C11.826 .9 14.809 1.884 15.751 3.688 L15.751 9.592 C15.751 13.036 13.082 15.988 9 16.972 C4.918 15.988 2.249 13.036 2.249 9.592 L2.249 3.688 C3.191 1.884 6.174 .9 9 .9 Z'

const INNER_PATH =
  'M9 1.584 C11.5 1.584 14.2 2.45 15 4.05 L15 9.536 C15 12.6 12.6 15.3 9 16.2 C5.4 15.3 3 12.6 3 9.536 L3 4.05 C3.8 2.45 6.5 1.584 9 1.584 Z'

function glyph(status) {
  const white = '#ffffff'
  const dark = '#332100'

  switch (status) {
    case 'clear':
      return `<path d="M5.95 9.28 L8.04 11.56 L12.14 6.64" fill="none" stroke="${white}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'publicLeak':
      return `<path d="M6.56 11.29 L11.44 6.18 M11.44 11.29 L6.56 6.18" fill="none" stroke="${white}" stroke-width="1.85" stroke-linecap="round"/>`
    case 'localExposure':
      return `<path d="M9 6.18 L9 9.61" fill="none" stroke="${white}" stroke-width="1.85" stroke-linecap="round"/><circle cx="9" cy="11.52" r="1" fill="${white}"/>`
    case 'inconclusive':
      return `<path d="M6.55 7.35 C6.7 5.75 7.62 4.85 9 4.85 C10.55 4.85 11.55 5.85 11.55 7.15 C11.55 8.35 10.9 8.95 9.95 9.6 C9.2 10.1 9 10.5 9 11.15" fill="none" stroke="${dark}" stroke-width="1.55" stroke-linecap="round"/><circle cx="9" cy="13.2" r="0.95" fill="${dark}"/>`
    case 'offline':
      return `<path d="M6.47 8.21 L11.53 8.21" fill="none" stroke="${white}" stroke-width="1.85" stroke-linecap="round"/>`
    case 'checking':
      return `<circle cx="6.56" cy="8.3" r="0.85" fill="${white}"/><circle cx="9" cy="8.3" r="0.85" fill="${white}"/><circle cx="11.44" cy="8.3" r="0.85" fill="${white}"/>`
    case 'idle':
      return `<circle cx="9" cy="9.1" r="1" fill="${white}"/>`
    case 'armed':
      return `<rect x="6.2" y="8.5" width="5.6" height="4.7" rx="0.9" fill="${white}"/><path d="M7.35 8.5 V7.15 C7.35 5.75 8.05 4.95 9 4.95 C9.95 4.95 10.65 5.75 10.65 7.15 V8.5" fill="none" stroke="${white}" stroke-width="1.15" stroke-linecap="round"/>`
    case 'killed':
      return `<path d="M6.1 9.1 L11.9 9.1" fill="none" stroke="${white}" stroke-width="2.1" stroke-linecap="round"/>`
    default:
      return ''
  }
}

function traySvg(status) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
    <path d="${SHIELD_PATH}" fill="${COLORS[status]}" stroke="rgba(0,0,0,0.28)" stroke-width="0.55"/>
    <path d="${INNER_PATH}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.45"/>
    ${glyph(status)}
  </svg>`
}

const fallbackAppIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101827"/>
      <stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="shield" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <circle cx="512" cy="470" r="330" fill="#0ea5e9" opacity="0.10"/>
  <g transform="translate(152 156) scale(40)" filter="url(#glow)">
    <path d="${SHIELD_PATH}" fill="url(#shield)" stroke="rgba(255,255,255,0.16)" stroke-width="0.35"/>
    <path d="${INNER_PATH}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.45"/>
    <path d="M5.95 9.28 L8.04 11.56 L12.14 6.64" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`

async function extractAppIconPng() {
  const icns = path.join(repoRoot, 'Resources', 'AppIcon.icns')
  if (process.platform !== 'darwin' || !existsSync(icns)) return null

  const output = path.join(tmpDir, 'app-icon.png')
  try {
    execFileSync(
      'sips',
      ['-s', 'format', 'png', icns, '--out', output],
      { stdio: 'ignore' }
    )
    if (!existsSync(output)) return null
    return await readFile(output)
  } catch {
    return null
  }
}

async function main() {
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })
  await mkdir(trayDir, { recursive: true })
  await mkdir(linuxIconsDir, { recursive: true })

  let extracted = null
  try {
    extracted = await extractAppIconPng()
  } catch {
    extracted = null
  }

  const source = extracted ?? Buffer.from(fallbackAppIconSvg)
  const appIconBuffer = await sharp(source)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toBuffer()

  await writeFile(path.join(resourcesDir, 'icon.png'), appIconBuffer)
  await writeFile(path.join(buildDir, 'icon.png'), appIconBuffer)

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoInputs = await Promise.all(
    icoSizes.map((size) =>
      sharp(appIconBuffer).resize(size, size, { fit: 'cover' }).png().toBuffer()
    )
  )
  const ico = await pngToIco(icoInputs)
  await writeFile(path.join(buildDir, 'icon.ico'), ico)

  const linuxSizes = [16, 24, 32, 48, 64, 128, 256, 512]
  for (const size of linuxSizes) {
    await sharp(appIconBuffer)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(linuxIconsDir, `${size}x${size}.png`))
  }

  const traySizes = [16, 20, 24, 32, 48, 64]
  for (const status of STATUSES) {
    const svg = Buffer.from(traySvg(status))
    for (const size of traySizes) {
      await sharp(svg)
        .resize(size, size)
        .png()
        .toFile(path.join(trayDir, `${status}-${size}.png`))
    }
  }

  // electron-builder looks for build/icon.png as a convenience fallback.
  await copyFile(
    path.join(resourcesDir, 'icon.png'),
    path.join(buildDir, 'icon.png')
  )

  await rm(tmpDir, { recursive: true, force: true })

  console.log(
    `Icons generated: app 1024px (${extracted ? 'from AppIcon.icns' : 'vector fallback'}), ` +
      `ico ${icoSizes.join('/')}px, Linux ${linuxSizes.join('/')}px, ` +
      `tray ${STATUSES.length} statuses × ${traySizes.join('/')}px.`
  )
}

main().catch((error) => {
  console.error('Icon generation failed:', error)
  process.exit(1)
})
