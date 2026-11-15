import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type ShieldBarAPI,
  type ShieldState
} from '../shared/ipc'
import type {
  ProtectionActionResult,
  ProtectionSettings,
  ProtectionState
} from '../shared/protection'
import type {
  UpdateActionResult,
  UpdateState
} from '../shared/update'

const api: ShieldBarAPI = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState) as Promise<ShieldState>,
  refresh: () => ipcRenderer.send(IPC_CHANNELS.refresh),
  openFullReport: () => ipcRenderer.send(IPC_CHANNELS.openFullReport),
  openBrowserLeaks: () => ipcRenderer.send(IPC_CHANNELS.openBrowserLeaks),
  setNotify: (value: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setNotify, value) as Promise<boolean>,
  dismissWelcome: () =>
    ipcRenderer.invoke(IPC_CHANNELS.dismissWelcome) as Promise<void>,
  showAbout: () => ipcRenderer.send(IPC_CHANNELS.showAbout),
  copyText: (text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.copyText, text) as Promise<void>,
  setHeight: (height: number) => ipcRenderer.send(IPC_CHANNELS.setHeight, height),
  hide: () => ipcRenderer.send(IPC_CHANNELS.hide),
  quit: () => ipcRenderer.send(IPC_CHANNELS.quit),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ShieldState): void => {
      callback(state)
    }
    ipcRenderer.on(IPC_CHANNELS.state, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.state, listener)
  },

  getProtectionState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProtectionState) as Promise<ProtectionState>,
  installHelper: () =>
    ipcRenderer.invoke(IPC_CHANNELS.installHelper) as Promise<ProtectionActionResult>,
  uninstallHelper: () =>
    ipcRenderer.invoke(IPC_CHANNELS.uninstallHelper) as Promise<ProtectionActionResult>,
  setProtectionBaseline: () =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setProtectionBaseline
    ) as Promise<ProtectionActionResult>,
  armProtection: (options) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.armProtection,
      options
    ) as Promise<ProtectionActionResult>,
  disarmProtection: () =>
    ipcRenderer.invoke(IPC_CHANNELS.disarmProtection) as Promise<ProtectionActionResult>,
  restoreNetwork: () =>
    ipcRenderer.invoke(IPC_CHANNELS.restoreNetwork) as Promise<ProtectionActionResult>,
  updateProtectionSettings: (patch: Partial<ProtectionSettings>) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateProtectionSettings,
      patch
    ) as Promise<ProtectionSettings>,
  openProtection: () => ipcRenderer.send(IPC_CHANNELS.openProtection),
  onProtectionState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: ProtectionState
    ): void => {
      callback(state)
    }
    ipcRenderer.on(IPC_CHANNELS.protectionState, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.protectionState, listener)
  },

  getUpdateState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getUpdateState) as Promise<UpdateState>,
  checkForUpdates: () =>
    ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates) as Promise<UpdateActionResult>,
  dismissUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.dismissUpdate) as Promise<UpdateState>,
  openUpdateRelease: () => ipcRenderer.send(IPC_CHANNELS.openUpdateRelease),
  setAutoCheckUpdates: (value: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.setAutoCheckUpdates,
      value
    ) as Promise<UpdateState>
}

contextBridge.exposeInMainWorld('shieldbar', api)
