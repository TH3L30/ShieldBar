import type { ShieldStatus } from './models'
import {
  BACKGROUND_INTERVAL_MS,
  OFFLINE_INTERVAL_MS,
  OPEN_INTERVAL_MS,
  PROTECTION_INTERVAL_MS
} from '../shared/constants'

export interface ScheduleInput {
  status: ShieldStatus
  isNetworkAvailable: boolean
  popoverOpen: boolean
  protectionArmed?: boolean
}

/**
 * Background cadence: 60s while offline or without a network path, 30s while
 * the popover is open, 15 minutes otherwise. This is deliberately independent
 * of the 1-second renderer heartbeat.
 */
export function checkIntervalMs(input: ScheduleInput): number {
  if (!input.isNetworkAvailable || input.status === 'offline') {
    return OFFLINE_INTERVAL_MS
  }
  if (input.protectionArmed) {
    return PROTECTION_INTERVAL_MS
  }
  if (input.popoverOpen) {
    return OPEN_INTERVAL_MS
  }
  return BACKGROUND_INTERVAL_MS
}
