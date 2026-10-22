// app.js — renderer logic: navigation, views, sidebar, breadcrumb, context menu, file ops
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const ICON_ROOT = '../icons/Icons/';
  const icon = (rel) => ICON_ROOT + rel;

  /* ---------- icon map ---------- */
  const ICONS = {
    folder: icon('folders/folder.ico'),
    documents: icon('folders/documents.ico'),
    downloads: icon('folders/downloads.ico'),
    music: icon('folders/music.ico'),
    pictures: icon('folders/pictures.ico'),
    videos: icon('folders/videos.ico'),
    desktop: icon('folders/desktop.ico'),
    threeD: icon('folders/3dobjects.ico'),
    pc: icon('devices/drives/windows.ico'),
    network: icon('folders/network.ico'),
    favorites: icon('folders/favorites.ico'),
    hdd: icon('devices/drives/drive.ico'),
    dvd: icon('devices/drives/dvd.ico'),
    sysdrive: icon('devices/drives/windows.ico'),
    zip: icon('folders/zip.ico'),
    file: icon('files/generic.ico'),
    image: icon('files/image.ico'),
    text: icon('files/text.ico'),
    audio: icon('files/audio.ico'),
    video: icon('files/video.ico'),
    exe: icon('files/windowprogram.ico'),
    copy: icon('files/copy.ico'),
    cut: icon('files/select.ico'),
    paste: icon('files/move.ico'),
    del: icon('files/delete.ico'),
    rename: icon('files/select.ico'),
    open: icon('files/window.ico'),
    props: icon('files/configuration.ico'),
    newfolder: icon('folders/folder.ico'),
    refresh: icon('files/configuration2.ico'),
    share: icon('folders/share.ico'),
    email: icon('files/document.ico'),
    pin: icon('objects/pin.ico')
  };

  /* ---------- state ---------- */
  const state = {
    home: null,
    paths: null,
    platform: 'win32',
    history: [],
    hIndex: -1,
    current: null,
    entries: [],
    filtered: null,
    selection: new Set(),
    view: 'details',
    sortKey: 'name',
    sortAsc: true,
    search: '',
    navPaneVisible: true,
    showChecks: false,
    showHidden: false,
    showExt: true,
    columns: { mtime: true, type: true, size: true }, // 添加列（详细信息视图）
    autoFit: false,
    groupBy: 'none', // none|name|type|size|mtime
    pane: 'none',    // none|preview|details
    clipboard: null, // { op: 'copy'|'cut', items: [{path,name,isDir}] },
    ribbonCollapsed: false
  };

  /* 快速访问固定项（localStorage 持久化，跨平台等效） */
  const getPins = () => { try { return JSON.parse(localStorage.getItem('macdows.pins') || '[]'); } catch { return []; } };
  const savePins = (pins) => localStorage.setItem('macdows.pins', JSON.stringify(pins));

  let sysDriveLetter = 'C:';

  /* ---------- helpers ---------- */
  const path = {
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
    parent: (p) => {
      const isWin = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
      let norm = p.replace(/\\/g, '/');
      if (/^[a-zA-Z]:$/.test(norm)) return null;
      const idx = norm.replace(/\/$/, '').lastIndexOf('/');
      if (idx <= 0) {
        if (isWin && /^[a-zA-Z]:$/.test(norm.slice(0, 2))) return norm.slice(0, 2) + '/';
        return null;
      }
      let parent = norm.slice(0, idx);
      if (/^[a-zA-Z]:$/.test(parent)) parent += '/';
      return parent;
    },
    basename: (p) => {
      const n = p.replace(/\\/g, '/').replace(/\/$/, '');
      const i = n.lastIndexOf('/');
      let b = i >= 0 ? n.slice(i + 1) : n;
      if (/^[a-zA-Z]:$/.test(b)) b += '\\';
      return b || '/';
    }
  };

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    const kb = bytes / 1024;
    if (kb < 1024) return Math.round(kb).toLocaleString() + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + ' MB';
    const gb = mb / 1024;
    return (gb >= 100 ? Math.round(gb) : gb.toFixed(1)) + ' GB';
  }

  function fmtDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const EXT_NAMES = {
    zip: 'WinRAR ZIP 压缩文件', rar: 'WinRAR RAR 压缩文件', '7z': '7-Zip 压缩文件',
    txt: '文本文档', md: 'Markdown 文档', pdf: 'PDF 文档', doc: 'Word 文档', docx: 'Word 文档',
    xls: 'Excel 工作表', xlsx: 'Excel 工作表', ppt: 'PowerPoint 演示文稿', pptx: 'PowerPoint 演示文稿',
    exe: '应用程序', msi: 'Windows Installer 程序包', dll: '应用程序扩展',
    jpg: 'JPEG 图片', jpeg: 'JPEG 图片', png: 'PNG 图片', gif: 'GIF 图片', bmp: 'BMP 图片',
    ico: '图标文件', webp: 'WebP 图片', svg: 'SVG 矢量图',
    mp3: 'MP3 音频', flac: 'FLAC 音频', wav: 'WAV 音频', ape: 'APE 音频',
    mp4: 'MP4 视频', mkv: 'MKV 视频', avi: 'AVI 视频', flv: 'FLV 视频', mov: 'QuickTime 视频',
    html: 'HTML 文档', htm: 'HTML 文档', css: '层叠样式表', js: 'JavaScript 文件',
    ts: 'TypeScript 文件', py: 'Python 文件', json: 'JSON 文件', iso: '光盘映像文件',
    torrent: 'BT 种子文件', lnk: '快捷方式', cmd: 'Windows 命令脚本', bat: 'Windows 批处理文件',
    xml: 'XML 文档', csv: 'CSV 文件', hdi: 'HDI 光盘映像', nes: 'NES ROM 文件'
  };
  function extOf(name) {
    const n = name.toLowerCase();
    return n.includes('.') ? n.split('.').pop() : '';
  }
  function typeLabel(entry) {
    if (entry.isDir) return '文件夹';
    const ext = extOf(entry.name);
    return EXT_NAMES[ext] || (ext ? ext.toUpperCase() + ' 文件' : '文件');
  }
  /* display name honoring "hide extensions" */
  function displayName(entry) {
    if (entry.isDir || state.showExt) return entry.name;
    const i = entry.name.lastIndexOf('.');
    return i > 0 ? entry.name.slice(0, i) : entry.name;
  }
  function fileIcon(entry) {
    if (entry.isDir) return ICONS.folder;
    const ext = extOf(entry.name);
    if (['zip', 'rar', '7z', 'iso'].includes(ext)) return ICONS.zip;
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'webp', 'svg'].includes(ext)) return ICONS.image;
    if (['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'json', 'html', 'htm', 'css', 'js', 'ts', 'py', 'log', 'xml', 'csv'].includes(ext)) return ICONS.text;
    if (['mp3', 'flac', 'wav', 'ape', 'ogg', 'm4a'].includes(ext)) return ICONS.audio;
    if (['mp4', 'mkv', 'avi', 'flv', 'mov', 'wmv'].includes(ext)) return ICONS.video;
    if (ext === 'exe' || ext === 'msi') return ICONS.exe;
    return ICONS.file;
  }

  /* location model: { kind: 'root' | 'dir' | 'special', path, title } */
  function locKey(loc) {
    return loc.kind + '|' + (loc.path || '') + '|' + (loc.id || '');
  }
  /* current folder path for file operations (null at root/network) */
  function currentDir() {
    const cur = state.current;
    if (!cur) return null;
    if (cur.kind === 'dir' || cur.kind === 'special') return cur.path;
    return null;
  }

  /* ---------- breadcrumb ---------- */
  function renderBreadcrumb() {
    const bc = $('#breadcrumb');
    bc.innerHTML = '';
    const cur = state.current;
    const crumbs = [];
    if (cur.kind === 'root') {
      crumbs.push({ title: '此电脑', loc: cur });
    } else {
      crumbs.push({ title: '此电脑', loc: { kind: 'root', title: '此电脑' } });
      if (cur.kind === 'special') {
        crumbs.push({ title: cur.title, loc: cur });
      } else {
        let p = cur.path.replace(/\\/g, '/');
        const chain = [];
        while (p) {
          chain.unshift({ p });
          if (/^[a-zA-Z]:$/.test(p)) break;
          const up = path.parent(p);
          if (up === p || up == null) break;
          p = up;
        }
        for (const c of chain) {
          const isRoot = /^[a-zA-Z]:\/?$/.test(c.p);
          crumbs.push({
            title: isRoot ? c.p.replace('/', '') : path.basename(c.p),
            loc: { kind: 'dir', path: isRoot ? c.p.replace('/', '') + '/' : c.p, title: path.basename(c.p) }
          });
        }
      }
    }
    crumbs.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '▶';
        bc.appendChild(sep);
      }
      const el = document.createElement('span');
      el.className = 'crumb';
      el.textContent = c.title;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); navigate(c.loc); });
      bc.appendChild(el);
    });
    $('#search-input').placeholder = `搜索"${cur.title}"`;
  }

  /* ---------- 可编辑地址栏 ---------- */
  function currentAddrPath() {
    const cur = state.current;
    if (!cur) return '';
    if (cur.kind === 'root') return cur.title || '此电脑';
    return cur.path || cur.title || '';
  }

  function enterAddrEdit() {
    const bc = $('#breadcrumb');
    const inp = $('#addr-input');
    bc.classList.add('hidden');
    inp.classList.remove('hidden', 'invalid');
    inp.value = currentAddrPath();
    inp.focus();
    inp.select();
  }

  function exitAddrEdit() {
    const bc = $('#breadcrumb');
    const inp = $('#addr-input');
    inp.classList.add('hidden');
    bc.classList.remove('hidden');
    inp.value = '';
  }

  async function commitAddrEdit() {
    const inp = $('#addr-input');
    const raw = inp.value.trim().replace(/^"(.*)"$/, '$1');
    if (!raw) { exitAddrEdit(); return; }
    if (raw === '此电脑') { exitAddrEdit(); navigate({ kind: 'root', title: '此电脑' }); return; }
    /* 常见缩写展开 */
    let p = raw;
    if (p === '~') p = state.paths.home || p;
    else if (p.startsWith('~/')) p = (state.paths.home || '') + '/' + p.slice(2);
    p = p.replace(/%USERPROFILE%/gi, state.paths.home || '');
    /* 盘符根归一化： "C:" -> "C:\" */
    if (/^[a-zA-Z]:$/.test(p)) p += '\\';
    const info = await window.explorer.properties(p);
    if (!info.ok) {
      inp.classList.add('invalid');
      inp.select();
      return;
    }
    exitAddrEdit();
    if (info.isDir) {
      navigate({ kind: 'dir', path: p, title: path.basename(p) || p });
    } else {
      window.explorer.openPath(p);
    }
  }

  /* ---------- sidebar ---------- */
  async function buildSidebar() {
    const tree = $('#sidebar-tree');
    tree.innerHTML = '';

    /* 可折叠节点：悬停时左侧出现小箭头，点击展开/折叠子项 */
    const mkItem = ({ id, label, ic, loc, lvl = 0, container = tree, kids = false, pin = null }) => {
      const it = document.createElement('div');
      it.className = `tree-item${lvl ? ' lvl' + lvl : ''}`;
      it.dataset.id = id;
      let kidsBox = null;
      if (kids) {
        const tw = document.createElement('span');
        tw.className = 'twisty has-kids';
        tw.textContent = '▾';
        tw.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const collapsed = kidsBox.classList.toggle('collapsed');
          tw.textContent = collapsed ? '▸' : '▾';
        });
        it.appendChild(tw);
      }
      const img = document.createElement('img');
      img.src = ic;
      const lb = document.createElement('span');
      lb.className = 'tlabel';
      lb.textContent = label;
      it.appendChild(img);
      it.appendChild(lb);
      if (pin) {
        const pb = document.createElement('img');
        pb.src = ICONS.pin;
        pb.className = 'tpin';
        pb.title = '取消固定';
        pb.addEventListener('click', (ev) => {
          ev.stopPropagation();
          savePins(getPins().filter(x => x.path !== pin));
          buildSidebar();
        });
        it.appendChild(pb);
      }
      it.addEventListener('click', () => navigate(loc));
      container.appendChild(it);
      if (kids) {
        kidsBox = document.createElement('div');
        kidsBox.className = 'tree-kids';
        container.appendChild(kidsBox);
        it._kidsBox = kidsBox;
      }
      return it;
    };

    const p = state.paths;

    /* --- 快速访问（可折叠） --- */
    const fav = mkItem({ id: 'fav', label: '快速访问', ic: ICONS.favorites, loc: { kind: 'root', title: '此电脑' }, kids: true });
    const favBox = fav._kidsBox;
    mkItem({ id: 'desktop', label: '桌面', ic: ICONS.desktop, loc: { kind: 'special', id: 'desktop', path: p.desktop, title: '桌面' }, lvl: 1, container: favBox });
    mkItem({ id: 'downloads', label: '下载', ic: ICONS.downloads, loc: { kind: 'special', id: 'downloads', path: p.downloads, title: '下载' }, lvl: 1, container: favBox });
    mkItem({ id: 'documents', label: '文档', ic: ICONS.documents, loc: { kind: 'special', id: 'documents', path: p.documents, title: '文档' }, lvl: 1, container: favBox });
    mkItem({ id: 'pictures', label: '图片', ic: ICONS.pictures, loc: { kind: 'special', id: 'pictures', path: p.pictures, title: '图片' }, lvl: 1, container: favBox });
    mkItem({ id: 'music', label: '音乐', ic: ICONS.music, loc: { kind: 'special', id: 'music', path: p.music, title: '音乐' }, lvl: 1, container: favBox });
    mkItem({ id: 'videos', label: '视频', ic: ICONS.videos, loc: { kind: 'special', id: 'videos', path: p.videos, title: '视频' }, lvl: 1, container: favBox });

    /* --- 用户固定的快速访问项（主页「固定到快速访问」写入） --- */
    for (const pin of getPins()) {
      mkItem({ id: 'pin-' + pin.path, label: pin.name, ic: ICONS.folder, loc: { kind: 'dir', path: pin.path, title: pin.name }, lvl: 1, container: favBox, pin: pin.path });
    }

    /* --- 此电脑：挂载的分区与盘符（可折叠） --- */
    const pc = mkItem({ id: 'pc', label: '此电脑', ic: ICONS.pc, loc: { kind: 'root', title: '此电脑' }, kids: true });
    const pcBox = pc._kidsBox;
    const drives = await window.explorer.drives();
    state.unixRoots = [];
    for (const d of drives) {
      if (d.type === 4) continue; // network
      if (d.letter.startsWith('/')) state.unixRoots.push(d.letter);
      const isDVD = d.type === 5;
      const label = d.letter.match(/^[a-zA-Z]:$/)
        ? `${isDVD ? 'DVD 驱动器' : (isSysDrive(d.letter) ? '系统' : (d.volume || '本地磁盘'))} (${d.letter})`
        : (d.volume || d.letter);
      const ic = isDVD ? ICONS.dvd : (d.letter.match(/^[a-zA-Z]:$/) && isSysDrive(d.letter) ? ICONS.sysdrive : ICONS.hdd);
      mkItem({ id: 'drive-' + d.letter, label, ic, loc: { kind: 'dir', path: d.letter + (d.letter.startsWith('/') ? '' : '\\'), title: label }, lvl: 1, container: pcBox });
    }

    /* --- 网络（无子项，无箭头） --- */
    mkItem({ id: 'network', label: '网络', ic: ICONS.network, loc: { kind: 'root', title: '网络' } });
  }

  function updateSidebarSelection() {
    const cur = state.current;
    document.querySelectorAll('.tree-item').forEach((el) => {
      const id = el.dataset.id;
      let match = false;
      if (cur) {
        if (cur.kind === 'root') match = (cur.title === '网络') ? id === 'network' : (id === 'pc' || id === 'fav');
        else if (cur.kind === 'special') match = id === cur.id;
        else if (cur.kind === 'dir') {
          if (/^[a-zA-Z]:/.test(cur.path)) {
            match = id === 'drive-' + cur.path.slice(0, 2);
          } else {
            // unix: match longest mounted root prefix
            for (const root of state.unixRoots || []) {
              if (cur.path === root || cur.path.startsWith(root.replace(/\/$/, '') + '/')) {
                match = id === 'drive-' + root;
              }
            }
            if (!match && cur.path === '/') match = id === 'drive-//';
          }
        }
      }
      el.classList.toggle('selected', match);
    });
  }

  /* ---------- navigation ---------- */
  async function navigate(loc, opts = {}) {
    if (!loc) return;
    if (loc.title === '网络' && loc.kind === 'root') {
      state.current = { kind: 'root', title: '网络' };
      state.entries = [];
      state.filtered = null;
      state.selection.clear();
      clearContent();
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = '网络发现已关闭。没有可以显示的项目。';
      $('#content').appendChild(hint);
      renderBreadcrumb();
      updateSidebarSelection();
      $('#status-count').textContent = '0 个项目';
      $('#win-title').textContent = '网络';
      document.title = '网络';
      return;
    }
    if (!opts.noHistory) {
      state.history = state.history.slice(0, state.hIndex + 1);
      state.history.push(loc);
      state.hIndex = state.history.length - 1;
    }
    updateNavButtons();

    state.selection.clear();
    state.search = '';
    $('#search-input').value = '';
    state.current = loc;

    if (loc.kind === 'root') {
      // 此电脑 = 挂载的分区与盘符
      const drives = await window.explorer.drives();
      const driveItems = [];
      for (const d of drives) {
        if (d.type === 4) continue;
        let size = d.size, free = d.free;
        if ((!size || !free) && d.letter.startsWith('/')) {
          const s = await window.explorer.statfs(d.letter);
          if (s) { size = s.size; free = s.free; }
        }
        driveItems.push({ letter: d.letter, type: d.type, volume: d.volume, size, free, isDir: true, kind: 'drive' });
      }
      state.entries = [];
      renderRootView(driveItems);
    } else {
      const res = await window.explorer.readDir(loc.path);
      let entries = res.ok ? res.entries : [];
      if (!state.showHidden) entries = entries.filter(e => !e.name.startsWith('.'));
      state.entries = entries;
      applyFilter();
      renderContent();
    }
    renderBreadcrumb();
    updateSidebarSelection();
    $('#win-title').textContent = loc.title;
    document.title = loc.title;
  }

  function applyFilter() {
    const q = state.search.trim().toLowerCase();
    state.filtered = q ? state.entries.filter(e => e.name.toLowerCase().includes(q)) : null;
  }

  function getVisible() {
    const list = state.filtered || state.entries;
    const arr = [...list];
    const key = state.sortKey, asc = state.sortAsc;
    arr.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r = 0;
      if (key === 'name') r = a.name.localeCompare(b.name, 'zh-CN');
      else if (key === 'mtime') r = a.mtime - b.mtime;
      else if (key === 'size') r = (a.size || 0) - (b.size || 0);
      else if (key === 'type') r = typeLabel(a).localeCompare(typeLabel(b), 'zh-CN');
      return asc ? r : -r;
    });
    return arr;
  }

  /* ---------- rendering ---------- */
  function clearContent() { $('#content').innerHTML = ''; }

  const entryKey = (e) => e.path || ('drive:' + (e.letter || e.name));
  function attachItemEvents(el, entry) {
    el.dataset.key = entryKey(entry);
    el.addEventListener('click', (ev) => {
      if (ev.ctrlKey) {
        if (state.selection.has(entry)) state.selection.delete(entry);
        else state.selection.add(entry);
      } else {
        state.selection.clear();
        state.selection.add(entry);
      }
      refreshSelectionUI();
      updateStatus();
    });
    el.addEventListener('dblclick', () => openEntry(entry));
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!state.selection.has(entry)) {
        if (!ev.ctrlKey) state.selection.clear();
        state.selection.add(entry);
        refreshSelectionUI();
        updateStatus();
      }
      showContextMenu(ev.clientX, ev.clientY);
    });
  }

  async function openEntry(entry) {
    if (entry.kind === 'special' || (entry.isDir && entry.path)) {
      const loc = entry.kind === 'special'
        ? { kind: 'special', id: entry.id, path: entry.path, title: entry.title }
        : { kind: 'dir', path: entry.path, title: entry.name };
      navigate(loc);
    } else if (entry.kind === 'drive') {
      const letter = entry.letter;
      const isDVD = entry.type === 5;
      const title = letter.match(/^[a-zA-Z]:$/)
        ? `${isDVD ? 'DVD 驱动器' : (isSysDrive(letter) ? '系统' : (entry.volume || '本地磁盘'))} (${letter})`
        : (entry.volume || letter);
      navigate({ kind: 'dir', path: letter + (letter.startsWith('/') ? '' : '\\'), title });
    } else if (entry.path) {
      window.explorer.openPath(entry.path);
    }
  }

  function isSysDrive(letter) {
    return letter.toUpperCase().startsWith(sysDriveLetter.toUpperCase());
  }

  function renderRootView(drives) {
    clearContent();
    const c = $('#content');
    state.view = 'root';

    const gh2 = document.createElement('div');
    gh2.className = 'group-header';
    gh2.innerHTML = `<span class="twisty">▾</span>设备和驱动器 (${drives.length})`;
    c.appendChild(gh2);

    const grid2 = document.createElement('div');
    grid2.className = 'drive-grid';
    for (const d of drives) {
      const isDVD = d.type === 5;
      const label = isDVD ? `DVD 驱动器 (${d.letter})`
        : (d.letter.match(/^[a-zA-Z]:$/)
          ? `${isSysDrive(d.letter) ? '系统' : (d.volume || '本地磁盘')} (${d.letter})`
          : (d.volume || d.letter));
      const ic = isDVD ? ICONS.dvd : (isSysDrive(d.letter) ? ICONS.sysdrive : ICONS.hdd);
      const it = document.createElement('div');
      it.className = 'drive-item';
      it.dataset.key = 'drive:' + d.letter;
      let sub = '';
      if (!isDVD && d.size > 0) {
        const pct = Math.max(0, Math.min(100, ((d.size - d.free) / d.size) * 100));
        const low = d.free / d.size < 0.1;
        sub = `<div class="drive-bar${low ? ' low' : ''}"><div class="fill" style="width:${pct}%"></div></div>
               <div class="drive-info">${fmtSize(d.free)} 可用，共 ${fmtSize(d.size)}</div>`;
      }
      it.innerHTML = `<img class="dicon" src="${ic}" />
        <div class="dmeta">
          <span class="dname">${label}</span>${sub}
        </div>`;
      it.addEventListener('dblclick', () => {
        if (isDVD) return;
        openEntry(d);
      });
      it.addEventListener('click', () => {
        state.selection.clear(); state.selection.add(d);
        refreshSelectionUI(); updateStatus();
      });
      it.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        state.selection.clear(); state.selection.add(d);
        refreshSelectionUI(); updateStatus();
        showContextMenu(ev.clientX, ev.clientY);
      });
      grid2.appendChild(it);
    }
    c.appendChild(grid2);
    updateStatus();
  }

  function renderContent() {
    if (!state.current) return;
    if (state.current.kind === 'root') return; // root rendered by navigate()
    const view = state.view === 'root' ? 'details' : state.view;
    clearContent();
    $('#content').classList.toggle('show-checks', state.showChecks);
    const c = $('#content');
    const items = getVisible();

    if (items.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = state.search ? '没有与搜索条件匹配的项目。' : '此文件夹为空。';
      c.appendChild(hint);
      updateStatus();
      return;
    }

    /* ---- 分组依据 ---- */
    const groupEntries = (list) => {
      if (state.groupBy === 'none') return [{ title: null, items: list }];
      const buckets = new Map();
      const keyOf = (e) => {
        switch (state.groupBy) {
          case 'name': {
            const ch = (displayName(e)[0] || '#').toUpperCase();
            return /[0-9]/.test(ch) ? '0-9' : (/[A-Z]/.test(ch) ? ch : (/[a-z]/.test(ch) ? ch.toUpperCase() : '#'));
          }
          case 'type': return typeLabel(e);
          case 'size': {
            if (e.isDir) return '文件夹';
            const s = e.size || 0;
            if (s < 1024 * 100) return '微小 (0 - 100 KB)';
            if (s < 1024 * 1024) return '小 (100 KB - 1 MB)';
            if (s < 100 * 1024 * 1024) return '中 (1 - 100 MB)';
            return '大 (> 100 MB)';
          }
          case 'mtime': {
            const d = new Date(e.mtime || 0);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const that = new Date(d); that.setHours(0, 0, 0, 0);
            const diff = (today - that) / 86400000;
            if (diff <= 0) return '今天';
            if (diff <= 1) return '昨天';
            if (diff <= 7) return '上周';
            if (diff <= 31) return '上个月';
            if (d.getFullYear() === today.getFullYear()) return '今年早些时候';
            return '很久以前';
          }
          default: return '';
        }
      };
      for (const e of list) {
        const k = keyOf(e);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(e);
      }
      let keys = [...buckets.keys()];
      /* 组间排序跟随当前排序键 */
      const dir = state.sortAsc ? 1 : -1;
      keys.sort((a, b) => {
        if (state.groupBy === 'size') {
          const rank = { '文件夹': 0, '微小 (0 - 100 KB)': 1, '小 (100 KB - 1 MB)': 2, '中 (1 - 100 MB)': 3, '大 (> 100 MB)': 4 };
          return ((rank[a] || 0) - (rank[b] || 0)) * dir;
        }
        return a.localeCompare(b, 'zh-CN') * dir;
      });
      return keys.map(k => ({ title: `${k} (${buckets.get(k).length})`, items: buckets.get(k) }));
    };

    const colWidths = () => {
      if (state.autoFit) return {};
      const vis = ['name'].concat(['mtime', 'type', 'size'].filter(k => state.columns[k]));
      const w = { name: '42%', mtime: '22%', type: '22%', size: '14%' };
      if (vis.length === 4) return w;
      const per = Math.floor(100 / vis.length) - 2 + '%';
      const out = {};
      for (const k of vis) out[k] = per;
      out.name = Math.floor(100 / vis.length) + '%';
      return out;
    };

    const mkDetailsTable = (list) => {
      const table = document.createElement('table');
      table.className = 'details-table' + (state.autoFit ? ' autofit' : '');
      const thead = document.createElement('thead');
      const W = colWidths();
      const mkTh = (label, key) => {
        const th = document.createElement('th');
        if (W[key]) th.style.width = W[key];
        th.innerHTML = `${label}${state.sortKey === key ? `<span class="arrow">${state.sortAsc ? '▲' : '▼'}</span>` : ''}`;
        th.addEventListener('click', () => {
          if (state.sortKey === key) state.sortAsc = !state.sortAsc;
          else { state.sortKey = key; state.sortAsc = true; }
          renderContent();
        });
        return th;
      };
      thead.appendChild(mkTh('名称', 'name'));
      if (state.columns.mtime) thead.appendChild(mkTh('修改日期', 'mtime'));
      if (state.columns.type) thead.appendChild(mkTh('类型', 'type'));
      if (state.columns.size) thead.appendChild(mkTh('大小', 'size'));
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const e of list) {
        const tr = document.createElement('tr');
        tr.className = 'item-row';
        tr.dataset.path = e.path;
        let html = `<td><div class="dname"><img src="${fileIcon(e)}" /><span>${displayName(e)}</span></div></td>`;
        if (state.columns.mtime) html += `<td>${fmtDate(e.mtime)}</td>`;
        if (state.columns.type) html += `<td>${typeLabel(e)}</td>`;
        if (state.columns.size) html += `<td>${e.isDir ? '' : fmtSize(e.size)}</td>`;
        tr.innerHTML = html;
        attachItemEvents(tr, e);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      return table;
    };

    const mkIconGrid = (list, cls) => {
      const grid = document.createElement('div');
      grid.className = cls;
      for (const e of list) {
        const it = document.createElement('div');
        it.className = 'icon-item';
        const iconSize = view === 'small' ? 'width:16px;height:16px' : '';
        it.innerHTML = `<img src="${fileIcon(e)}" style="${iconSize}" /><span class="iname">${displayName(e)}</span>` +
          (view === 'content' ? `<span class="isub">${e.isDir ? '文件夹' : fmtSize(e.size)} ${fmtDate(e.mtime)}</span>` : '');
        attachItemEvents(it, e);
        grid.appendChild(it);
      }
      return grid;
    };

    if (view === 'details') {
      for (const g of groupEntries(items)) {
        if (g.title) {
          const gh = document.createElement('div');
          gh.className = 'cgroup-header';
          gh.textContent = g.title;
          c.appendChild(gh);
        }
        c.appendChild(mkDetailsTable(g.items));
      }
    } else {
      const cls = {
        large: 'icon-grid large',
        medium: 'icon-grid medium',
        xlarge: 'icon-grid xlarge',
        small: 'icon-grid',
        list: 'list-view',
        content: 'content-view'
      }[view] || 'icon-grid';
      for (const g of groupEntries(items)) {
        if (g.title) {
          const gh = document.createElement('div');
          gh.className = 'cgroup-header';
          gh.textContent = g.title;
          c.appendChild(gh);
        }
        c.appendChild(mkIconGrid(g.items, cls));
      }
    }
    updateStatus();
  }

  function onBlankContextMenu(ev) {
    // only when clicking empty space (not on an item)
    if (ev.target.closest('.icon-item') || ev.target.closest('tr.item-row')) return;
    ev.preventDefault();
    showContextMenu(ev.clientX, ev.clientY);
  }

  function refreshSelectionUI() {
    const keys = new Set([...state.selection].map(entryKey));
    document.querySelectorAll('#content .icon-item, #content .drive-item, #content tr.item-row').forEach((el) => {
      el.classList.toggle('selected', !!el.dataset.key && keys.has(el.dataset.key));
    });
  }

  function updateStatus() {
    const cur = state.current;
    if (cur && cur.kind === 'root') {
      const n = document.querySelectorAll('#content .drive-item').length;
      $('#status-count').textContent = `${n} 个项目`;
    } else {
      const list = state.filtered || state.entries;
      let t = `${list.length} 个项目`;
      if (state.selection.size > 0) t += `（选中 ${state.selection.size} 个项目）`;
      $('#status-count').textContent = t;
    }
    updatePane();
  }

  /* ---------- 右侧窗格（预览 / 详细信息） ---------- */
  const IMG_EXT = /\.(png|jpe?g|gif|bmp|ico|webp)$/i;
  function setPane(mode) {
    state.pane = (state.pane === mode) ? 'none' : mode;
    $('#rightpane').classList.toggle('hidden', state.pane === 'none');
    $('#preview-pane').classList.toggle('hidden', state.pane !== 'preview');
    $('#details-pane').classList.toggle('hidden', state.pane !== 'details');
    updatePane();
  }

  async function updatePane() {
    if (state.pane === 'none') return;
    const isPreview = state.pane === 'preview';
    const body = isPreview ? $('#preview-body') : $('#details-body');
    const sel = [...state.selection];
    if (sel.length !== 1) {
      body.innerHTML = `<div class="pv-empty">${sel.length ? '已选中多个项目' : '未选择任何项目'}</div>`;
      return;
    }
    const e = sel[0];
    const p = e.path || e.letter;
    if (!p) { body.innerHTML = '<div class="pv-empty">此项目无预览</div>'; return; }
    /* 驱动器条目没有 name/path，构造兼容视图 */
    const isDrive = e.kind === 'drive';
    const pseudo = isDrive
      ? { ...e, name: e.volume ? `${e.volume} (${e.letter})` : e.letter, isDir: true }
      : e;
    const nm = displayName(pseudo);
    const ic = isDrive ? (isSysDrive(e.letter) ? ICONS.sysdrive : ICONS.hdd) : fileIcon(pseudo);

    if (!isPreview) {
      /* 详细信息窗格 */
      const info = await window.explorer.properties(p);
      if (!info.ok) { body.innerHTML = '<div class="pv-empty">无法读取项目信息</div>'; return; }
      const rows = [
        ['修改日期', fmtDate(info.mtime)],
        ['创建日期', fmtDate(info.ctime)],
        ['类型', isDrive ? '本地磁盘' : (e.isDir ? '文件夹' : typeLabel(e))],
        ['大小', e.isDir ? `${fmtSize(info.size)}（${info.files} 个文件，${info.dirs} 个文件夹）` : fmtSize(info.size)],
        ['位置', (p.replace(/[\\/][^\\/]+$/, '') || p)]
      ];
      body.innerHTML = `<div class="dp-icon"><img src="${ic}" /></div>
        <div class="dp-name">${nm}</div>` +
        rows.map(([k, v]) => `<div class="dp-row"><span class="dp-k">${k}:</span><span class="dp-v">${v}</span></div>`).join('');
      return;
    }

    /* 预览窗格 */
    if (e.isDir || isDrive) {
      body.innerHTML = `<div class="pv-icon"><img src="${ic}" /></div><div class="pv-name">${nm}</div>`;
      return;
    }
    if (IMG_EXT.test(p)) {
      body.innerHTML = `<div class="pv-name">${nm}</div><img class="pv-img" src="file:///${p.replace(/\\/g, '/')}" />`;
      return;
    }
    const r = await window.explorer.readText(p);
    if (r && r.ok) {
      body.innerHTML = `<div class="pv-name">${nm}</div><pre class="pv-text">${escapeHtml(r.text)}${r.truncated ? '\n…' : ''}</pre>`;
    } else {
      body.innerHTML = `<div class="pv-icon"><img src="${ic}" /></div><div class="pv-name">${nm}</div><div class="pv-empty">没有可用的预览</div>`;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  /* ---------- 通用下拉菜单（添加列 / 分组依据） ---------- */
  function showDropdown(anchor, items) {
    const dd = $('#dropdown');
    dd.innerHTML = '';
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'dd-item';
      el.innerHTML = `<span class="dd-check">${it.checked ? '✔' : ''}</span><span>${it.label}</span>`;
      if (it.onclick) el.addEventListener('click', () => { hideDropdown(); it.onclick(); });
      dd.appendChild(el);
    }
    const r = anchor.getBoundingClientRect();
    dd.classList.remove('hidden');
    const h = dd.offsetHeight;
    dd.style.left = Math.min(r.left, window.innerWidth - dd.offsetWidth - 8) + 'px';
    dd.style.top = (r.bottom + h > window.innerHeight ? Math.max(4, r.top - h - 2) : r.bottom + 2) + 'px';
  }
  function hideDropdown() { $('#dropdown').classList.add('hidden'); }

  /* ---------- context menu ---------- */
  function hideContextMenu() { $('#ctxmenu').classList.add('hidden'); }

  function ctxItem(label, ic, enabled, fn) {
    const d = document.createElement('div');
    d.className = 'ctx-item' + (enabled ? '' : ' disabled');
    d.innerHTML = `<img src="${ic}" /><span>${label}</span>`;
    if (enabled) d.addEventListener('click', () => { hideContextMenu(); fn(); });
    return d;
  }
  function ctxSep() {
    const d = document.createElement('div');
    d.className = 'ctx-sep';
    return d;
  }

  function showContextMenu(x, y) {
    const menu = $('#ctxmenu');
    menu.innerHTML = '';
    const sel = [...state.selection];
    const dir = currentDir();
    const hasSel = sel.length > 0;

    if (hasSel) {
      const single = sel.length === 1 ? sel[0] : null;
      menu.appendChild(ctxItem('打开', ICONS.open, true, () => { if (single) openEntry(single); }));
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('复制', ICONS.copy, true, doCopy));
      menu.appendChild(ctxItem('剪切', ICONS.cut, true, doCut));
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('压缩 (ZIP)', ICONS.zip, !!dir, doZip));
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('删除', ICONS.del, !!dir, doDelete));
      menu.appendChild(ctxItem('重命名', ICONS.rename, !!dir && !!single, doRename));
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('属性', ICONS.props, true, showProps));
    } else {
      // blank area
      menu.appendChild(ctxItem('新建文件夹', ICONS.newfolder, !!dir, doNewFolder));
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('粘贴', ICONS.paste, !!dir && !!state.clipboard, doPaste));
      menu.appendChild(ctxItem('刷新', ICONS.refresh, true, () => navigate(state.current, { noHistory: true })));
    }

    menu.classList.remove('hidden');
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - mw - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mh - 4) + 'px';
  }

  /* ---------- file operations ---------- */
  function requireDir() {
    const dir = currentDir();
    if (!dir) { toast('此位置不支持该操作'); return null; }
    return dir;
  }
  function toast(msg) {
    // reuse properties dialog as a lightweight message box
    const ov = $('#prop-overlay');
    $('#prop-title').textContent = '提示';
    $('#prop-body').innerHTML = `<div style="padding:6px 2px">${msg}</div>`;
    ov.classList.remove('hidden');
  }

  async function refresh() {
    await navigate(state.current, { noHistory: true });
  }

  function doCopy() {
    const sel = [...state.selection];
    if (!sel.length) return;
    state.clipboard = {
      op: 'copy',
      items: sel.filter(e => e.path).map(e => ({ path: e.path, name: e.name, isDir: e.isDir }))
    };
    toast(`已复制 ${state.clipboard.items.length} 个项目`);
  }
  function doCut() {
    const dir = requireDir(); if (!dir) return;
    const sel = [...state.selection];
    if (!sel.length) return;
    state.clipboard = {
      op: 'cut',
      items: sel.filter(e => e.path).map(e => ({ path: e.path, name: e.name, isDir: e.isDir }))
    };
    toast(`已剪切 ${state.clipboard.items.length} 个项目`);
  }
  async function doPaste() {
    const dir = requireDir(); if (!dir) return;
    if (!state.clipboard || !state.clipboard.items.length) return;
    await window.explorer.paste(state.clipboard.items.map(i => i.path), dir, state.clipboard.op);
    if (state.clipboard.op === 'cut') state.clipboard = null;
    await refresh();
  }
  async function doDelete() {
    const dir = requireDir(); if (!dir) return;
    const sel = [...state.selection].filter(e => e.path);
    if (!sel.length) return;
    const names = sel.map(e => e.name).join('、');
    if (!confirm(`确定要将 "${names}" 移入回收站吗？`)) return;
    await window.explorer.trash(sel.map(e => e.path));
    state.selection.clear();
    await refresh();
  }
  async function doNewFolder() {
    const dir = requireDir(); if (!dir) return;
    const r = await window.explorer.newFolder(dir);
    if (!r.ok) { toast('新建文件夹失败：' + r.error); return; }
    await refresh();
    // inline rename the new folder
    const entry = state.entries.find(e => e.path === r.path);
    if (entry) startInlineRename(entry);
  }
  async function doRename() {
    const sel = [...state.selection];
    if (sel.length !== 1 || !sel[0].path) return;
    startInlineRename(sel[0]);
  }
  function startInlineRename(entry) {
    const el = document.querySelector(`#content [data-key="${CSS.escape(entryKey(entry))}"]`);
    if (!el) return;
    const nameEl = el.querySelector('.iname span') || el.querySelector('.dname span') || el.querySelector('.iname') || el.querySelector('.dname');
    if (!nameEl) return;
    const box = $('#rename-box');
    const rect = nameEl.getBoundingClientRect();
    box.value = entry.name;
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = Math.max(rect.width, 120) + 'px';
    box.style.height = rect.height + 'px';
    box.classList.remove('hidden');
    const dot = entry.name.lastIndexOf('.');
    box.setSelectionRange(0, (entry.isDir || dot <= 0) ? entry.name.length : dot);
    box.focus();

    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      box.classList.add('hidden');
      const newName = box.value.trim();
      if (!newName || newName === entry.name) return;
      const r = await window.explorer.rename(entry.path, newName);
      if (!r.ok) { toast('重命名失败：' + r.error); return; }
      await refresh();
    };
    box.addEventListener('keydown', function h(e) {
      if (e.key === 'Enter') { box.removeEventListener('keydown', h); commit(); }
      else if (e.key === 'Escape') { done = true; box.classList.add('hidden'); }
    });
    box.addEventListener('blur', function h() { box.removeEventListener('blur', h); commit(); }, { once: true });
  }
  async function doZip() {
    const dir = requireDir(); if (!dir) return;
    const sel = [...state.selection].filter(e => e.path);
    if (!sel.length) return;
    const r = await window.explorer.zip(sel.map(e => e.path), dir);
    if (!r.ok) { toast('压缩失败：' + r.error); return; }
    await refresh();
  }
  async function showProps() {
    const sel = [...state.selection];
    if (!sel.length) {
      const dir = currentDir();
      if (dir) await showPropsFor(dir);
      else toast('没有可显示属性的项目');
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const p = e.path || e.letter;
      await showPropsFor(p);
    } else {
      const ov = $('#prop-overlay');
      $('#prop-title').textContent = `${sel.length} 个项目的属性`;
      $('#prop-body').innerHTML = `<div class="prow"><span class="pk">项目类型:</span><span class="pv">${sel.length} 个文件/文件夹</span></div>`;
      ov.classList.remove('hidden');
    }
  }
  async function showPropsFor(p) {
    const r = await window.explorer.properties(p);
    const ov = $('#prop-overlay');
    if (!r.ok) {
      $('#prop-title').textContent = '属性';
      $('#prop-body').innerHTML = `<div>无法读取属性：${r.error}</div>`;
      ov.classList.remove('hidden');
      return;
    }
    $('#prop-title').textContent = r.name + ' 属性';
    $('#prop-body').innerHTML = `
      <div class="prow"><span class="pk">名称:</span><span class="pv">${r.name}</span></div>
      <div class="prow"><span class="pk">类型:</span><span class="pv">${r.isDir ? '文件夹' : (EXT_NAMES[extOf(r.name).toLowerCase()] || '文件')}</span></div>
      <div class="prow"><span class="pk">大小:</span><span class="pv">${fmtSize(r.size)}${r.isDir ? `（包含 ${r.files} 个文件，${r.dirs} 个文件夹）` : ''}</span></div>
      <div class="prow"><span class="pk">修改时间:</span><span class="pv">${fmtDate(r.mtime)}</span></div>
      <div class="prow"><span class="pk">创建时间:</span><span class="pv">${fmtDate(r.ctime)}</span></div>
      <div class="prow"><span class="pk">位置:</span><span class="pv">${p}</span></div>`;
    ov.classList.remove('hidden');
  }

  /* ---------- nav history ---------- */
  function updateNavButtons() {
    $('#btn-back').disabled = state.hIndex <= 0;
    $('#btn-forward').disabled = state.hIndex >= state.history.length - 1;
  }
  function goBack() { if (state.hIndex > 0) { state.hIndex--; navigate(state.history[state.hIndex], { noHistory: true }); } }
  function goForward() { if (state.hIndex < state.history.length - 1) { state.hIndex++; navigate(state.history[state.hIndex], { noHistory: true }); } }
  function goUp() {
    const cur = state.current;
    if (!cur) return;
    if (cur.kind === 'root') return;
    if (cur.kind === 'special') { navigate({ kind: 'root', title: '此电脑' }); return; }
    const parent = path.parent(cur.path.replace(/\\/g, '/'));
    if (parent == null) { navigate({ kind: 'root', title: '此电脑' }); return; }
    if (/^[a-zA-Z]:$/.test(parent)) {
      navigate({ kind: 'dir', path: parent + '/', title: parent + '\\' });
    } else if (parent === '' || parent === '/') {
      navigate({ kind: 'root', title: '此电脑' });
    } else {
      navigate({ kind: 'dir', path: parent, title: path.basename(parent) });
    }
  }

  /* ---------- ribbon ---------- */
  function initRibbon() {
    const tabs = document.querySelectorAll('.rtab');
    const panels = document.querySelectorAll('.rpanel');
    const setTab = (name) => {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      panels.forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    };
    tabs.forEach(t => t.addEventListener('click', () => {
      setTab(t.dataset.tab);
      /* 折叠态：点选项卡以浮层弹出功能区 */
      if (state.ribbonCollapsed) $('#ribbon-body').classList.add('popup');
    }));
    setTab('chakan');

    /* --- 功能区折叠/展开（右上角箭头） --- */
    const rbCollapse = $('#ribbon-collapse');
    rbCollapse.addEventListener('click', () => {
      state.ribbonCollapsed = !state.ribbonCollapsed;
      $('#ribbon').classList.toggle('collapsed', state.ribbonCollapsed);
      $('#ribbon-body').classList.remove('popup');
      rbCollapse.innerHTML = state.ribbonCollapsed ? '&#x2228;' : '&#x2227;';
      rbCollapse.title = state.ribbonCollapsed ? '展开功能区' : '收拢功能区（点击可展开）';
    });
    /* 点击功能区以外区域 → 收起弹出层 */
    document.addEventListener('click', (e) => {
      if (state.ribbonCollapsed && $('#ribbon-body').classList.contains('popup')) {
        if (!$('#ribbon').contains(e.target)) $('#ribbon-body').classList.remove('popup');
      }
    });
    /* 折叠态执行命令后自动收起 */
    $('#ribbon-body').addEventListener('click', (e) => {
      if (state.ribbonCollapsed && e.target.closest('.rcmd')) {
        setTimeout(() => $('#ribbon-body').classList.remove('popup'), 150);
      }
    });

    /* --- 查看 --- */
    document.querySelectorAll('.vopt').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.vopt').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.view = b.dataset.view;
      renderContent();
      $('#sb-details').classList.toggle('active', state.view === 'details');
      $('#sb-large').classList.toggle('active', state.view !== 'details');
    }));
    $('#cmd-navpane').addEventListener('click', () => {
      state.navPaneVisible = !state.navPaneVisible;
      $('#sidebar').classList.toggle('hidden', !state.navPaneVisible);
    });
    $('#chk-checks').addEventListener('change', (e) => {
      state.showChecks = e.target.checked;
      $('#content').classList.toggle('show-checks', state.showChecks);
    });
    /* --- 窗格：预览 / 详细信息 --- */
    $('#cmd-prevpane').addEventListener('click', () => setPane('preview'));
    $('#cmd-detpane').addEventListener('click', () => setPane('details'));
    $('#cmd-sort').addEventListener('click', () => {
      const order = ['name', 'mtime', 'type', 'size'];
      const i = order.indexOf(state.sortKey);
      state.sortKey = order[(i + 1) % order.length];
      renderContent();
    });
    $('#cmd-group').addEventListener('click', (ev) => {
      ev.stopPropagation();
      showDropdown(ev.currentTarget, [
        { label: '无', checked: state.groupBy === 'none', onclick: () => { state.groupBy = 'none'; renderContent(); } },
        { label: '名称', checked: state.groupBy === 'name', onclick: () => { state.groupBy = 'name'; renderContent(); } },
        { label: '类型', checked: state.groupBy === 'type', onclick: () => { state.groupBy = 'type'; renderContent(); } },
        { label: '大小', checked: state.groupBy === 'size', onclick: () => { state.groupBy = 'size'; renderContent(); } },
        { label: '修改日期', checked: state.groupBy === 'mtime', onclick: () => { state.groupBy = 'mtime'; renderContent(); } }
      ]);
    });
    $('#cmd-addcol').addEventListener('click', (ev) => {
      ev.stopPropagation();
      showDropdown(ev.currentTarget, [
        { label: '名称（始终显示）', checked: true, onclick: null },
        { label: '修改日期', checked: state.columns.mtime, onclick: () => { state.columns.mtime = !state.columns.mtime; renderContent(); } },
        { label: '类型', checked: state.columns.type, onclick: () => { state.columns.type = !state.columns.type; renderContent(); } },
        { label: '大小', checked: state.columns.size, onclick: () => { state.columns.size = !state.columns.size; renderContent(); } }
      ]);
    });
    $('#cmd-fitcol').addEventListener('click', () => {
      state.autoFit = true;
      renderContent();
      state.autoFit = false;
    });
    $('#cmd-foptions').addEventListener('click', async () => {
      const r = await window.explorer.sysOpen('folders');
      if (r && r.ok === false) toast(r.error || '无法打开文件夹选项');
    });
    $('#chk-ext').addEventListener('change', (e) => { state.showExt = e.target.checked; renderContent(); });
    $('#chk-hidden').addEventListener('change', async (e) => {
      state.showHidden = e.target.checked;
      await refresh();
    });

    /* --- 文件 --- */
    $('#cmd-props1').addEventListener('click', showProps);
    $('#cmd-props2').addEventListener('click', showProps);
    $('#cmd-open1').addEventListener('click', () => {
      const sel = [...state.selection];
      if (sel.length === 1) openEntry(sel[0]);
      else toast('请先选择一个项目');
    });
    $('#cmd-rename1').addEventListener('click', doRename);
    $('#cmd-newfolder').addEventListener('click', doNewFolder);
    $('#cmd-newfolder2').addEventListener('click', doNewFolder);
    $('#cmd-settings1').addEventListener('click', () => window.explorer.sysOpen('settings'));
    $('#cmd-settings2').addEventListener('click', () => window.explorer.sysOpen('settings'));

    /* --- 主页：剪贴板 / 组织 / 新建 / 打开 / 选择 --- */
    $('#cmd-copy').addEventListener('click', doCopy);
    $('#cmd-cut').addEventListener('click', doCut);
    $('#cmd-paste').addEventListener('click', doPaste);
    $('#cmd-delete').addEventListener('click', doDelete);
    $('#cmd-rename2').addEventListener('click', doRename);
    /* 剪贴板组 */
    $('#cmd-pin').addEventListener('click', () => {
      const sel = [...state.selection].filter(e => e.path && e.isDir);
      if (!sel.length) { toast('请先选择一个文件夹'); return; }
      const pins = getPins();
      let added = 0;
      for (const e of sel) {
        if (!pins.some(x => x.path === e.path)) { pins.unshift({ path: e.path, name: e.name }); added++; }
      }
      savePins(pins);
      buildSidebar();
      toast(added ? `已固定 ${added} 个文件夹到快速访问` : '所选文件夹已在快速访问中');
    });
    $('#cmd-copypath').addEventListener('click', async () => {
      const sel = [...state.selection].filter(e => e.path);
      if (!sel.length) { toast('请先选择项目'); return; }
      const r = await window.explorer.copyText(sel.map(e => e.path).join('\n'));
      toast(r.ok ? `已复制 ${sel.length} 个路径` : '复制失败：' + r.error);
    });
    $('#cmd-pasteshort').addEventListener('click', async () => {
      const dir = requireDir(); if (!dir) return;
      if (!state.clipboard || !state.clipboard.items.length) { toast('剪贴板为空'); return; }
      const r = await window.explorer.mkShortcut(state.clipboard.items.map(i => i.path), dir);
      if (r.some(x => !x.ok)) toast('部分快捷方式创建失败');
      await refresh();
    });
    /* 组织组：移动到 / 复制到（选择目标文件夹对话框） */
    const moveToCopyTo = async (op) => {
      const sel = [...state.selection].filter(e => e.path);
      if (!sel.length) { toast('请先选择项目'); return; }
      const r = await window.explorer.pickDir(op === 'cut' ? '移动到…' : '复制到…');
      if (!r.ok || !r.path) return;
      await window.explorer.paste(sel.map(e => e.path), r.path, op);
      await refresh();
    };
    $('#cmd-moveto').addEventListener('click', () => moveToCopyTo('cut'));
    $('#cmd-copyto').addEventListener('click', () => moveToCopyTo('copy'));
    /* 新建组 */
    $('#cmd-newitem').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const dir = requireDir(); if (!dir) return;
      showDropdown(ev.currentTarget, [
        { label: '文件夹', onclick: doNewFolder },
        { label: '文本文档', onclick: async () => {
          const r = await window.explorer.newFile(dir, '新建文本文档.txt');
          if (!r.ok) { toast('新建失败：' + r.error); return; }
          await refresh();
          const entry = state.entries.find(e => e.path === r.path);
          if (entry) startInlineRename(entry);
        } },
        { label: 'ZIP 压缩文件（压缩所选项目）', onclick: doZip }
      ]);
    });
    $('#cmd-easy').addEventListener('click', (ev) => {
      ev.stopPropagation();
      showDropdown(ev.currentTarget, [
        { label: '桌面快捷方式', onclick: async () => {
          const sel = [...state.selection].filter(e => e.path);
          if (!sel.length) { toast('请先选择项目'); return; }
          const r = await window.explorer.mkShortcut(sel.map(e => e.path), state.paths.desktop);
          if (r.some(x => !x.ok)) toast('部分快捷方式创建失败');
          else toast('已在桌面创建快捷方式');
        } }
      ]);
    });
    /* 打开组 */
    const doEditSel = async () => {
      const sel = [...state.selection].filter(e => e.path && !e.isDir);
      if (!sel.length) { toast('请选择一个文件'); return; }
      await window.explorer.editFile(sel[0].path);
    };
    $('#cmd-open2').addEventListener('click', (ev) => {
      ev.stopPropagation();
      showDropdown(ev.currentTarget, [
        { label: '打开', onclick: () => {
          const sel = [...state.selection];
          if (sel.length === 1) openEntry(sel[0]); else toast('请先选择一个项目');
        } },
        { label: '编辑', onclick: doEditSel },
        { label: '属性', onclick: showProps }
      ]);
    });
    $('#cmd-edit').addEventListener('click', doEditSel);
    $('#cmd-history').addEventListener('click', async () => {
      const r = await window.explorer.sysOpen('filehistory');
      if (r && r.ok === false) toast(r.error || '无法打开文件历史记录');
    });
    /* 选择组 */
    $('#cmd-selall').addEventListener('click', () => {
      state.selection.clear();
      getVisible().forEach(x => state.selection.add(x));
      refreshSelectionUI(); updateStatus();
    });
    $('#cmd-selnone').addEventListener('click', () => {
      state.selection.clear();
      refreshSelectionUI(); updateStatus();
    });
    $('#cmd-selinvert').addEventListener('click', () => {
      for (const x of getVisible()) {
        if (state.selection.has(x)) state.selection.delete(x); else state.selection.add(x);
      }
      refreshSelectionUI(); updateStatus();
    });

    /* --- 计算机 --- */
    $('#cmd-sysdm').addEventListener('click', () => window.explorer.sysOpen('sysdm'));
    $('#cmd-appwiz').addEventListener('click', () => window.explorer.sysOpen('appwiz'));
    $('#cmd-mgmt').addEventListener('click', () => window.explorer.sysOpen('mgmt'));
    $('#cmd-mapnet').addEventListener('click', () => toast('映射网络驱动器（此系统暂不支持）'));
    $('#cmd-addnet').addEventListener('click', () => toast('添加一个网络位置（此系统暂不支持）'));

    /* --- 共享 --- */
    $('#cmd-share').addEventListener('click', () => toast('共享（此系统暂不支持）'));
    $('#cmd-email').addEventListener('click', () => toast('电子邮件（请配置系统邮件客户端）'));
    $('#cmd-zip').addEventListener('click', doZip);
    $('#cmd-sec').addEventListener('click', () => toast('高级安全（此系统暂不支持）'));
  }

  /* ---------- status bar view toggles ---------- */
  function initStatusToggles() {
    $('#sb-details').addEventListener('click', () => {
      state.view = 'details';
      document.querySelectorAll('.vopt').forEach(x => x.classList.toggle('active', x.dataset.view === 'details'));
      $('#sb-details').classList.add('active'); $('#sb-large').classList.remove('active');
      renderContent();
    });
    $('#sb-large').addEventListener('click', () => {
      state.view = 'large';
      document.querySelectorAll('.vopt').forEach(x => x.classList.toggle('active', x.dataset.view === 'large'));
      $('#sb-large').classList.add('active'); $('#sb-details').classList.remove('active');
      renderContent();
    });
  }

  /* ---------- init ---------- */
  function setupIconFallback() {
    const fallback = ICONS.file;
    document.body.addEventListener('error', (ev) => {
      const t = ev.target;
      if (t && t.tagName === 'IMG' && t.src.indexOf(fallback) < 0) t.src = fallback;
    }, true);
  }

  async function init() {
    setupIconFallback();
    state.platform = await window.explorer.platform();
    state.home = await window.explorer.home();
    state.paths = await window.explorer.homePaths();
    if (state.platform === 'win32') {
      sysDriveLetter = (state.home[0] || 'C') + ':';
    }

    // titlebar
    $('#app-icon').src = ICONS.pc;
    $('#btn-min').addEventListener('click', () => window.explorer.winMin());
    $('#btn-max').addEventListener('click', () => window.explorer.winMax());
    $('#btn-close').addEventListener('click', () => window.explorer.winClose());
    window.explorer.isMaximized().then(m => { if (m) $('#btn-max').textContent = '❐'; });
    if (state.platform === 'darwin') $('#btn-max').title = '进入全屏';

    // navbar
    $('#btn-back').addEventListener('click', goBack);
    $('#btn-forward').addEventListener('click', goForward);
    $('#btn-up').addEventListener('click', goUp);
    $('#btn-refresh').addEventListener('click', () => navigate(state.current, { noHistory: true }));

    // editable address bar
    $('#breadcrumb').addEventListener('click', (ev) => {
      if (ev.target.closest('.crumb')) return;
      enterAddrEdit();
    });
    const addrInp = $('#addr-input');
    addrInp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commitAddrEdit();
      else if (e.key === 'Escape') exitAddrEdit();
    });
    addrInp.addEventListener('blur', () => exitAddrEdit());

    $('#search-input').addEventListener('input', (e) => {
      state.search = e.target.value;
      applyFilter();
      renderContent();
    });

    // global: hide context menu / dropdown on click elsewhere
    document.addEventListener('click', () => { hideContextMenu(); hideDropdown(); });
    document.addEventListener('contextmenu', (ev) => {
      // blank/other areas -> default hide (content area has its own handler)
      if (!ev.target.closest('#content') && !ev.target.closest('#ctxmenu')) {
        ev.preventDefault();
        hideContextMenu();
        hideDropdown();
      }
    });
    // blank-area context menu inside content (registered once)
    $('#content').addEventListener('contextmenu', onBlankContextMenu);
    $('#prop-ok').addEventListener('click', () => $('#prop-overlay').classList.add('hidden'));
    $('#prop-overlay').addEventListener('click', (e) => {
      if (e.target === $('#prop-overlay')) $('#prop-overlay').classList.add('hidden');
    });

    initRibbon();
    initStatusToggles();

    await buildSidebar();
    await navigate({ kind: 'root', title: '此电脑' });
    console.log('INIT DONE, title=' + document.title + ' entries=' + state.entries.length);
    window.explorer.drives().then(d => console.log('DRIVES: ' + d.map(x => x.letter + (x.volume ? '(' + x.volume + ')' : '')).join(', ')));

    // keyboard
    document.addEventListener('keydown', (e) => {
      const inInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      if (e.key === 'F5') { e.preventDefault(); navigate(state.current, { noHistory: true }); }
      if (e.key === 'Backspace' && !inInput) goUp();
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); goUp(); }
      if (e.key === 'Enter' && state.selection.size === 1 && !inInput) openEntry([...state.selection][0]);
      if (e.key === 'Delete' && !inInput) doDelete();
      if (e.key === 'F2' && !inInput) doRename();
      /* mac 上 Cmd 等价于 win/linux 的 Ctrl */
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !inInput) {
        if (e.key === 'c' || e.key === 'C') doCopy();
        else if (e.key === 'x' || e.key === 'X') doCut();
        else if (e.key === 'v' || e.key === 'V') doPaste();
        else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          state.selection.clear();
          getVisible().forEach(x => state.selection.add(x));
          refreshSelectionUI();
          updateStatus();
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
