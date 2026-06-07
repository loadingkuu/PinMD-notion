'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const notion = require('./notion');

let win;
let tray;
let locked = false;    // 完全锁定：锁位置/大小 + 鼠标穿透 + 置底 + 降低存在感
let posLocked = false; // 仅锁定位置/大小（窗口仍可正常操作）
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'tray.png');

// ---- 配置存在 userData/config.json ----
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
const DEFAULTS = { token: '', pageId: '', binPageId: '', pinned: [], opacity: 0.62, fontSize: 14, fontFamily: '', autostart: false, alwaysOnTop: true };
function loadConfig() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}
function saveConfig(patch) {
  const cfg = Object.assign(loadConfig(), patch);
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}
function applyAutostart(on) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on });
  } catch (e) {}
}

// ---- 窗口位置/大小记忆 ----
function boundsPath() {
  return path.join(app.getPath('userData'), 'window.json');
}
function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}
function saveBounds() {
  if (!win) return;
  try {
    fs.writeFileSync(boundsPath(), JSON.stringify(win.getBounds()), 'utf8');
  } catch (e) {}
}

// 判断保存的窗口矩形是否仍落在某个显示器可见区域内（避免开在屏幕外看不到）
function isVisibleOnScreen(b) {
  if (!b || b.x == null || b.y == null) return false;
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const visX = b.x + b.width - 40 > wa.x && b.x + 40 < wa.x + wa.width;
    const visY = b.y + 20 > wa.y && b.y + 20 < wa.y + wa.height;
    return visX && visY;
  });
}

function createWindow() {
  let saved = loadBounds();
  if (saved && !isVisibleOnScreen(saved)) saved = { width: saved.width, height: saved.height };
  const onTop = loadConfig().alwaysOnTop !== false;
  win = new BrowserWindow({
    width: (saved && saved.width) || 360,
    height: (saved && saved.height) || 520,
    x: saved && saved.x,
    y: saved && saved.y,
    minWidth: 150,
    minHeight: 90,
    minimizable: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: onTop,
    skipTaskbar: true,
    hasShadow: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (onTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.setSkipTaskbar(true);
  win.on('show', () => win.setSkipTaskbar(true));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  let t;
  const persist = () => { clearTimeout(t); t = setTimeout(saveBounds, 400); };
  win.on('move', persist);
  win.on('resize', persist);
  win.on('close', saveBounds);

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else { win.show(); win.restore(); if (!locked) win.focus(); }
}

// 是否禁止移动/缩放：完全锁定或仅锁位置任一开启即禁止
function applyMovable() {
  if (!win) return;
  const lockMove = locked || posLocked;
  win.setMovable(!lockMove);
  win.setResizable(!lockMove);
}

// 完全锁定：锁位置大小 + 鼠标穿透 + best-effort 置底 + 降低存在感
function applyLock(on) {
  locked = !!on;
  if (win) {
    win.setIgnoreMouseEvents(locked, { forward: true }); // 鼠标穿透
    win.setFocusable(!locked);                            // 不抢焦点 → 近似置底
    if (locked) {
      win.setAlwaysOnTop(false);
      win.setOpacity(0.6); // 降低存在感
      win.blur();
    } else {
      win.setOpacity(1);
      const onTop = loadConfig().alwaysOnTop !== false;
      win.setAlwaysOnTop(onTop, 'screen-saver');
    }
    applyMovable();
    if (win.webContents) win.webContents.send('win:lock', locked);
  }
  refreshTrayMenu();
}

// 仅锁定位置/大小：窗口仍可正常点击操作
function applyPosLock(on) {
  posLocked = !!on;
  applyMovable();
  if (win && win.webContents) win.webContents.send('win:poslock', posLocked);
  refreshTrayMenu();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggleWindow },
    { label: posLocked ? '解锁位置' : '锁定位置', click: () => applyPosLock(!posLocked) },
    { label: locked ? '解除完全锁定  (Ctrl+Alt+L)' : '完全锁定  (Ctrl+Alt+L)', click: () => applyLock(!locked) },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function refreshTrayMenu() { if (tray) tray.setContextMenu(buildTrayMenu()); }

function createTray() {
  let img = nativeImage.createFromPath(TRAY_ICON);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Notion 待办悬浮窗');
  tray.setContextMenu(buildTrayMenu());
  // 锁定时单击托盘 = 解锁（穿透状态下唯一的鼠标解锁入口）
  tray.on('click', () => { if (locked) applyLock(false); else toggleWindow(); });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  // 全局快捷键：锁定/解锁（穿透时也能用，是键盘解锁入口）
  try { globalShortcut.register('CommandOrControl+Alt+L', () => applyLock(!locked)); } catch (e) {}
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.on('window-all-closed', () => {});

// ---- IPC ----
function creds() {
  const c = loadConfig();
  if (!c.token || !c.pageId) throw new Error('NO_CREDENTIALS');
  return c;
}

// 若回收站子页面被自动创建，回写其 id
function persistBin(result) {
  if (result && result.binPageId && result.binPageId !== loadConfig().binPageId) {
    saveConfig({ binPageId: result.binPageId });
  }
  return result;
}

ipcMain.handle('app:version', () => app.getVersion());

// 列出系统已安装字体（PowerShell 读取，结果缓存）
let cachedFonts = null;
function listSystemFonts() {
  return new Promise((resolve) => {
    if (cachedFonts) return resolve(cachedFonts);
    const ps = 'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const fonts = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        cachedFonts = [...new Set(fonts)].sort((a, b) => a.localeCompare(b, 'zh'));
        resolve(cachedFonts);
      });
  });
}
ipcMain.handle('app:fonts', () => listSystemFonts());
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, patch) => {
  const clean = {};
  if (patch.token != null) clean.token = String(patch.token).trim();
  if (patch.pageId != null) clean.pageId = normalizeId(patch.pageId);
  if (patch.opacity != null) clean.opacity = Number(patch.opacity);
  if (patch.fontSize != null) clean.fontSize = Number(patch.fontSize);
  if (patch.fontFamily != null) clean.fontFamily = String(patch.fontFamily);
  if (patch.autostart != null) {
    clean.autostart = !!patch.autostart;
    applyAutostart(clean.autostart);
  }
  // 改了 token 或主页面，旧的回收站 id 与本地置顶都作废
  if (clean.token != null || clean.pageId != null) { clean.binPageId = ''; clean.pinned = []; }
  return saveConfig(clean);
});

