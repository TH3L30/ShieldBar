import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PREVIEW_STATES = [
  'clear',
  'leak',
  'local',
  'welcome',
  'inconclusive',
  'offline',
  'update'
] as const

type PreviewState = (typeof PREVIEW_STATES)[number]

const PREVIEW_WIDTH = 386
const PREVIEW_HEIGHT = 900

/**
 * Developer-only offscreen renderer. Loads the dashboard with deterministic,
 * documentation-only fixture data and writes PNGs. Never touches the network.
 */
export async function renderPreviews(outputDirectory?: string): Promise<number> {
  await app.whenReady()

  const directory = outputDirectory
    ? outputDirectory
    : join(app.getAppPath(), 'preview')

  await mkdir(directory, { recursive: true })

  const rendererHtml = join(__dirname, '../renderer/index.html')
  const preload = join(__dirname, '../preload/index.js')

  await warmUp(rendererHtml, preload)

  let failures = 0

  for (const state of PREVIEW_STATES) {
    const window = new BrowserWindow({
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    try {
      const loaded = new Promise<void>((resolve, reject) => {
        window.webContents.once('did-finish-load', () => resolve())
        window.webContents.once('did-fail-load', (_event, code, description) => {
          reject(new Error(`Renderer failed to load (${code}): ${description}`))
        })
      })

      await window.loadFile(rendererHtml, { search: `preview=${state}` })
      await loaded
      // Allow React to paint and any ResizeObserver-driven layout to settle.
      await new Promise((resolve) => setTimeout(resolve, 600))

      const png = await captureWithRetry(window)
      const filename = previewFilename(state)
      await writeFile(join(directory, filename), png)
      process.stdout.write(`Rendered ${filename}\n`)
    } catch (error) {
      failures += 1
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Could not render ${state}: ${message}\n`)
    } finally {
      window.destroy()
    }
  }

  failures += await renderProtectionPreviews(rendererHtml, preload, directory)

  process.stdout.write(`Preview directory: ${directory}\n`)
  return failures === 0 ? 0 : 1
}

async function renderProtectionPreviews(
  rendererHtml: string,
  preload: string,
  directory: string
): Promise<number> {
  const protectionHtml = join(__dirname, '../renderer/protection.html')
  const variants = [
    { preview: 'protection', filename: 'protection-ready.png' },
    { preview: 'protection-triggered', filename: 'protection-triggered.png' }
  ]
  let failures = 0

  for (const variant of variants) {
    const window = new BrowserWindow({
      width: 760,
      height: 1450,
      x: -20_000,
      y: -20_000,
      show: false,
      frame: false,
      backgroundColor: '#f4f4f6',
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    try {
      await window.loadFile(protectionHtml, {
        search: `preview=${variant.preview}`
      })
      const contentHeight = (await window.webContents.executeJavaScript(
        `Math.ceil((document.querySelector('.protection-shell')?.getBoundingClientRect().height ?? 1000) + 40)`
      )) as number
      window.setContentSize(760, Math.max(640, Math.min(1450, contentHeight)))
      await new Promise((resolve) => setTimeout(resolve, 700))
      const png = await captureWithRetry(window)
      await writeFile(join(directory, variant.filename), png)
      process.stdout.write(`Rendered ${variant.filename}\n`)
    } catch (error) {
      failures += 1
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(
        `Could not render ${variant.filename}: ${message}\n`
      )
    } finally {
      window.destroy()
    }
  }

  return failures
}

function previewFilename(state: PreviewState): string {
  return state === 'welcome' ? 'dashboard-welcome.png' : `dashboard-${state}.png`
}

/**
 * The very first capture on a fresh CI compositor can fail with
 * "UnknownVizError" before the surface is ready. Retry briefly.
 */
async function captureWithRetry(window: BrowserWindow): Promise<Buffer> {
  let lastError: unknown = null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      window.webContents.invalidate()
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 700))

      const image = await window.webContents.capturePage()
      const png = image.toPNG()

      if (png.length > 0 && hasVisiblePixels(image)) return png
      lastError = new Error('capturePage returned a blank frame')
    } catch (error) {
      lastError = error
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'unknown error'
  throw new Error(`capturePage failed after retries: ${message}`)
}

function hasVisiblePixels(image: Electron.NativeImage): boolean {
  const bitmap = image.toBitmap()
  let visible = 0

  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] > 8) {
      visible += 1
      if (visible > 5_000) return true
    }
  }

  return false
}

/**
 * The first compositor surface on Windows CI can stay blank until something
 * has painted once. Load and capture a throwaway dashboard first.
 */
async function warmUp(rendererHtml: string, preload: string): Promise<void> {
  const window = new BrowserWindow({
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    x: -20_000,
    y: -20_000,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await window.loadFile(rendererHtml, { search: 'preview=clear' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    await captureWithRetry(window)
  } catch {
    /* the real captures still retry and will surface any failure */
  } finally {
    window.destroy()
  }
}
