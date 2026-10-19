const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('canto', {
  action: (name, data) => ipcRenderer.invoke('action', name, data),
  onEvent: callback => ipcRenderer.on('event', (_event, value) => callback(value))
});