// 把页面 URL 或带连字符的 id 归一化成 32 位无连字符 id（API 两种都接受，统一存储）
function normalizeId(input) {
  let s = String(input).trim();
  const m = s.match(/[0-9a-fA-F]{32}/) || s.replace(/-/g, '').match(/[0-9a-fA-F]{32}/);
  if (m) return m[0];
  // 形如 ...-xxxxxxxx（末尾 32 hex 带连字符）
  const hex = s.replace(/[^0-9a-fA-F]/g, '');
  return hex.length >= 32 ? hex.slice(-32) : s;
}

// 校验 token + 主页面是否可用
ipcMain.handle('notion:verify', (_e, { token, pageId }) =>
  notion.verify({ token: String(token).trim(), pageId: normalizeId(pageId) }));

// 本地置顶：仅存在本机配置，不写回 Notion
ipcMain.handle('notes:pin', (_e, { id, on }) => {
  const set = new Set(loadConfig().pinned || []);
  if (on) set.add(id); else set.delete(id);
  return saveConfig({ pinned: [...set] }).pinned;
});

ipcMain.handle('notes:list', () => notion.listTodos(creds()));
ipcMain.handle('notes:add', (_e, text) => notion.addTodo(creds(), text));
ipcMain.handle('notes:update', (_e, { id, text }) => notion.updateTodo(creds(), id, text));
ipcMain.handle('notes:checked', (_e, { id, on }) => notion.setChecked(creds(), id, on));
// 勾选完成 = 挪进回收站
ipcMain.handle('notes:complete', async (_e, id) => persistBin(await notion.moveToBin(creds(), id)).notes);

// 回收站
ipcMain.handle('trash:list', async () => persistBin(await notion.listBin(creds())).notes);
ipcMain.handle('trash:restore', async (_e, id) => persistBin(await notion.restoreFromBin(creds(), id)).notes);
ipcMain.handle('trash:purge', async (_e, id) => persistBin(await notion.purgeFromBin(creds(), id)).notes);

// 窗口控制
ipcMain.handle('win:close', () => win && win.hide());
ipcMain.handle('win:minimize', () => win && win.hide());
ipcMain.handle('win:pin', (_e, on) => {
  if (win) win.setAlwaysOnTop(!!on, 'screen-saver');
  saveConfig({ alwaysOnTop: !!on });
  return !!on;
});
ipcMain.handle('win:lock', (_e, on) => { applyLock(on == null ? !locked : !!on); return locked; });
ipcMain.handle('win:locked', () => locked);
ipcMain.handle('win:poslock', (_e, on) => { applyPosLock(on == null ? !posLocked : !!on); return posLocked; });
ipcMain.handle('win:poslocked', () => posLocked);

// 空白处自定义拖动窗口：按光标“位移差”移动，并锁死宽高快照，绝不改变窗口大小
let dragLast = null; // 上一次光标屏幕坐标
let dragSize = null; // 拖动开始时的宽高快照
ipcMain.on('win:drag-start', () => {
  if (locked || posLocked || !win) { dragLast = null; return; }
  dragLast = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragSize = { width: b.width, height: b.height };
});
ipcMain.on('win:drag-move', () => {
  if (!dragLast || !dragSize || !win || locked || posLocked) return;
  const c = screen.getCursorScreenPoint();
  const dx = c.x - dragLast.x, dy = c.y - dragLast.y;
  if (dx === 0 && dy === 0) return;
  const b = win.getBounds();
  win.setBounds({ x: b.x + dx, y: b.y + dy, width: dragSize.width, height: dragSize.height });
  dragLast = c;
});
ipcMain.on('win:drag-end', () => { dragLast = null; dragSize = null; });
