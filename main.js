// main.js — Electron main process
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// 沙箱/无 GPU 环境下稳定渲染
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

/* file logging for headless diagnosis */
const LOG = path.join(os.tmpdir(), 'macdows-explorer.log');
function log(...args) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + args.join(' ') + '\n'); } catch {}
  try { console.log(...args); } catch {}
}
/* 管道断裂（父控制台关闭）时静默，避免 EPIPE 死循环 */
process.stdout?.on?.('error', (e) => { if (e.code === 'EPIPE') process.exitCode = 0; });
process.stderr?.on?.('error', (e) => { if (e.code === 'EPIPE') process.exitCode = 0; });
let inUncaught = false;
process.on('uncaughtException', (e) => {
  if (inUncaught || /EPIPE/.test(String(e))) return; // 防递归 + 忽略管道噪音
  inUncaught = true;
  log('UNCAUGHT:', e.stack || String(e));
  inUncaught = false;
});
process.on('unhandledRejection', (e) => log('UNHANDLED:', (e && e.stack) || String(e)));

let win = null;

function createWindow() {
  log('creating window, cwd=', process.cwd());
  win = new BrowserWindow({
    width: 1100,
    height: 660,
    minWidth: 720,
    minHeight: 420,
    frame: false,
    backgroundColor: '#f0f0f0',
    icon: path.join(__dirname, 'icons', 'Icons', 'folders', 'explorer.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.maximize();
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('renderer gone:', details.reason, details.exitCode);
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });
  win.webContents.on('did-finish-load', () => log('did-finish-load, title=', win.getTitle()));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('did-fail-load', code, desc, url));
  win.on('closed', () => log('window closed'));
  log('window created');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

/* ---------------- window controls (cross-platform) ---------------- */
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => {
  if (!win) return;
  // macOS: toggle fullscreen; others: toggle maximize
  if (process.platform === 'darwin') {
    win.setFullScreen(!win.isFullScreen());
  } else if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});
ipcMain.on('win:close', () => win && win.close());
ipcMain.handle('win:isMaximized', () => win ? (win.isMaximized() || win.isFullScreen()) : false);
ipcMain.handle('win:isFullscreen', () => win ? win.isFullScreen() : false);

/* ---------------- fs helpers ---------------- */
const ICON_EXE_HINTS = []; // placeholder

function statEntry(fullPath, name) {
  try {
    const st = fs.statSync(fullPath);
    return {
      name,
      path: fullPath,
      isDir: st.isDirectory(),
      mtime: st.mtimeMs,
      size: st.isFile() ? st.size : null
    };
  } catch (e) {
    return null;
  }
}

ipcMain.handle('fs:home', () => os.homedir());
ipcMain.handle('fs:platform', () => process.platform);

ipcMain.handle('fs:readDir', async (_e, dirPath) => {
  let names = [];
  try {
    names = await fs.promises.readdir(dirPath, { withFileTypes: false });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), entries: [] };
  }
  const entries = [];
  await Promise.all(names.map(async (name) => {
    const full = path.join(dirPath, name);
    const st = statEntry(full, name);
    if (st) entries.push(st);
  }));
  return { ok: true, entries };
});

ipcMain.handle('fs:exists', (_e, p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

ipcMain.handle('fs:openPath', async (_e, p) => {
  const err = await shell.openPath(p);
  return err || null;
});

/* preview: read a slice of a text file for the preview pane */
ipcMain.handle('fs:readText', (_e, p) => {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return { ok: false };
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(Math.min(st.size, 8192));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return { ok: true, text: buf.toString('utf8'), truncated: st.size > buf.length };
  } catch { return { ok: false }; }
});

ipcMain.handle('fs:homePaths', () => {
  const h = os.homedir();
  const paths = {
    home: h,
    desktop: app.getPath('desktop'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    music: app.getPath('music'),
    pictures: app.getPath('pictures'),
    videos: app.getPath('videos'),
    threeD: path.join(h, '3D Objects')
  };
  return paths;
});

/* ---------------- drives ---------------- */
/* .NET DriveInfo：不依赖 WMI（WMI 在部分机器上会被拒绝访问） */
function listDrivesWin32() {
  return new Promise((resolve) => {
    const ps = `
[Console]::OutputEncoding=[Text.Encoding]::UTF8
[System.IO.DriveInfo]::GetDrives() | ForEach-Object {
  try {
    "{0}|{1}|{2}|{3}|{4}" -f $_.Name, [int]$_.DriveType, $_.VolumeLabel, $_.TotalSize, $_.AvailableFreeSpace
  } catch {
    "{0}|{1}||0|0" -f $_.Name, [int]$_.DriveType
  }
}`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        const drives = [];
        if (stdout) {
          for (const line of stdout.split(/\r?\n/)) {
            const t = line.trim();
            if (!t) continue;
            const parts = t.split('|');
            if (parts.length < 5) continue;
            const [name, dtype, vol, size, free] = parts;
            if (!/^[a-zA-Z]:\\?$/.test(name)) continue;
            drives.push({
              letter: name.replace('\\', ''),
              type: parseInt(dtype, 10),
              volume: vol || '',
              size: Number(size) || 0,
              free: Number(free) || 0
            });
          }
        }
        if (drives.length === 0) {
          // 最后兜底：直接探测盘符（无卷标/容量信息）
          for (let i = 65; i <= 90; i++) {
            const letter = String.fromCharCode(i) + ':';
            try { fs.statSync(letter + '\\'); drives.push({ letter, type: 3, volume: '', size: 0, free: 0 }); } catch {}
          }
        }
        resolve(drives);
      });
  });
}

