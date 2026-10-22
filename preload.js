// preload.js — expose safe IPC to renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('explorer', {
  home: () => ipcRenderer.invoke('fs:home'),
  platform: () => ipcRenderer.invoke('fs:platform'),
  readDir: (p) => ipcRenderer.invoke('fs:readDir', p),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  openPath: (p) => ipcRenderer.invoke('fs:openPath', p),
  homePaths: () => ipcRenderer.invoke('fs:homePaths'),
  drives: () => ipcRenderer.invoke('fs:drives'),
  statfs: (p) => ipcRenderer.invoke('fs:statfs', p),
  /* file operations */
  newFolder: (dir) => ipcRenderer.invoke('fs:newFolder', dir),
  newFile: (dir, name) => ipcRenderer.invoke('fs:newFile', dir, name),
  rename: (oldPath, newName) => ipcRenderer.invoke('fs:rename', oldPath, newName),
  trash: (paths) => ipcRenderer.invoke('fs:trash', paths),
  paste: (items, destDir, op) => ipcRenderer.invoke('fs:paste', items, destDir, op),
  properties: (p) => ipcRenderer.invoke('fs:properties', p),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),
  zip: (paths, destDir) => ipcRenderer.invoke('fs:zip', paths, destDir),
  sysOpen: (what) => ipcRenderer.invoke('sys:open', what),
  /* ribbon 主页扩展 */
  copyText: (text) => ipcRenderer.invoke('sys:copyText', text),
  pickDir: (title) => ipcRenderer.invoke('sys:pickDir', title),
  editFile: (p) => ipcRenderer.invoke('sys:edit', p),
  mkShortcut: (targets, destDir) => ipcRenderer.invoke('sys:mkShortcut', targets, destDir),
  /* window controls */
  winMin: () => ipcRenderer.send('win:minimize'),
  winMax: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen')
});
