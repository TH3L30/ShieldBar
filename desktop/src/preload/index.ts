import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type ShieldBarAPI, type ShieldState } from '../shared/ipc'

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
  }
}

contextBridge.exposeInMainWorld('shieldbar', api)
