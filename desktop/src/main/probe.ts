import { BrowserWindow, session } from 'electron'
import type { BrowserLeaksReport } from '../core/models'
import type { ProbePayload } from '../core/extraction'
import { EXTRACTION_JS } from '../core/extraction'
import {
  isWebRTCFinal,
  makeReport,
  parsePayload,
  shouldFinish
} from '../core/probeLogic'
import {
  BROWSERLEAKS_URL,
  PROBE_POLL_MS,
  PROBE_TIMEOUT_MS,
  PROBE_PARTITION
} from '../shared/constants'
import { chromeUserAgent } from './userAgent'

export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

function isBrowserLeaksUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'browserleaks.com' ||
        url.hostname.endsWith('.browserleaks.com'))
    )
  } catch {
    return false
  }
}

/**
 * Loads the real BrowserLeaks /ip page in a hidden Chromium window and reads
 * the rendered cells. Uses a non-persistent session and destroys the window
 * after every check, so no browsing data survives.
 */
export class BrowserLeaksProbe {
  private running = false

  async probe(): Promise<BrowserLeaksReport> {
    if (this.running) {
      throw new ProbeError('A BrowserLeaks check is already running.')
    }

    this.running = true
    try {
      return await this.runProbe()
    } finally {
      this.running = false
    }
  }

  private runProbe(): Promise<BrowserLeaksReport> {
    return new Promise<BrowserLeaksReport>((resolve, reject) => {
      const startedAt = Date.now()
      const partitionSession = session.fromPartition(PROBE_PARTITION)

      // BrowserLeaks does not need any device permission. Denying explicitly
      // keeps the probe from ever prompting or gaining access.
      partitionSession.setPermissionRequestHandler((_contents, _permission, callback) => {
        callback(false)
      })
      partitionSession.setPermissionCheckHandler(() => false)

      let settled = false
      let loadedAt: number | null = null
      let lastPayload: ProbePayload | null = null
      let pollInFlight = false
      let pollTimer: NodeJS.Timeout | null = null
      let timeoutTimer: NodeJS.Timeout | null = null

      const window = new BrowserWindow({
        width: 960,
        height: 900,
        x: -20_000,
        y: -20_000,
        show: false,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          partition: PROBE_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          spellcheck: false
        }
      })

      const contents = window.webContents
      contents.setUserAgent(chromeUserAgent())
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-navigate', (event, url) => {
        if (!isBrowserLeaksUrl(url)) event.preventDefault()
      })

      const cleanup = async (): Promise<void> => {
        if (pollTimer) clearInterval(pollTimer)
        if (timeoutTimer) clearTimeout(timeoutTimer)
        pollTimer = null
        timeoutTimer = null

        try {
          if (!window.isDestroyed()) window.destroy()
        } catch {
          /* already gone */
        }

        try {
          await partitionSession.clearStorageData()
          await partitionSession.clearCache()
        } catch {
          /* best-effort privacy cleanup */
        }
      }

      const finish = (
        outcome:
          | { ok: true; report: BrowserLeaksReport }
          | { ok: false; error: Error }
      ): void => {
        if (settled) return
        settled = true

        void cleanup().finally(() => {
          if (outcome.ok) {
            resolve(outcome.report)
          } else {
            reject(outcome.error)
          }
        })
      }

      const fail = (message: string): void => {
        finish({ ok: false, error: new ProbeError(message) })
      }

      const handlePayload = (payload: ProbePayload): void => {
        lastPayload = payload
        if (loadedAt === null) return
        if (!shouldFinish(payload, Date.now() - loadedAt)) return

        const report = makeReport(
          payload,
          isWebRTCFinal(payload),
          startedAt,
          Date.now()
        )

        if (!report) {
          fail(
            'BrowserLeaks did not return the expected IP data. The site may be unavailable or its layout may have changed.'
          )
          return
        }

        finish({ ok: true, report })
      }

      const poll = async (): Promise<void> => {
        if (settled || pollInFlight) return
        pollInFlight = true

        try {
          const raw = (await contents.executeJavaScript(
            EXTRACTION_JS,
            true
          )) as unknown

          if (typeof raw === 'string' && !settled) {
            const payload = parsePayload(raw)
            if (payload) handlePayload(payload)
          }
        } catch {
          // The page may still be navigating; the next tick retries.
        } finally {
          pollInFlight = false
        }
      }

      const startPolling = (): void => {
        if (settled || pollTimer) return
        pollTimer = setInterval(() => {
          void poll()
        }, PROBE_POLL_MS)
        void poll()
      }

      contents.on('did-finish-load', () => {
        if (settled) return
        if (loadedAt === null) {
          loadedAt = Date.now()
          startPolling()
        }
      })

      contents.on(
        'did-fail-load',
        (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
          if (settled || isMainFrame === false) return
          if (errorCode === -3) return // ERR_ABORTED from our own teardown
          fail(`Could not load BrowserLeaks: ${errorDescription}`)
        }
      )

      contents.on('render-process-gone', () => {
        fail('The Chromium process running the BrowserLeaks page stopped unexpectedly.')
      })

      window.on('closed', () => {
        if (!settled) {
          fail('The hidden BrowserLeaks window closed before the check finished.')
        }
      })

      timeoutTimer = setTimeout(() => {
        if (settled) return

        if (lastPayload) {
          const report = makeReport(
            lastPayload,
            false,
            startedAt,
            Date.now()
          )
          if (report) {
            finish({ ok: true, report })
            return
          }
        }

        finish({
          ok: false,
          error: new ProbeError('The BrowserLeaks check timed out.')
        })
      }, PROBE_TIMEOUT_MS)

      window
        .loadURL(BROWSERLEAKS_URL, {
          extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n'
        })
        .catch((error: unknown) => {
          if (settled) return
          const message =
            error instanceof Error ? error.message : 'Unknown navigation error'
          fail(`Could not load BrowserLeaks: ${message}`)
        })
    })
  }
}
