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

// 标签形式 → Notion 块类型：待办=to_do（带勾选框）；列表=bulleted_list_item（无勾选框）
const BLOCK_TYPES = { todo: 'to_do', list: 'bulleted_list_item' };
function blockTypeOf(cfg) { return BLOCK_TYPES[cfg && cfg.mode] || 'to_do'; }
// 构造一个块；仅 to_do 带 checked 字段
function makeBlock(type, rich, checked) {
  const data = { rich_text: rich || [] };
  if (type === 'to_do') data.checked = !!checked;
  return { object: 'block', type, [type]: data };
}

// 列出某页面下指定类型的全部块（自动翻页）
async function listBlocks(token, pageId, type) {
  type = type || 'to_do';
  const out = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await req(token, 'GET', `/blocks/${pageId}/children${qs}`);
    for (const b of data.results || []) {
      if (b.type === type) {
        const d = b[type] || {};
        out.push({
          id: b.id,
          text: richToText(d.rich_text),
          checked: !!d.checked,
          rich: d.rich_text || [], // 保留原始富文本用于移动时无损复制
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

// ---- 配置：{ token, pageId, binPageId, mode } ----
async function listTodos(cfg) {
  const blocks = await listBlocks(cfg.token, cfg.pageId, blockTypeOf(cfg));
  return blocks.map(toView);
}

async function addTodo(cfg, text) {
  await req(cfg.token, 'PATCH', `/blocks/${cfg.pageId}/children`, {
    children: [makeBlock(blockTypeOf(cfg), textToRich(text), false)],
  });
  return listTodos(cfg);
}

async function updateTodo(cfg, id, text) {
  await req(cfg.token, 'PATCH', `/blocks/${id}`, { [blockTypeOf(cfg)]: { rich_text: textToRich(text) } });
  return listTodos(cfg);
}

// 仅待办形式使用（列表形式无勾选框）
async function setChecked(cfg, id, on) {
  await req(cfg.token, 'PATCH', `/blocks/${id}`, { to_do: { checked: !!on } });
  return listTodos(cfg);
}

const BIN_TITLE = '🗑 回收站';

// 在页面的子块里找现成的回收站子页面（避免并发/失忆时重复创建）
async function findBinChild(token, pageId) {
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await req(token, 'GET', `/blocks/${pageId}/children${qs}`);
    for (const b of data.results || []) {
      if (b.type === 'child_page' && !b.archived && b.child_page && b.child_page.title === BIN_TITLE) {
        return b.id;
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return null;
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
  // 优先复用已存在的回收站，杜绝重复创建
  const existing = await findBinChild(cfg.token, cfg.pageId);
  if (existing) return existing;
  const page = await req(cfg.token, 'POST', '/pages', {
    parent: { page_id: cfg.pageId },
    properties: { title: { title: [{ text: { content: BIN_TITLE } }] } },
  });
  return page.id;
}

// 取某块内容（含富文本+勾选），用于复制（不限类型）
async function fetchBlock(token, id) {
  const b = await req(token, 'GET', `/blocks/${id}`);
  const d = b[b.type] || {};
  return { type: b.type, rich: d.rich_text || [], checked: !!d.checked };
}

// 在目标页追加一个指定类型的块（复用源富文本）
async function appendBlock(token, targetPageId, type, rich, checked) {
  await req(token, 'PATCH', `/blocks/${targetPageId}/children`, {
    children: [makeBlock(type, rich || [], checked)],
  });
}

// 删除块（Notion 归档到回收站；从父页面移除）
async function deleteBlock(token, id) {
  await req(token, 'DELETE', `/blocks/${id}`);
}

// 挪进回收站：复制到回收站页 + 删除原块。返回最新主列表。
async function moveToBin(cfg, id) {
  const binId = await ensureBinPage(cfg);
  const src = await fetchBlock(cfg.token, id);
  await appendBlock(cfg.token, binId, blockTypeOf(cfg), src.rich, true); // 待办进回收站统一标记为已完成
  await deleteBlock(cfg.token, id);
  return { notes: await listTodos(cfg), binPageId: binId };
}

// 回收站列表
async function listBin(cfg) {
  const binId = await ensureBinPage(cfg);
  const blocks = await listBlocks(cfg.token, binId, blockTypeOf(cfg));
  return { notes: blocks.map(toView), binPageId: binId };
}

// 还原：复制回主页面（取消勾选）+ 从回收站删除
async function restoreFromBin(cfg, id) {
  const binId = await ensureBinPage(cfg);
  const src = await fetchBlock(cfg.token, id);
  await appendBlock(cfg.token, cfg.pageId, blockTypeOf(cfg), src.rich, false);
  await deleteBlock(cfg.token, id);
  return { notes: blocks2view(await listBlocks(cfg.token, binId, blockTypeOf(cfg))), binPageId: binId };
}

// 彻底删除：直接删回收站里的块
async function purgeFromBin(cfg, id) {
  const binId = await ensureBinPage(cfg);
  await deleteBlock(cfg.token, id);
  return { notes: blocks2view(await listBlocks(cfg.token, binId, blockTypeOf(cfg))), binPageId: binId };
}

// 从页面对象里取标题（页面唯一的 title 类型属性）
function pageTitle(page) {
  const props = (page && page.properties) || {};
  for (const k of Object.keys(props)) {
    if (props[k] && props[k].type === 'title') return richToText(props[k].title);
  }
  return '';
}

// 在父页面下新建一个子页面（子页面自动继承父页面的 integration 连接）
async function createChildPage(token, parentPageId, title) {
  const name = String(title == null ? '' : title).slice(0, 2000) || '未命名';
  return req(token, 'POST', '/pages', {
    parent: { page_id: parentPageId },
    properties: { title: { title: [{ text: { content: name } }] } },
  });
}

// 校验配置可用：能访问主页面即视为通过；附带返回页面标题用作标签名
async function verify(cfg) {
  const page = await req(cfg.token, 'GET', `/pages/${cfg.pageId}`);
  return { ok: true, pageId: page.id, title: pageTitle(page) };
}

module.exports = {
  listTodos,
  addTodo,
  updateTodo,
  setChecked,
  ensureBinPage,
  createChildPage,
  moveToBin,
  listBin,
  restoreFromBin,
  purgeFromBin,
  verify,
};
