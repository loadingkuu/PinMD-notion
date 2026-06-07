'use strict';
const $ = (id) => document.getElementById(id);

const listEl = $('list');
const statusEl = $('status');
const settingsEl = $('settings');

let notesCache = [];
let pinnedSet = new Set(); // 本地置顶的块 ID

// 置顶项排到前面，组内保持原顺序
function sortNotes(notes) {
  const pinned = [], rest = [];
  for (const n of notes) (pinnedSet.has(n.id) ? pinned : rest).push(n);
  return [...pinned, ...rest];
}

function setStatus(msg, isErr) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('err', !!isErr);
}

function applyOpacity(pct) {
  document.documentElement.style.setProperty('--bg-alpha', (pct / 100).toFixed(2));
}

function quoteFamily(f) {
  const name = String(f || '').replace(/['"]/g, '').trim();
  return name ? `"${name}"` : '';
}
function applyFont(cfg) {
  document.documentElement.style.setProperty('--font-size', (cfg.fontSize || 14) + 'px');
  const q = quoteFamily(cfg.fontFamily);
  document.body.style.fontFamily = q ? `${q}, "Microsoft YaHei", system-ui, sans-serif` : '';
}

// 后台执行写操作：界面已乐观更新，这里只管同步与失败回滚
let pending = 0; // 进行中的写操作数；>0 时暂停自动刷新，避免覆盖乐观结果
function runBg(promise, onOk, onErr) {
  pending++;
  Promise.resolve(promise)
    .then((res) => { if (onOk) onOk(res); })
    .catch((e) => { if (onErr) onErr(e); else handleErr(e); })
    .finally(() => { pending = Math.max(0, pending - 1); });
}

// ---------- 渲染 ----------
function render(notes) {
  notesCache = sortNotes(notes || []);
  listEl.innerHTML = '';
  if (notesCache.length === 0) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '没有待办，双击空白处添加～';
    listEl.appendChild(d);
    return;
  }
  notesCache.forEach((n) => listEl.appendChild(makeCard(n)));
}

function makeCard(n) {
  const card = document.createElement('div');
  card.className = 'card' + (pinnedSet.has(n.id) ? ' pinned' : '');

  // 勾选框：勾选 = 完成 → 挪进回收站
  const chk = document.createElement('button');
  chk.className = 'check';
  chk.title = '完成（移入回收站）';
  chk.addEventListener('click', () => {
    chk.classList.add('on');
    chk.textContent = '✓';
    card.classList.add('done');
    completeNote(n);
  });
  card.appendChild(chk);

  const text = document.createElement('div');
  text.className = 'card-text';
  text.textContent = (n.text && n.text.trim()) || '(空)';
  text.addEventListener('dblclick', () => startEdit(card, n));
  card.appendChild(text);

  // 置顶星标（本地）
  const acts = document.createElement('div');
  acts.className = 'acts';
  const pin = document.createElement('button');
  const on = pinnedSet.has(n.id);
  pin.className = 'act pin' + (on ? ' on' : '');
  pin.textContent = '★';
  pin.title = on ? '取消置顶' : '置顶';
  pin.addEventListener('click', () => togglePin(n));
  acts.appendChild(pin);
  card.appendChild(acts);

  return card;
}

function togglePin(note) {
  const on = !pinnedSet.has(note.id);
  // 乐观：立刻切换并重排
  if (on) pinnedSet.add(note.id); else pinnedSet.delete(note.id);
  render(notesCache);
  runBg(window.api.pin(note.id, on),
    (pinned) => { pinnedSet = new Set(pinned); },
    (e) => { handleErr(e); refresh(); });
}

// ---------- 增删改 ----------
async function refresh() {
  try {
    setStatus('加载中…');
    const notes = await window.api.listNotes();
    render(notes);
    setStatus(`共 ${notes.length} 条 · ${new Date().toLocaleTimeString()}`);
  } catch (e) { handleErr(e); }
}

function addNote(text) {
  text = (text || '').trim();
  if (!text) return;
  // 乐观：立刻在末尾插入一条临时项（待后台返回真实 ID 后对齐）
  const temp = { id: 'temp-' + Date.now(), text };
  render([...notesCache, temp]);
  setStatus('已添加（同步中…）');
  runBg(window.api.addNote(text),
    (notes) => { render(notes); setStatus(`已添加 · 共 ${notes.length} 条`); },
    (e) => { handleErr(e); refresh(); });
}

function completeNote(note) {
  // 乐观：立刻从列表移除。成功后不再用服务器数据覆盖（Notion 写后读可能返回旧数据）
  render(notesCache.filter((n) => n.id !== note.id));
  setStatus('已完成（同步中…）');
  runBg(window.api.complete(note.id),
    () => { setStatus('已完成'); },
    (e) => { handleErr(e); refresh(); });
}

function startEdit(card, note) {
  if (card.querySelector('textarea')) return;
  const original = note.text || '';
  card.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'card-edit';
  ta.value = original;
  card.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const text = ta.value.trim();
    if (text === original.trim() || text === '') { render(notesCache); return; }
    // 乐观：立刻更新文本并重渲染（note 是 notesCache 中的同一引用）
    note.text = text;
    render(notesCache);
    setStatus('已保存（同步中…）');
    // 成功后不再用服务器数据覆盖（Notion 写后读可能返回旧数据，会把刚改的内容盖回去）
    runBg(window.api.updateNote(note.id, text),
      () => { setStatus('已保存'); },
      (e) => { handleErr(e); refresh(); });
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    if (e.key === 'Escape') { done = true; refresh(); }
  });
}

