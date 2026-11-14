import { useEffect, useRef, useState } from 'react'
import type { ShieldState } from '../../shared/ipc'
import type { BrowserLeaksReport, ShieldStatus } from '../../core/models'
import {
  locationLine,
  reportLocalAddresses,
  reportPublicAddresses
} from '../../core/models'
import { isPreviewName, previewState } from './fixtures'

const STATUS_COLORS: Record<ShieldStatus, string> = {
  clear: '#29c76b',
  publicLeak: '#ff453b',
  localExposure: '#ff9e0a',
  inconclusive: '#f7b500',
  offline: '#8f8f96',
  checking: '#0a85ff',
  idle: '#9e9ea6'
}

const PREVIEW_PARAM = new URLSearchParams(window.location.search).get('preview')
const PREVIEW_NAME = isPreviewName(PREVIEW_PARAM) ? PREVIEW_PARAM : null
const PREVIEW_MODE = PREVIEW_NAME !== null

export function App() {
  const [state, setState] = useState<ShieldState | null>(() =>
    previewState(PREVIEW_NAME)
  )
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const [copyTimer, setCopyTimer] = useState<number | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (PREVIEW_MODE) return

    let active = true
    void window.shieldbar
      .getState()
      .then((next) => {
        if (active) setState(next)
      })
      .catch(() => {
        if (active) {
          setState((current) => current ?? null)
        }
      })

    const unsubscribe = window.shieldbar.onState((next) => {
      if (active) setState(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const element = cardRef.current
    if (!element) return

    const sendHeight = (): void => {
      const height = Math.ceil(element.getBoundingClientRect().height + 16)
      window.shieldbar?.setHeight?.(height)
    }

    const observer = new ResizeObserver(sendHeight)
    observer.observe(element)
    sendHeight()

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.shieldbar?.hide?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    return () => {
      if (copyTimer !== null) window.clearTimeout(copyTimer)
    }
  }, [copyTimer])

  if (!state) {
    return (
      <main className="card" ref={cardRef}>
        <div className="loading-card">
          <div className="spinner" aria-hidden="true" />
          <span>Loading ShieldBar…</span>
        </div>
      </main>
    )
  }

  const copy = async (text: string): Promise<void> => {
    if (copyTimer !== null) window.clearTimeout(copyTimer)
    try {
      await window.shieldbar.copyText(text)
      setCopied(true)
      const timer = window.setTimeout(() => setCopied(false), 1500)
      setCopyTimer(timer)
    } catch {
      /* clipboard access can fail; the address stays selectable */
    }
  }

  const dismissWelcome = (): void => {
    setState((current) =>
      current ? { ...current, showWelcome: false } : current
    )
    void window.shieldbar.dismissWelcome()
  }

  const toggleNotifications = async (): Promise<void> => {
    if (!state) return
    const next = !state.notifyOnLeak
    setState((current) =>
      current ? { ...current, notifyOnLeak: next } : current
    )
    try {
      const actual = await window.shieldbar.setNotify(next)
      setState((current) =>
        current ? { ...current, notifyOnLeak: actual } : current
      )
    } catch {
      /* keep the optimistic value; the next state push corrects it */
    }
  }

  const report = state.report
  const evaluating = state.isChecking
  const localAddresses = report ? reportLocalAddresses(report) : []
  const publicAddresses = report ? reportPublicAddresses(report) : []

  return (
    <main className="card" ref={cardRef} aria-live="polite">
      <header className="header">
        <ShieldIcon status={state.status} size={38} />
        <div className="header-copy">
          <h1>{state.evaluation.headline}</h1>
          <p>{state.evaluation.detail}</p>
        </div>
      </header>

      {state.showWelcome && (
        <section className="welcome" aria-label="Welcome">
          <TrayIcon />
          <div className="welcome-copy">
            <strong>ShieldBar lives in the system tray</strong>
            <span>
              Click the shield anytime. This card updates itself while it is
              open.
            </span>
          </div>
          <button
            type="button"
            className="icon-button welcome-close"
            onClick={dismissWelcome}
            aria-label="Dismiss welcome message"
            title="Dismiss"
          >
            ×
          </button>
        </section>
      )}

      <section className="panel" aria-label="IP address">
        <div className="panel-heading">
          <SectionIcon kind="network" />
          <span>IP Address</span>
          <span className="spacer" />
          {state.status === 'offline' && report && (
            <span className="badge stale">LAST KNOWN</span>
          )}
        </div>

        {report ? (
          <>
            <div className="ip-line">
              <span className="ip-address">{report.pageIPv4}</span>
              <button
                type="button"
                className="icon-button copy-button"
                onClick={() => void copy(report.pageIPv4)}
                aria-label="Copy public IP address"
                title={copied ? 'Copied' : 'Copy public IP address'}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>

            <DetailRow
              label="Location"
              value={locationValue(report)}
            />
            <DetailRow label="ISP" value={report.isp || 'Unknown'} />
            <DetailRow
              label="IPv6"
              value={report.pageIPv6 || 'Not detected'}
              mono={Boolean(report.pageIPv6)}
            />
          </>
        ) : evaluating ? (
          <div className="loading-row">
            <div className="spinner small" aria-hidden="true" />
            <span>Loading BrowserLeaks…</span>
          </div>
        ) : (
          <p className="muted">
            No IP result yet. Press Refresh to run a check.
          </p>
        )}
      </section>

      <section className="panel" aria-label="WebRTC leak check">
        <div className="panel-heading">
          <SectionIcon kind="webrtc" />
          <span>WebRTC Leak Check</span>
        </div>

        {report ? (
          <>
            <div className="verdict-row">
              <span className="muted">BrowserLeaks</span>
              <span className={`verdict ${verdictTone(state, report)}`}>
                {verdictText(state, report)}
              </span>
            </div>

            <DetailRow
              label="Local IP"
              value={
                localAddresses.length > 0
                  ? localAddresses.join(', ')
                  : 'None exposed'
              }
              mono={localAddresses.length > 0}
              tone={localAddresses.length > 0 ? 'orange' : 'green'}
            />
            <DetailRow
              label="WebRTC IP"
              value={
                publicAddresses.length > 0
                  ? publicAddresses.join(', ')
                  : 'No candidate'
              }
              mono={publicAddresses.length > 0}
              tone={
                publicAddresses.length === 0
                  ? 'orange'
                  : state.evaluation.publicMismatch.length > 0
                    ? 'red'
                    : undefined
              }
            />

            {state.status === 'publicLeak' && (
              <p className="warning red">
                WebRTC sees a different public IP than BrowserLeaks. VPN or
                proxy traffic may be bypassing the tunnel.
              </p>
            )}
            {state.status === 'localExposure' && (
              <p className="warning orange">
                A private/local IP is visible to WebRTC sites.
              </p>
            )}
            {state.status === 'inconclusive' && (
              <p className="warning orange">
                Not enough data to judge. ShieldBar will not show green without
                a complete result.
              </p>
            )}

            <p className="footnote">
              WebRTC public should match the IP BrowserLeaks sees; local
              addresses should not appear at all.
            </p>
          </>
        ) : (
          <p className="muted">
            The WebRTC test runs together with the IP check.
          </p>
        )}
      </section>

      <div className="freshness">
        {evaluating && <div className="spinner tiny" aria-hidden="true" />}
        <span>{freshnessText(state, now)}</span>
        <span className="spacer" />
        {state.status === 'offline' && state.lastCheckedAt !== null && (
          <span className="badge stale">STALE</span>
        )}
      </div>

      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => window.shieldbar.refresh()}
          disabled={evaluating}
          title="Run a fresh BrowserLeaks IP and WebRTC test now"
        >
          <RefreshIcon />
          {evaluating ? 'Checking…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => window.shieldbar.openFullReport()}
          title="Open the full BrowserLeaks report in a separate window"
        >
          <ReportIcon />
          Full Report
        </button>
      </div>

      <details className="settings">
        <summary>
          <GearIcon />
          Settings
        </summary>
        <div className="settings-body">
          <label className="toggle-row">
            <span>Notify me when a public leak appears</span>
            <input
              type="checkbox"
              checked={state.notifyOnLeak}
              onChange={() => void toggleNotifications()}
            />
            <span className="switch" aria-hidden="true" />
          </label>

          <p className="footnote">
            Notifications never include IP addresses. They fire only when the
            status changes to a public leak.
          </p>

          <div className="settings-actions">
            <button
              type="button"
              className="link-button"
              onClick={() => window.shieldbar.showAbout()}
            >
              About ShieldBar
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => window.shieldbar.quit()}
            >
              Quit ShieldBar
            </button>
          </div>
        </div>
      </details>

      <footer className="attribution">
        <span>Data from BrowserLeaks · not affiliated</span>
        <span className="spacer" />
        <button
          type="button"
          className="link-button accent"
          onClick={() => window.shieldbar.openBrowserLeaks()}
        >
          Visit site
        </button>
      </footer>
    </main>
  )
}

