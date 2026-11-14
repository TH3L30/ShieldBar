import type { ShieldBarAPI } from './ipc'

declare global {
  interface Window {
    shieldbar: ShieldBarAPI
  }
}

export {}