// 空白处双击 → 顶部插入可编辑的新待办
function startNewInline() {
  if (listEl.querySelector('.card.new')) return;
  const empty = listEl.querySelector('.empty');
  if (empty) empty.remove();
  const card = document.createElement('div');
  card.className = 'card new';
  const ta = document.createElement('textarea');
  ta.className = 'card-edit';
  ta.placeholder = '输入待办内容，回车保存，Esc 取消';
  card.appendChild(ta);
  listEl.prepend(card);
  ta.focus();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const text = ta.value.trim();
    if (!text) { refresh(); return; }
    await addNote(text);
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    if (e.key === 'Escape') { done = true; refresh(); }
  });
}

function handleErr(e) {
  const msg = String((e && e.message) || e);
  if (msg.includes('NO_CREDENTIALS')) {
    setStatus('请先在设置里连接 Notion', true);
    openSettings();
  } else if (/unauthor|token|401/i.test(msg)) {
    setStatus('Token 无效或已失效，请在设置里重新连接', true);
    openSettings();
  } else {
    setStatus('出错: ' + msg, true);
  }
}

// ---------- 回收站 ----------
const trashEl = $('trash');
const trashListEl = $('trash-list');
const trashStatusEl = $('trash-status');

function setTrashStatus(msg, isErr) {
  trashStatusEl.textContent = msg || '';
  trashStatusEl.classList.toggle('err', !!isErr);
}

let trashCache = [];
function renderTrash(notes) {
  trashCache = notes || [];
  trashListEl.innerHTML = '';
  if (!notes || notes.length === 0) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '回收站是空的';
    trashListEl.appendChild(d);
    return;
  }
  notes.forEach((n) => trashListEl.appendChild(makeTrashCard(n)));
}

function makeTrashCard(n) {
  const card = document.createElement('div');
  card.className = 'card';

  const text = document.createElement('div');
  text.className = 'card-text';
  text.textContent = (n.text && n.text.trim()) || '(空)';
  card.appendChild(text);

  const acts = document.createElement('div');
  acts.className = 'acts';

  const restore = document.createElement('button');
  restore.className = 'act';
  restore.textContent = '↩';
  restore.title = '还原';
  restore.addEventListener('click', () => restoreFromTrash(n));
  acts.appendChild(restore);

  const purge = document.createElement('button');
  purge.className = 'act purge';
  purge.textContent = '✕';
  purge.title = '彻底删除';
  purge.addEventListener('click', () => purgeFromTrash(n));
  acts.appendChild(purge);

  card.appendChild(acts);
  return card;
}

async function openTrash() {
  trashEl.classList.remove('hidden');
  setTrashStatus('加载中…');
  try {
    const notes = await window.api.listTrash();
    renderTrash(notes);
    setTrashStatus(`共 ${notes.length} 条`);
  } catch (e) {
    setTrashStatus('出错: ' + String((e && e.message) || e), true);
  }
}
function closeTrash() { trashEl.classList.add('hidden'); }

