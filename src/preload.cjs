const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('canto', {
  action: (name, data) => ipcRenderer.invoke('action', name, data),
  dropFiles: files => ipcRenderer.invoke('dropped-files', Array.from(files, file => webUtils.getPathForFile(file))),
  onEvent: callback => ipcRenderer.on('event', (_event, value) => callback(value))
});
