const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: () => ipcRenderer.invoke('is-electron'),
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  reconfigureDb: () => ipcRenderer.invoke('reconfigure-db'),
})