function restoreFromTrash(note) {
  // 乐观：立刻从回收站移除
  renderTrash(trashCache.filter((n) => n.id !== note.id));
  setTrashStatus('已还原（同步中…）');
  runBg(window.api.restoreNote(note.id),
    (notes) => { renderTrash(notes); setTrashStatus(`已还原 · 剩 ${notes.length} 条`); refresh(); },
    (e) => { setTrashStatus('出错: ' + String((e && e.message) || e), true); reloadTrash(); });
}

function purgeFromTrash(note) {
  if (!window.confirm('彻底删除后无法恢复，确定？')) return;
  // 乐观：立刻从回收站移除
  renderTrash(trashCache.filter((n) => n.id !== note.id));
  setTrashStatus('已彻底删除（同步中…）');
  runBg(window.api.purgeNote(note.id),
    (notes) => { renderTrash(notes); setTrashStatus(`已彻底删除 · 剩 ${notes.length} 条`); },
    (e) => { setTrashStatus('出错: ' + String((e && e.message) || e), true); reloadTrash(); });
}

// 失败回滚：重新拉取回收站真实状态
async function reloadTrash() {
  try { renderTrash(await window.api.listTrash()); } catch (e) {}
}

// ---------- 设置 ----------
async function openSettings() {
  const cfg = await window.api.getConfig();
  $('cfg-token').value = cfg.token || '';
  $('cfg-pageid').value = cfg.pageId || '';
  $('cfg-autostart').checked = !!cfg.autostart;
  const pct = Math.round((cfg.opacity ?? 0.62) * 100);
  $('cfg-opacity').value = pct;
  $('op-val').textContent = pct + '%';
  const fs = cfg.fontSize || 14;
  $('cfg-fontsize').value = fs;
  $('fs-val').textContent = fs + 'px';
  await populateFonts(cfg.fontFamily || '');
  $('login-msg').textContent = '';
  settingsEl.classList.remove('hidden');
}
function closeSettings() { settingsEl.classList.add('hidden'); }

// 填充字体下拉（系统已装字体，只拉一次缓存）
async function populateFonts(selected) {
  const sel = $('cfg-fontfamily');
  if (!sel.dataset.loaded) {
    let fonts = [];
    try { fonts = await window.api.listFonts(); } catch (e) {}
    fonts.forEach((f) => { const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o); });
    sel.dataset.loaded = '1';
  }
  // 已保存字体若在列表里则选中、清空自定义框；否则显示在自定义框
  const inList = [...sel.options].some((o) => o.value === selected);
  sel.value = inList ? selected : '';
  $('cfg-fontcustom').value = inList ? '' : (selected || '');
}

$('btn-connect').addEventListener('click', async () => {
  const token = $('cfg-token').value.trim();
  const pageId = $('cfg-pageid').value.trim();
  if (!token || !pageId) { $('login-msg').textContent = '请填 token 和页面 ID'; return; }
  $('login-msg').textContent = '验证中…';
  try {
    await window.api.verify(token, pageId);
    await window.api.setConfig({ token, pageId });
    $('login-msg').textContent = '连接成功 ✅';
    closeSettings();
    refresh();
  } catch (e) {
    $('login-msg').textContent = '连接失败: ' + ((e && e.message) || e);
  }
});

$('cfg-opacity').addEventListener('input', (e) => {
  const pct = Number(e.target.value);
  $('op-val').textContent = pct + '%';
  applyOpacity(pct);
});
$('cfg-opacity').addEventListener('change', (e) => {
  window.api.setConfig({ opacity: Number(e.target.value) / 100 });
});
$('cfg-autostart').addEventListener('change', (e) => {
  window.api.setConfig({ autostart: e.target.checked });
});
$('cfg-fontsize').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('fs-val').textContent = v + 'px';
  document.documentElement.style.setProperty('--font-size', v + 'px');
});
$('cfg-fontsize').addEventListener('change', (e) => {
  window.api.setConfig({ fontSize: Number(e.target.value) });
});
$('cfg-fontfamily').addEventListener('change', (e) => {
  const fam = e.target.value;
  $('cfg-fontcustom').value = '';
  window.api.setConfig({ fontFamily: fam });
  applyFont({ fontFamily: fam, fontSize: Number($('cfg-fontsize').value) });
});
$('cfg-fontcustom').addEventListener('change', (e) => {
  const fam = e.target.value.trim();
  $('cfg-fontfamily').value = ''; // 自定义优先，下拉回到默认
  window.api.setConfig({ fontFamily: fam });
  applyFont({ fontFamily: fam, fontSize: Number($('cfg-fontsize').value) });
});
$('cfg-close').addEventListener('click', closeSettings);

