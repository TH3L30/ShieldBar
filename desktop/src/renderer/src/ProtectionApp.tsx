import { useEffect, useState, type ReactNode } from 'react'
import type {
  LocationField,
  ProtectionActionResult,
  ProtectionSettings,
  ProtectionState
} from '../../shared/protection'
import { previewProtectionState } from './protectionFixtures'

const FIELD_LABELS: Record<LocationField, string> = {
  country: 'Country',
  region: 'Region',
  city: 'City',
  isp: 'ISP / ASN',
  exactIp: 'Exact IP'
}

const FIELD_HELP: Record<LocationField, string> = {
  country: 'Stable default. VPN rotation within a country stays quiet.',
  region: 'Triggers when the VPN exits in another region.',
  city: 'Strict. GeoIP updates can trigger this.',
  isp: 'Triggers when the network operator changes.',
  exactIp: 'Very strict. Every VPN rotation will trigger.'
}

const PREVIEW = new URLSearchParams(window.location.search).get('preview')
const PREVIEW_TRIGGERED = PREVIEW === 'protection-triggered'
const PREVIEW_MODE = PREVIEW === 'protection' || PREVIEW_TRIGGERED

export function ProtectionApp() {
  const [state, setState] = useState<ProtectionState | null>(() =>
    PREVIEW_MODE ? previewProtectionState(PREVIEW_TRIGGERED) : null
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<ProtectionActionResult | null>(null)
  const [ackRemote, setAckRemote] = useState(false)
  const [ackNoVpn, setAckNoVpn] = useState(false)

  useEffect(() => {
    if (PREVIEW_MODE) return

    let active = true
    void window.shieldbar
      .getProtectionState()
      .then((next) => {
        if (active) setState(next)
      })
      .catch(() => {
        if (active) {
          setNotice({ ok: false, message: 'Could not load protection state.' })
        }
      })

    const unsubscribe = window.shieldbar.onProtectionState((next) => {
      if (active) setState(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (!state) {
    return (
      <main className="protection-shell">
        <div className="protection-loading">Loading protection…</div>
      </main>
    )
  }

  const refresh = async (): Promise<void> => {
    try {
      setState(await window.shieldbar.getProtectionState())
    } catch {
      /* keep the last state */
    }
  }

  const runAction = async (
    key: string,
    action: () => Promise<ProtectionActionResult>
  ): Promise<void> => {
    setBusy(key)
    setNotice(null)
    try {
      const result = await action()
      setNotice(result)
      await refresh()
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(null)
    }
  }

  const updateSettings = async (
    patch: Partial<ProtectionSettings>
  ): Promise<void> => {
    setBusy('settings')
    setNotice(null)
    try {
      const settings = await window.shieldbar.updateProtectionSettings(patch)
      setState((current) =>
        current ? { ...current, settings } : current
      )
      await refresh()
    } catch (error) {
      setNotice({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(null)
    }
  }

  const toggleField = (field: LocationField): void => {
    const selected = state.settings.locationFields
    const next = selected.includes(field)
      ? selected.filter((value) => value !== field)
      : [...selected, field]
    if (next.length === 0) return
    void updateSettings({ locationFields: next })
  }

  const hasVpn = state.vpnAdapters.some((adapter) => adapter.likelyVpn)
  const canAcknowledge =
    (!state.remoteSession.detected || ackRemote) && (hasVpn || ackNoVpn)
  const phase = phaseLabel(state)
  const settings = state.settings

  return (
    <main className="protection-shell">
      <header className="protection-header">
        <div className="protection-mark">
          <LockIcon />
        </div>
        <div className="protection-title">
          <div className="title-line">
            <h1>Protection</h1>
            <span className="beta-pill">BETA</span>
          </div>
          <p>Kill switch and location guard</p>
        </div>
        <span className={`phase-pill ${state.phase}`}>{phase}</span>
      </header>

      <section className="beta-banner">
        <WarningIcon />
        <div>
          <strong>Protection can disable every network interface.</strong>
          <span>
            It is off by default, requires a one-time admin helper, and must be
            restored manually. Read the safety notes before arming.
          </span>
        </div>
      </section>

      {notice && (
        <div className={`notice ${notice.ok ? 'ok' : 'bad'}`}>
          {notice.message}
        </div>
      )}

      {state.triggered && (
        <section className="kill-banner">
          <div>
            <span className="kill-eyebrow">NETWORK DISABLED</span>
            <h2>Protection stopped your connection</h2>
            <p>
              {state.lastTrigger
                ? `Triggered by ${state.lastTrigger.replace(/([A-Z])/g, ' $1').toLowerCase()}.`
                : 'The helper reports that networking is disabled.'}{' '}
              Restore only when you are ready to reconnect.
            </p>
          </div>
          <button
            type="button"
            className="button danger"
            disabled={busy !== null}
            onClick={() =>
              void runAction('restore', () =>
                window.shieldbar.restoreNetwork()
              )
            }
          >
            {busy === 'restore' ? 'Restoring…' : 'Restore Network'}
          </button>
        </section>
      )}

      <section className="panel">
        <PanelHeading
          step="1"
          title="Master switch"
          detail="Enables the protection controls below."
          control={
            <Switch
              checked={settings.enabled}
              disabled={busy !== null}
              onChange={() =>
                void updateSettings({ enabled: !settings.enabled })
              }
              label="Enable protection"
            />
          }
        />
      </section>

      <section className="panel">
        <PanelHeading
          step="2"
          title="Privileged helper"
          detail="A tiny root/admin service. It only accepts status, disable, and restore commands, and only from your user."
        />

        <div className="helper-row">
          <div>
            <strong>
              {state.helperInstalled
                ? `Helper installed${state.helperVersion ? ` · v${state.helperVersion}` : ''}`
                : 'Helper not installed'}
            </strong>
            <span>
              {state.helperInstalled
                ? 'The helper is ready. You will be asked for admin approval only when installing or removing it.'
                : 'Installing requires one administrator or root approval. Without it, ShieldBar cannot disable networking.'}
            </span>
          </div>
          {state.helperInstalled ? (
            <button
              type="button"
              className="button subtle"
              disabled={busy !== null}
              onClick={() =>
                void runAction('uninstall', () =>
                  window.shieldbar.uninstallHelper()
                )
              }
            >
              {busy === 'uninstall' ? 'Removing…' : 'Remove helper'}
            </button>
          ) : (
            <button
              type="button"
              className="button primary"
              disabled={busy !== null}
              onClick={() =>
                void runAction('install', () =>
                  window.shieldbar.installHelper()
                )
              }
            >
              {busy === 'install' ? 'Waiting for approval…' : 'Install helper'}
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <PanelHeading
          step="3"
          title="Safe baseline"
          detail="Capture the location you trust for this session. Nothing is written to disk."
        />

        <div className="current-result">
          <span className="result-label">CURRENT CHECK</span>
          <strong>{state.currentHeadline}</strong>
          <span className="result-time">
            {state.lastCheckedAt
              ? `Checked ${relativeAge(state.lastCheckedAt)}`
              : 'Not checked yet'}
          </span>
        </div>

        <div className="baseline-box">
          <div>
            <span className="box-label">BASELINE</span>
            <strong>{state.baseline?.label ?? 'No baseline captured'}</strong>
            <span>
              {state.baseline
                ? `Captured ${relativeAge(state.baseline.capturedAt)} · ${state.baseline.fields
                    .map((field) => FIELD_LABELS[field])
                    .join(', ')}`
                : 'Run a check, wait for Clear, then set the current location as safe.'}
            </span>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={busy !== null || !state.canSetBaseline}
            onClick={() =>
              void runAction('baseline', () =>
                window.shieldbar.setProtectionBaseline()
              )
            }
          >
            {busy === 'baseline' ? 'Capturing…' : 'Set current as safe'}
          </button>
        </div>
      </section>

      <section className="panel">
        <PanelHeading
          step="4"
          title="Triggers"
          detail="Choose what should cut the connection."
        />

        <div className="toggle-list">
          <ToggleRow
            title="Public IP leak"
            detail="WebRTC sees a different public IP. Recommended."
            checked={settings.killOnPublicLeak}
            disabled={busy !== null}
            onChange={(value) => void updateSettings({ killOnPublicLeak: value })}
          />
          <ToggleRow
            title="Local IP exposure"
            detail="WebRTC exposes a private/local address. This is common on LANs."
            checked={settings.killOnLocalExposure}
            disabled={busy !== null}
            onChange={(value) =>
              void updateSettings({ killOnLocalExposure: value })
            }
          />
          <ToggleRow
            title="IP location change"
            detail="The public location no longer matches the baseline."
            checked={settings.killOnLocationChange}
            disabled={busy !== null}
            onChange={(value) =>
              void updateSettings({ killOnLocationChange: value })
            }
          />
          <ToggleRow
            title="Inconclusive result"
            detail="Blocked or incomplete BrowserLeaks data. Fail-open by default; fail-closed is stricter."
            checked={settings.failClosed}
            disabled={busy !== null}
            onChange={(value) => void updateSettings({ failClosed: value })}
          />
        </div>

        <div className="field-group">
          <span className="box-label">LOCATION FIELDS</span>
          <div className="field-chips">
            {(Object.keys(FIELD_LABELS) as LocationField[]).map((field) => (
              <label
                key={field}
                className={`field-chip ${
                  settings.locationFields.includes(field) ? 'selected' : ''
                }`}
                title={FIELD_HELP[field]}
              >
                <input
                  type="checkbox"
                  checked={settings.locationFields.includes(field)}
                  disabled={busy !== null}
                  onChange={() => toggleField(field)}
                />
                {FIELD_LABELS[field]}
              </label>
            ))}
          </div>
          <span className="field-note">
            {settings.locationFields.includes('exactIp')
              ? 'Exact IP is strictest: every VPN server rotation will trigger.'
              : 'Country is the stable default. Add fields only if you accept more false triggers.'}
          </span>
        </div>

        <div className="inline-setting">
          <div>
            <strong>Start ShieldBar at login</strong>
            <span>
              Protection only runs while ShieldBar is running. Recommended when
              armed.
            </span>
          </div>
          <Switch
            checked={settings.startAtLogin}
            disabled={busy !== null}
            onChange={() =>
              void updateSettings({ startAtLogin: !settings.startAtLogin })
            }
            label="Start ShieldBar at login"
          />
        </div>
      </section>

      <section className="panel">
        <PanelHeading
          step="5"
          title={state.armed ? 'Armed' : 'Arm protection'}
          detail="Arming starts a full BrowserLeaks check every 15 seconds."
        />

        <div className="adapters">
          <span className="box-label">DETECTED ADAPTERS</span>
          {state.vpnAdapters.length > 0 ? (
            <div className="adapter-list">
              {state.vpnAdapters.map((adapter) => (
                <span
                  key={adapter.name}
                  className={`adapter ${adapter.likelyVpn ? 'vpn' : ''}`}
                >
                  {adapter.name}
                  {adapter.likelyVpn ? ' · VPN' : ''}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">No non-loopback adapters detected.</p>
          )}
          {!hasVpn && (
            <p className="warning-text">
              No likely VPN adapter was detected. If you are connected to a VPN
              that does not expose an adapter, confirm it manually below.
            </p>
          )}
        </div>

        {state.remoteSession.detected && (
          <div className="remote-warning">
            <WarningIcon />
            <div>
              <strong>
                Remote session detected
                {state.remoteSession.kind ? ` (${state.remoteSession.kind})` : ''}
              </strong>
              <span>
                If protection fires, this session will lose access to the
                machine. Confirm the risk before arming.
              </span>
            </div>
          </div>
        )}

        {!state.armed && !state.triggered && (
          <div className="arm-checks">
            {state.remoteSession.detected && (
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={ackRemote}
                  onChange={(event) => setAckRemote(event.target.checked)}
                />
                I understand a remote session will be disconnected.
              </label>
            )}
            {!hasVpn && (
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={ackNoVpn}
                  onChange={(event) => setAckNoVpn(event.target.checked)}
                />
                I confirm my VPN is connected even though no adapter was
                detected.
              </label>
            )}
            <button
              type="button"
              className="button danger big"
              disabled={busy !== null || !state.canArm || !canAcknowledge}
              onClick={() =>
                void runAction('arm', () =>
                  window.shieldbar.armProtection({
                    acknowledgeRemote: !state.remoteSession.detected || ackRemote,
                    acknowledgeNoVpn: hasVpn || ackNoVpn
                  })
                )
              }
            >
              {busy === 'arm' ? 'Arming…' : 'Arm kill switch'}
            </button>
            <span className="arm-note">
              {!settings.enabled
                ? 'Enable the master switch first.'
                : !state.helperInstalled
                  ? 'Install the privileged helper first.'
                  : !state.baseline
                    ? 'Set a safe baseline first.'
                    : state.currentStatus !== 'clear'
                      ? 'Wait for a Clear result before arming.'
                      : 'Arming will check BrowserLeaks every 15 seconds.'}
            </span>
          </div>
        )}

        {state.armed && (
          <div className="armed-box">
            <div>
              <span className="armed-dot" />
              <strong>Protection is armed</strong>
              <span>{state.baseline?.label ?? state.message}</span>
            </div>
            <button
              type="button"
              className="button subtle"
              disabled={busy !== null}
              onClick={() =>
                void runAction('disarm', () =>
                  window.shieldbar.disarmProtection()
                )
              }
            >
              {busy === 'disarm' ? 'Disarming…' : 'Disarm'}
            </button>
          </div>
        )}

        {state.message && !state.triggered && (
          <p className="state-message">{state.message}</p>
        )}
      </section>

      <footer className="protection-footer">
        <span>
          Beta protection is off by default. Check the safety guide and test on
          a spare machine before relying on it.
        </span>
      </footer>
    </main>
  )
}

function PanelHeading({
  step,
  title,
  detail,
  control
}: {
  step: string
  title: string
  detail?: string
  control?: ReactNode
}) {
  return (
    <div className="panel-heading">
      <span className="step">{step}</span>
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {control && <div className="panel-control">{control}</div>}
    </div>
  )
}

function ToggleRow({
  title,
  detail,
  checked,
  disabled,
  onChange
}: {
  title: string
  detail: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="toggle-row">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(!checked)}
        label={title}
      />
    </div>
  )
}

function Switch({
  checked,
  disabled,
  onChange,
  label
}: {
  checked: boolean
  disabled: boolean
  onChange: () => void
  label: string
}) {
  return (
    <label className={`switch-label ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  )
}

function phaseLabel(state: ProtectionState): string {
  switch (state.phase) {
    case 'triggered':
      return 'Network disabled'
    case 'restoring':
      return 'Restoring'
    case 'armed':
      return 'Armed'
    case 'triggering':
      return 'Triggering'
    case 'error':
      return 'Error'
    case 'ready':
      return 'Ready'
    default:
      return 'Helper missing'
  }
}

function relativeAge(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="4.5"
        y="10"
        width="15"
        height="10"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 10V7.6a4 4 0 0 1 8 0V10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg className="warning-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 2.2 18.2 17H1.8L10 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 7v4.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14.2" r="1" fill="currentColor" />
    </svg>
  )
}