function DetailRow({
  label,
  value,
  mono = false,
  tone
}: {
  label: string
  value: string
  mono?: boolean
  tone?: 'green' | 'orange' | 'red'
}) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span
        className={`detail-value${mono ? ' mono' : ''}${
          tone ? ` tone-${tone}` : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function ShieldIcon({
  status,
  size
}: {
  status: ShieldStatus
  size: number
}) {
  const color = STATUS_COLORS[status]
  const glyphColor = status === 'inconclusive' ? '#332100' : '#ffffff'

  return (
    <svg
      className="shield-icon"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      role="img"
      aria-label={status}
    >
      <path
        d="M9 .9 C11.826 .9 14.809 1.884 15.751 3.688 L15.751 9.592 C15.751 13.036 13.082 15.988 9 16.972 C4.918 15.988 2.249 13.036 2.249 9.592 L2.249 3.688 C3.191 1.884 6.174 .9 9 .9 Z"
        fill={color}
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="0.55"
      />
      <path
        d="M9 1.584 C11.5 1.584 14.2 2.45 15 4.05 L15 9.536 C15 12.6 12.6 15.3 9 16.2 C5.4 15.3 3 12.6 3 9.536 L3 4.05 C3.8 2.45 6.5 1.584 9 1.584 Z"
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="0.45"
      />
      {status === 'clear' && (
        <path
          d="M5.95 9.28 L8.04 11.56 L12.14 6.64"
          fill="none"
          stroke={glyphColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === 'publicLeak' && (
        <path
          d="M6.56 11.29 L11.44 6.18 M11.44 11.29 L6.56 6.18"
          fill="none"
          stroke={glyphColor}
          strokeWidth="1.85"
          strokeLinecap="round"
        />
      )}
      {status === 'localExposure' && (
        <>
          <path
            d="M9 6.18 L9 9.61"
            fill="none"
            stroke={glyphColor}
            strokeWidth="1.85"
            strokeLinecap="round"
          />
          <circle cx="9" cy="11.52" r="1" fill={glyphColor} />
        </>
      )}
      {status === 'inconclusive' && (
        <text
          x="9"
          y="11.7"
          textAnchor="middle"
          fontSize="10.8"
          fontWeight="800"
          fill={glyphColor}
          fontFamily="system-ui, sans-serif"
        >
          ?
        </text>
      )}
      {status === 'offline' && (
        <path
          d="M6.47 8.21 L11.53 8.21"
          fill="none"
          stroke={glyphColor}
          strokeWidth="1.85"
          strokeLinecap="round"
        />
      )}
      {status === 'checking' && (
        <>
          <circle cx="6.56" cy="8.3" r="0.85" fill={glyphColor} />
          <circle cx="9" cy="8.3" r="0.85" fill={glyphColor} />
          <circle cx="11.44" cy="8.3" r="0.85" fill={glyphColor} />
        </>
      )}
      {status === 'idle' && <circle cx="9" cy="9.1" r="1" fill={glyphColor} />}
    </svg>
  )
}

function SectionIcon({ kind }: { kind: 'network' | 'webrtc' }) {
  if (kind === 'network') {
    return (
      <svg className="section-icon" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" />
        <path
          d="M1.5 6h9M6 1.5c1.4 1.3 2.1 2.8 2.1 4.5S7.4 10.7 6 10.5C4.6 10.7 3.9 8.2 3.9 6S4.6 2.8 6 1.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
        />
      </svg>
    )
  }

  return (
    <svg className="section-icon" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="8.2" r="1" fill="currentColor" />
      <path
        d="M3.5 5.7a3.6 3.6 0 0 1 5 0M2 4.2a5.8 5.8 0 0 1 8 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function TrayIcon() {
  return (
    <svg className="tray-icon" viewBox="0 0 14 14" aria-hidden="true">
      <rect
        x="1"
        y="2"
        width="12"
        height="9"
        rx="1.5"
        fill="none"
        stroke="currentColor"
      />
      <path d="M1 4.5h12" stroke="currentColor" strokeWidth="0.9" />
      <circle cx="11" cy="3.2" r="0.55" fill="currentColor" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2 6.4 4.6 9 10 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="6"
        height="6"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M2 8V2.8c0-.4.3-.8.8-.8H8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M10 6a4 4 0 1 1-1.2-2.8M10 1.5v2.8H7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="9"
        height="9"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M3.6 6h4.8M3.6 8.2h3.2"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg className="gear-icon" viewBox="0 0 12 12" aria-hidden="true">
      <circle
        cx="6"
        cy="6"
        r="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M6 1.3v1.2M6 9.5v1.2M1.3 6h1.2M9.5 6h1.2M2.7 2.7l.9.9M8.4 8.4l.9.9M9.3 2.7l-.9.9M3.6 8.4l-.9.9"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function locationValue(report: BrowserLeaksReport): string {
  const flag = flagEmoji(report.countryCode)
  const location = locationLine(report) ?? 'Unknown'
  return flag ? `${flag} ${location}` : location
}

function flagEmoji(code?: string): string | null {
  if (!code || code.length !== 2) return null
  const upper = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return null
  return String.fromCodePoint(
    0x1f1e6 + (upper.charCodeAt(0) - 65),
    0x1f1e6 + (upper.charCodeAt(1) - 65)
  )
}

function verdictText(state: ShieldState, report: BrowserLeaksReport): string {
  const text = report.rtcLeakText?.trim()
  if (text) return text
  if (state.evaluation.publicMismatch.length > 0) return 'Public IP mismatch'
  if (state.evaluation.localExposed.length > 0) return 'Local IP exposed'
  if (report.rtcTestCompleted && state.evaluation.publicAddresses.length > 0) {
    return 'No local leak detected'
  }
  return 'Incomplete result'
}

function verdictTone(
  state: ShieldState,
  report: BrowserLeaksReport
): 'green' | 'red' | 'orange' | 'muted' {
  const text = report.rtcLeakText?.toLowerCase()
  if (text) {
    if (text.includes('no local') || text.includes('no leak')) return 'green'
    if (text.includes('leak') || text.includes('mismatch')) return 'orange'
    return 'muted'
  }

  switch (state.status) {
    case 'clear':
      return 'green'
    case 'publicLeak':
      return 'red'
    case 'localExposure':
    case 'inconclusive':
      return 'orange'
    default:
      return 'muted'
  }
}

function freshnessText(state: ShieldState, now: number): string {
  if (state.isChecking) return 'Running BrowserLeaks test…'
  if (state.lastCheckedAt === null) return 'Not checked yet'

  let text = `Checked ${relativeAge(state.lastCheckedAt, now)}`

  if (state.nextCheckAt !== null) {
    const seconds = Math.max(0, Math.floor((state.nextCheckAt - now) / 1000))
    if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60)
      const remainder = seconds % 60
      text += ` · next in ${minutes}m ${String(remainder).padStart(2, '0')}s`
    } else {
      text += ` · next in ${seconds}s`
    }
  }

  return text
}

function relativeAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
