// Preload — the only bridge between the pet's UI and the OS window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onNatural: (cb) => ipcRenderer.on('natural-mode', (_e, on) => cb(on)),
  reportRect: (r) => ipcRenderer.send('orca-rect', r),
  hitTest: (overOrca) => ipcRenderer.send('hit-test', overOrca),
  releaseFocus: () => ipcRenderer.send('release-focus'),
  quit: () => ipcRenderer.send('quit'),
  spotify: {
    connect: () => ipcRenderer.invoke('spotify-connect'),
    status: () => ipcRenderer.invoke('spotify-status'),
    control: (act) => ipcRenderer.invoke('spotify-control', act),
    onUpdate: (cb) => ipcRenderer.on('spotify-update', (_e, data) => cb(data))
  },
  moveBy: (dx, dy) => ipcRenderer.send('move-by', dx, dy)
});
