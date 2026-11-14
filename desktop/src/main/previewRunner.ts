import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PREVIEW_STATES = [
  'clear',
  'leak',
  'local',
  'welcome',
  'inconclusive',
  'offline'
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

  process.stdout.write(`Preview directory: ${directory}\n`)
  return failures === 0 ? 0 : 1
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

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const image = await window.webContents.capturePage()
      const png = image.toPNG()
      if (png.length > 0) return png
      lastError = new Error('capturePage returned an empty image')
    } catch (error) {
      lastError = error
    }

    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'unknown error'
  throw new Error(`capturePage failed after retries: ${message}`)
}