async function listDrivesUnix() {
  const drives = [];
  const platform = process.platform;
  const roots = new Set(['/']);
  try {
    if (platform === 'darwin') {
      const vols = await fs.promises.readdir('/Volumes').catch(() => []);
      for (const v of vols) roots.add(path.join('/Volumes', v));
    } else {
      // linux: common mount locations
      const media = await fs.promises.readdir('/media').catch(() => []);
      for (const m of media) {
        const sub = path.join('/media', m);
        try {
          const st = fs.statSync(sub);
          if (st.isDirectory()) {
            const inner = await fs.promises.readdir(sub).catch(() => []);
            if (inner.length === 0) roots.add(sub);
            else for (const i of inner) roots.add(path.join(sub, i));
          }
        } catch {}
      }
      const mnt = await fs.promises.readdir('/mnt').catch(() => []);
      for (const m of mnt) roots.add(path.join('/mnt', m));
    }
  } catch {}
  for (const root of roots) {
    try {
      const st = fs.statSync(root);
      if (!st.isDirectory()) continue;
      drives.push({ letter: root, type: 3, volume: path.basename(root) || '/', size: 0, free: 0 });
    } catch {}
  }
  return drives;
}

ipcMain.handle('fs:drives', async () => {
  if (process.platform === 'win32') return listDrivesWin32();
  return listDrivesUnix();
});

/* quick disk usage on non-windows via statfs (node >= 19) */
ipcMain.handle('fs:statfs', async (_e, p) => {
  try {
    if (typeof fs.statfsSync === 'function') {
      const s = fs.statfsSync(p);
      const bsize = s.bsize || 1;
      return { size: bsize * s.blocks, free: bsize * s.bavail };
    }
  } catch {}
  return null;
});

/* ---------------- file operations ---------------- */