// ---------- 事件 ----------
$('btn-refresh').addEventListener('click', refresh);
$('btn-trash').addEventListener('click', openTrash);
$('trash-back').addEventListener('click', closeTrash);
$('btn-settings').addEventListener('click', openSettings);
$('btn-close').addEventListener('click', () => window.api.close());

// 窗口置顶切换
let winPinned = true;
function reflectPin() {
  const b = $('btn-pin');
  b.classList.toggle('on', winPinned);
  b.title = winPinned ? '窗口已置顶（点击取消）' : '窗口未置顶（点击置顶）';
}
$('btn-pin').addEventListener('click', async () => {
  winPinned = !winPinned;
  await window.api.setPin(winPinned);
  reflectPin();
});

// 仅锁定位置（窗口仍可操作，可随时点按钮解锁）
let winPosLocked = false;
function reflectPosLock() {
  const b = $('btn-poslock');
  b.classList.toggle('on', winPosLocked);
  b.title = winPosLocked ? '位置已锁定（点击解锁）' : '锁定位置（防误拖，仍可操作）';
}
$('btn-poslock').addEventListener('click', () => window.api.setPosLock(!winPosLocked));
window.api.onPosLockChange((v) => { winPosLocked = v; reflectPosLock(); });

// 窗口完全锁定（点击即锁；锁定后鼠标穿透，解锁走托盘或 Ctrl+Alt+L）
let winLocked = false;
function reflectLock() {
  const b = $('btn-lock');
  b.classList.toggle('on', winLocked);
  b.textContent = winLocked ? '🔒' : '🔓';
  b.title = winLocked ? '已锁定（托盘图标或 Ctrl+Alt+L 解锁）' : '锁定（置底 + 鼠标穿透）';
}
$('btn-lock').addEventListener('click', () => window.api.setLock(true));
window.api.onLockChange((locked) => { winLocked = locked; reflectLock(); });
// 列表空白处双击新增
listEl.addEventListener('dblclick', (e) => {
  if (e.target === listEl || e.target.classList.contains('empty')) startNewInline();
});

// 空白处按住拖动窗口（移动超过阈值才算拖动，轻点/双击不受影响）
listEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target !== listEl && !e.target.classList.contains('empty')) return; // 只在空白区
  const startX = e.screenX, startY = e.screenY;
  const offX = e.clientX, offY = e.clientY;
  let dragging = false;
  const move = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.screenX - startX, ev.screenY - startY) < 4) return;
      dragging = true;
      window.api.dragStart(offX, offY);
    }
    window.api.dragMove();
  };
  const up = () => {
    if (dragging) window.api.dragEnd();
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
});

// ---------- 自动刷新（10 秒） ----------
const POLL_MS = 10000;
let polling = false;
async function autoRefresh() {
  if (polling) return;
  if (pending > 0) return;                              // 有写操作进行中，别用旧数据覆盖
  if (document.hidden) return;                          // 隐藏到托盘时不拉，省请求
  if (!settingsEl.classList.contains('hidden')) return; // 设置打开时不拉
  if (!trashEl.classList.contains('hidden')) return;    // 回收站打开时不拉
  if (listEl.querySelector('.card-edit')) return;       // 正在编辑时不拉
  const cfg = await window.api.getConfig();
  if (!cfg.token || !cfg.pageId) return;
  polling = true;
  try {
    const notes = await window.api.listNotes();
    render(notes);
    setStatus(`共 ${notes.length} 条 · ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    // 自动刷新失败静默处理，不打断用户操作
  } finally {
    polling = false;
  }
}
setInterval(autoRefresh, POLL_MS);

// ---------- 启动 ----------
(async () => {
  try {
    const v = await window.api.getVersion();
    $('app-ver').textContent = 'v' + v;
    $('settings-ver').textContent = '版本 ' + v;
  } catch (e) {}
  const cfg = await window.api.getConfig();
  pinnedSet = new Set(cfg.pinned || []);
  applyOpacity(Math.round((cfg.opacity ?? 0.62) * 100));
  applyFont(cfg);
  winPinned = cfg.alwaysOnTop !== false;
  reflectPin();
  reflectPosLock();
  reflectLock();
  if (!cfg.token || !cfg.pageId) {
    setStatus('请先在设置里连接 Notion', true);
    openSettings();
  } else {
    refresh();
  }
})();
