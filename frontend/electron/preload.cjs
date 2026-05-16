const { contextBridge, ipcRenderer } = require('electron')

// Expone una API segura al renderer (React) sin dar acceso a Node.js completo
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: () => ipcRenderer.invoke('is-electron'),
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
})
