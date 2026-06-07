'use strict';
// Notion 待办同步客户端（官方 REST API）
// 模型：主页面下全是 to_do 块；勾选完成 = 把块挪进“回收站”子页面（复制+删除）。
// Notion API 无“移动块”操作，故移动 = 在目标页追加副本 + 删除原块（块 ID 会变）。

const NOTION_VERSION = '2022-06-28';
const BASE = 'https://api.notion.com/v1';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'content-type': 'application/json',
  };
}

// 统一请求；非 2xx 时抛出带 code 的错误（401 → AUTH，便于上层提示）
async function req(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: authHeaders(token),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }
  if (!res.ok) {
    const msg = (json && json.message) || `Notion HTTP ${res.status}`;
    const err = new Error(msg);
    if (res.status === 401) err.code = 'AUTH';
    err.status = res.status;
    throw err;
  }
  return json;
}

// rich_text 数组 → 纯文本
function richToText(rich) {
  return (rich || []).map((r) => (r.plain_text != null ? r.plain_text : (r.text && r.text.content) || '')).join('');
}
// 纯文本 → rich_text 数组（Notion 单段上限 2000 字，超出截断）
function textToRich(text) {
  const s = String(text == null ? '' : text).slice(0, 2000);
  return s ? [{ type: 'text', text: { content: s } }] : [];
}

// 列出某页面下的全部 to_do 块（自动翻页）
async function listTodoBlocks(token, pageId) {
  const out = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await req(token, 'GET', `/blocks/${pageId}/children${qs}`);
    for (const b of data.results || []) {
      if (b.type === 'to_do') {
        out.push({
          id: b.id,
          text: richToText(b.to_do.rich_text),
          checked: !!b.to_do.checked,
          rich: b.to_do.rich_text || [], // 保留原始富文本用于移动时无损复制
        });
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

// 视图项：不外泄原始 rich_text
const toView = (b) => ({ id: b.id, text: b.text, checked: b.checked });
const blocks2view = (blocks) => blocks.map(toView);

// ---- 配置：{ token, pageId, binPageId } ----
async function listTodos(cfg) {
  const blocks = await listTodoBlocks(cfg.token, cfg.pageId);
  return blocks.map(toView);
}

async function addTodo(cfg, text) {
  await req(cfg.token, 'PATCH', `/blocks/${cfg.pageId}/children`, {
    children: [{ object: 'block', type: 'to_do', to_do: { rich_text: textToRich(text), checked: false } }],
  });
  return listTodos(cfg);
}

async function updateTodo(cfg, id, text) {
  await req(cfg.token, 'PATCH', `/blocks/${id}`, { to_do: { rich_text: textToRich(text) } });
  return listTodos(cfg);
}

async function setChecked(cfg, id, on) {
  await req(cfg.token, 'PATCH', `/blocks/${id}`, { to_do: { checked: !!on } });
  return listTodos(cfg);
}

// 确保回收站子页面存在；不存在则在主页面下创建并返回其 id
async function ensureBinPage(cfg) {
  if (cfg.binPageId) {
    // 校验仍可用：未被删(404) 且未被归档（已归档页不能再追加内容）
    try {
      const b = await req(cfg.token, 'GET', `/blocks/${cfg.binPageId}`);
      if (b && !b.archived && !b.in_trash) return cfg.binPageId;
      // 否则视为失效 → 落到下面重建
    } catch (e) { if (e.status !== 404) throw e; }
  }
  const page = await req(cfg.token, 'POST', '/pages', {
    parent: { page_id: cfg.pageId },
    properties: { title: { title: [{ text: { content: '🗑 回收站' } }] } },
  });
  return page.id;
}

// 取某块的 to_do 内容（含富文本+勾选），用于复制
async function fetchTodo(token, id) {
  const b = await req(token, 'GET', `/blocks/${id}`);
  if (b.type !== 'to_do') throw new Error('该块不是待办项');
  return { rich: b.to_do.rich_text || [], checked: !!b.to_do.checked };
}

// 在目标页追加一个 to_do 块（复用源富文本）
async function appendTodo(token, targetPageId, rich, checked) {
  await req(token, 'PATCH', `/blocks/${targetPageId}/children`, {
    children: [{ object: 'block', type: 'to_do', to_do: { rich_text: rich || [], checked: !!checked } }],
  });
}

// 删除块（Notion 归档到回收站；从父页面移除）
async function deleteBlock(token, id) {
  await req(token, 'DELETE', `/blocks/${id}`);
}

// 挪进回收站：复制到回收站页 + 删除原块。返回最新主列表。
async function moveToBin(cfg, id) {
  const binId = await ensureBinPage(cfg);
  const src = await fetchTodo(cfg.token, id);
  await appendTodo(cfg.token, binId, src.rich, true); // 进回收站统一标记为已完成
  await deleteBlock(cfg.token, id);
  return { notes: await listTodos(cfg), binPageId: binId };
}

// 回收站列表
async function listBin(cfg) {
  const binId = await ensureBinPage(cfg);
  const blocks = await listTodoBlocks(cfg.token, binId);
  return { notes: blocks.map(toView), binPageId: binId };
}

// 还原：复制回主页面（取消勾选）+ 从回收站删除
async function restoreFromBin(cfg, id) {
  const binId = await ensureBinPage(cfg);
  const src = await fetchTodo(cfg.token, id);
  await appendTodo(cfg.token, cfg.pageId, src.rich, false);
  await deleteBlock(cfg.token, id);
  return { notes: blocks2view(await listTodoBlocks(cfg.token, binId)), binPageId: binId };
}

// 彻底删除：直接删回收站里的块
async function purgeFromBin(cfg, id) {
  const binId = await ensureBinPage(cfg);
  await deleteBlock(cfg.token, id);
  return { notes: blocks2view(await listTodoBlocks(cfg.token, binId)), binPageId: binId };
}

// 校验配置可用：能访问主页面即视为通过
async function verify(cfg) {
  const page = await req(cfg.token, 'GET', `/pages/${cfg.pageId}`);
  return { ok: true, pageId: page.id };
}

module.exports = {
  listTodos,
  addTodo,
  updateTodo,
  setChecked,
  ensureBinPage,
  moveToBin,
  listBin,
  restoreFromBin,
  purgeFromBin,
  verify,
};
