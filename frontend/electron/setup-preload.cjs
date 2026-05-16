const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setupAPI', {
  checkPostgres: ()    => ipcRenderer.invoke('setup:check-postgres'),
  saveConfig:    (cfg) => ipcRenderer.invoke('setup:save-config', cfg),
})
