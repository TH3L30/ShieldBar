import type { ProtectionState } from '../../shared/protection'
import { DEFAULT_PROTECTION_SETTINGS } from '../../shared/protection'

export function previewProtectionState(triggered = false): ProtectionState {
  return {
    phase: triggered ? 'triggered' : 'ready',
    armed: false,
    triggered,
    beta: true,
    message: triggered
      ? 'Network disabled: public IP leak.'
      : 'Baseline captured for this session.',
    lastTrigger: triggered ? 'publicLeak' : null,
    baselineLabel: triggered ? null : 'Canada · Ontario · Toronto',
    helperInstalled: true,
    helperVersion: '1.1.3',
    settings: {
      ...DEFAULT_PROTECTION_SETTINGS,
      enabled: true,
      startAtLogin: true
    },
    baseline: triggered
      ? null
      : {
          label: 'Canada · Ontario · Toronto',
          fields: ['country'],
          capturedAt: Date.now() - 120_000
        },
    vpnAdapters: [
      { name: 'utun3', likelyVpn: true },
      { name: 'en0', likelyVpn: false }
    ],
    remoteSession: { detected: false, kind: null },
    lastCheckedAt: Date.now() - 14_000,
    currentStatus: 'clear',
    currentHeadline: 'Clear',
    canSetBaseline: !triggered,
    canArm: !triggered
  }
}