/* recursive copy (file or directory) */
function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/* generate "xxx (2)", "xxx (3)" ... for name collision */
function uniqueName(dirPath, name) {
  let candidate = path.join(dirPath, name);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    candidate = path.join(dirPath, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

ipcMain.handle('fs:newFolder', (_e, dirPath) => {
  try {
    let target = path.join(dirPath, '新建文件夹');
    let i = 2;
    while (fs.existsSync(target)) { target = path.join(dirPath, `新建文件夹 (${i++})`); }
    fs.mkdirSync(target);
    return { ok: true, path: target };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

ipcMain.handle('fs:newFile', (_e, dirPath, name) => {
  try {
    const target = uniqueName(dirPath, name);
    fs.writeFileSync(target, '');
    return { ok: true, path: target };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

ipcMain.handle('fs:rename', (_e, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const target = path.join(dir, newName);
    if (fs.existsSync(target) && target !== oldPath) {
      return { ok: false, error: '已存在同名项目' };
    }
    fs.renameSync(oldPath, target);
    return { ok: true, path: target };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* delete -> recycle bin / trash */
ipcMain.handle('fs:trash', async (_e, paths) => {
  const results = [];
  for (const p of paths) {
    try { await shell.trashItem(p); results.push({ path: p, ok: true }); }
    catch (e) { results.push({ path: p, ok: false, error: String(e && e.message || e) }); }
  }
  return results;
});

/* copy items into destDir (op: 'copy' | 'cut') */
ipcMain.handle('fs:paste', async (_e, items, destDir, op) => {
  const results = [];
  for (const src of items) {
    const base = path.basename(src);
    const dest = path.join(destDir, base);
    try {
      if (path.resolve(src) === path.resolve(dest)) {
        // pasting into same folder (copy op) -> auto rename
        if (op === 'cut') { results.push({ src, ok: true, skipped: true }); continue; }
      }
      const target = uniqueName(destDir, base);
      if (op === 'cut') {
        try {
          fs.renameSync(src, target);
        } catch {
          // cross-device rename fails -> fallback copy + trash
          copyRecursive(src, target);
          await shell.trashItem(src);
        }
      } else {
        copyRecursive(src, target);
      }
      results.push({ src, ok: true, path: target });
    } catch (e) {
      results.push({ src, ok: false, error: String(e && e.message || e) });
    }
  }
  return results;
});

/* properties of one path */
ipcMain.handle('fs:properties', async (_e, p) => {
  try {
    const st = fs.statSync(p);
    let size = st.isFile() ? st.size : 0;
    let files = 0, dirs = 0;
    if (st.isDirectory()) {
      const walk = (d) => {
        let names = [];
        try { names = fs.readdirSync(d); } catch { return; }
        for (const n of names) {
          const full = path.join(d, n);
          try {
            const s = fs.statSync(full);
            if (s.isDirectory()) { dirs++; walk(full); }
            else { files++; size += s.size; }
          } catch {}
        }
      };
      walk(p);
    }
    return {
      ok: true,
      name: path.basename(p),
      isDir: st.isDirectory(),
      size,
      files, dirs,
      mtime: st.mtimeMs,
      ctime: st.ctimeMs,
      hidden: path.basename(p).startsWith('.')
    };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* open system tools (windows only; no-op elsewhere) */
ipcMain.handle('sys:open', async (_e, what) => {
  if (process.platform !== 'win32') {
    return { ok: false, error: '此功能仅在 Windows 上可用' };
  }
  const cmds = {
    sysdm: () => execFile('control.exe', ['sysdm.cpl'], { windowsHide: true }),
    appwiz: () => execFile('control.exe', ['appwiz.cpl'], { windowsHide: true }),
    mgmt: () => execFile('compmgmt.msc', [], { windowsHide: true, shell: true }),
    settings: () => execFile('control.exe', [], { windowsHide: true }),
    folders: () => execFile('control.exe', ['folders'], { windowsHide: true }),
    filehistory: () => execFile('control.exe', ['/name', 'Microsoft.FileHistory'], { windowsHide: true })
  };
  const fn = cmds[what];
  if (!fn) return { ok: false, error: '未知命令' };
  try { fn(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* write text to the OS clipboard (跨平台) */
ipcMain.handle('sys:copyText', (_e, text) => {
  try { clipboard.writeText(String(text ?? '')); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* folder picker dialog (跨平台) */
ipcMain.handle('sys:pickDir', async (_e, title) => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: title || '选择目标文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { ok: true, path: null };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* open file with default text editor (win: notepad / mac: open -t / linux: xdg-open) */
ipcMain.handle('sys:edit', async (_e, p) => {
  try {
    if (process.platform === 'win32') {
      execFile('notepad.exe', [p], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      execFile('open', ['-t', p]);
    } else {
      execFile('xdg-open', [p]);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

/* create shortcut into destDir:
   win: .lnk via PowerShell WScript.Shell COM
   mac/linux: symbolic link */
ipcMain.handle('sys:mkShortcut', async (_e, targets, destDir) => {
  const results = [];
  for (const t of targets) {
    const base = path.basename(t);
    try {
      if (process.platform === 'win32') {
        const name = uniqueName(destDir, base.replace(/\.[^.]+$/, '') + '.lnk');
        const ps = `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${name.replace(/'/g, "''")}')
$s.TargetPath = '${String(t).replace(/'/g, "''")}'
$s.Save()`;
        await new Promise((res, rej) => execFile('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', ps],
          { windowsHide: true, timeout: 30000 }, (err) => err ? rej(err) : res()));
        results.push({ src: t, ok: true, path: name });
      } else {
        const name = uniqueName(destDir, base);
        // symlink target paths on mac/linux use forward slashes already
        fs.symlinkSync(t, name);
        results.push({ src: t, ok: true, path: name });
      }
    } catch (e) { results.push({ src: t, ok: false, error: String(e && e.message || e) }); }
  }
  return results;
});

/* zip selected items (no external deps: use tar.gz on unix, powershell Compress-Archive on win) */
ipcMain.handle('fs:zip', async (_e, paths, destDir) => {
  try {
    const { execFile } = require('child_process');
    const first = paths[0] || '';
    const zipName = uniqueName(destDir, (path.basename(first) || 'archive') + '.zip');
    if (process.platform === 'win32') {
      const list = paths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
      const ps = `Compress-Archive -Path @(${list}) -DestinationPath '${zipName.replace(/'/g, "''")}' -Force`;
      await new Promise((res, rej) => execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { windowsHide: true, timeout: 120000 }, (err) => err ? rej(err) : res()));
    } else {
      const args = ['-r', '-q', zipName, ...paths.map(p => path.basename(p))];
      const cwd = path.dirname(first);
      await new Promise((res, rej) => execFile('zip', args, { cwd, windowsHide: true }, (err) => err ? rej(err) : res()));
    }
    return { ok: true, path: zipName };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
