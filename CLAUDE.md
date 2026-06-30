# CLAUDE.md — 项目交接说明（给下一个 AI / 开发者）

> 这是一份**接手文档**。读完它你应该能立刻继续开发，不用反复猜测。
> 阅读顺序建议：先看「项目概览」→「数据模型」→「当前进度」→「坑与约定」。

---

## 1. 项目概览

**PinMD-notion**（内部包名 `notion-float`）是一个 **Windows 桌面悬浮窗**，把 Notion 页面里的待办/清单常驻在屏幕上，可勾选、增删改、置顶、多标签切换。**非官方工具**，直接调 Notion 官方 REST API。

- 平台：Windows（用到了 `app.setLoginItemSettings`、PowerShell 读系统字体等 Win 特性）
- 技术栈：**Electron 33** + 原生 JS（无框架、无构建步骤，渲染层就是 html/css/js）
- GitHub：https://github.com/loadingkuu/PinMD-notion （账号 `loadingkuu`，public）
- License：MIT

---

## 2. 运行 / 打包

```bash
npm install
npm start          # 开发运行（= electron .）
npm run package    # 打包成 dist/Notion-Float-win32-x64/（含裁剪 locale）
```

> ⚠️ 在某些沙箱/后台启动环境里，用 `npm start` 经 Start-Process 启动会触发 `ELECTRON_RUN_AS_NODE`，导致 `app` 为 undefined 报错。直接跑 `node_modules\electron\dist\electron.exe .` 可绕过。正常终端里 `npm start` 没问题。

Release 产物（打包 zip）作为 GitHub Release 附件上传，**不进 git**（`dist/` 已在 .gitignore）。

---

## 3. 文件结构与职责

```
src/
  main/
    main.js     主进程：窗口/托盘/锁定/全局快捷键、配置读写、所有 IPC handler
    notion.js   Notion REST 客户端：列表/增删改、回收站模型、按形式分流块类型
  preload.js    contextBridge 暴露的安全 API（window.api.*），主↔渲染唯一通道
  renderer/
    index.html  UI 结构（标签栏 / 列表 / 底栏 / 回收站 / 设置 / 对话框 / 右键菜单）
    renderer.js UI 逻辑：渲染、乐观更新、标签切换、对话框、轮询刷新
    styles.css  全部样式（无预处理器）
scripts/        图标生成、打包后裁剪
assets/         icon.png / tray.png（icon.ico 由脚本生成，已 gitignore）
```

`contextIsolation: true` + `nodeIntegration: false`，渲染层**只能**通过 `window.api`（preload）访问主进程，不能直接用 Node。

---

## 4. 数据模型（重要！）

配置存在 **`app.getPath('userData')/config.json`**（即 `%AppData%/notion-float/config.json`），**不在项目目录、不进 git**，因此包含用户 token 也安全。

```jsonc
{
  "token": "",            // Notion integration token，全局共享（所有标签共用）
  "tabs": [               // 每个标签 = 一个 Notion 页面
    {
      "id": "t_xxx",      // 本地生成的标签 id（非 pageId）
      "name": "工作",      // 标签显示名（新建时默认取页面标题）
      "pageId": "32位无连字符",
      "mode": "todo",     // "todo"=待办(带勾选框) | "list"=列表(无勾选框)
      "color": "",        // 标签颜色（hex，如 "#2ECC71"；空=无色）
      "binPageId": "",    // 该标签的回收站子页面 id（首次完成项时自动建）
      "pinned": []        // 本地置顶的块 id 列表（仅本机，不写回 Notion）
    }
  ],
  "activeTabId": "t_xxx",
  "opacity": 0.62, "fontSize": 14, "fontFamily": "",
  "autostart": false, "alwaysOnTop": true
}
```

**迁移**：`loadConfig()` 里的 `migrate()` 会把旧版单页面字段（`pageId`/`binPageId`/`pinned`）自动转成一个 `mode:"todo"` 的标签，并给所有标签补默认 `mode`。改数据结构时务必保持迁移兼容。

`creds()` 返回**当前激活标签**的 `{ token, pageId, binPageId, mode }`，所有 notes 类 IPC 都基于它。

**列表内容缓存**：另有一个 `userData/cache.json`（`{ [tabId]: notes[] }`），由 `cache:load`/`cache:save` 读写。渲染层启动和切标签时先用它**秒显**，再后台 `refresh(silent)`。这是性能关键，别去掉。

---

## 5. 核心机制与约定

- **乐观更新**：渲染层先改 UI（`render`），再后台 `runBg()` 发请求；失败才回滚/重拉。写操作进行中（`pending>0`）暂停自动轮询，避免旧数据覆盖。
- **自动刷新**：`autoRefresh()` 每 10s 拉一次，但窗口隐藏/设置或回收站或对话框打开/正在编辑/无 token 或无激活标签时跳过。
- **回收站模型**：Notion API **没有"移动块"**。"完成/删除"= 在回收站子页面追加副本 + 删除原块（块 id 会变）。还原同理反向。每个标签有独立回收站。
- **标签形式（mode）**：`notion.js` 用 `blockTypeOf(cfg)` 把 `todo→to_do`、`list→bulleted_list_item`，统一所有读写。待办有勾选框、勾选=完成入回收站；列表无勾选框、用 ✕ 删除入回收站。**已建标签的形式不可切换**（对应不同 Notion 块类型）。
- **标签切换性能**：`notesByTab` 做每标签缓存。切换时乐观立即换 UI + 缓存秒显，再 `await activateTab` 持久化后 `refresh(silent)` 后台刷新。**注意必须先 await activateTab 再 listNotes**，否则后端按旧标签读取（竞态）。
- **页面 id 归一化**：`normalizeId()` 把页面链接/带连字符 id 统一成 32 位 hex 存储。
- **新建页面**：`notion.createChildPage()` 用 API 建子页面，父页面**默认取第一个标签（根页面）**而非当前标签，避免一层套一层。子页面自动继承父页面的 integration 连接，无需手动连。API **不能**建工作区顶级页面，所以必须有一个父页面（首个标签得用"添加已有"接入）。
- **回收站去重**：`ensureBinPage()` 建回收站前先 `findBinChild()` 查页面里有没有现成的"🗑 回收站"子页面，有就复用——防止并发删除时各建一个导致重复。
- **标签拖拽排序**：渲染层用 HTML5 drag 事件，落点重排后 `tabs:reorder({ids})` 持久化。
- **标签颜色**：右键标签→设置颜色，`tabs:color` 存 hex；渲染层 `hexA()` 把 hex 转 rgba 上底色。
- **图标**：`scripts/generate-icon.js` 纯 JS 逐像素 + 超采样抗锯齿画出 `icon.png`/`tray.png`（蓝紫渐变圆角方块 + 白色 Notion "N" + 绿色对勾徽章）；`generate-ico.js` 再把 png 内嵌成 `icon.ico` 供打包用。改图标改这个脚本。

---

## 6. 坑 / 环境注意

- **Electron 不支持 `window.prompt()`**（会报错）。`window.confirm`/`alert` 可用。需要输入框时用 `renderer.js` 里的通用对话框 `openDialog()` / `#dialog`。
- **CSP**：`index.html` 头部限制 `default-src 'self'; style-src 'self' 'unsafe-inline'`。新增外部资源会被拦；JS 设置元素 `.style` 是允许的。
- 渲染层用了 `writing-mode: vertical-rl` 实现左侧竖排标签。
- 锁定有两级：`posLocked`（仅锁位置）和 `locked`（完全锁定=鼠标穿透+置底+降存在感，靠托盘单击或 `Ctrl+Alt+L` 解锁）。
- 打包用 `electron-packager`，`scripts/prune.js` 会删多余 locale 省体积。

---

## 7. 当前进度（截至 2026-06-30，已发布 v1.1.0）

**已全部提交并推送到 main，并发布了 GitHub Release v1.1.0**（zip 作为附件）。

v1.1.0 相对初版（v1.0.0 单页面）新增/完成：
1. **多标签**：数据模型改多标签 + 旧配置迁移；左侧竖排标签栏：单击切换 / 双击重命名 / 右键菜单（重命名·设置颜色·删除）/ 拖拽排序 / 底部 ＋ 新增。
2. **新建页面**：＋ 对话框两种方式——「新建页面」（API 在根页面下建子页面）和「添加已有」（粘贴链接）。
3. **待办/列表两种形式**：新增/添加标签时可选 `todo`/`list`，对应不同块类型与 UI。
4. **标签颜色**：每个标签可设颜色。
5. **启动/切换秒显**：`cache.json` 本地缓存。
6. **回收站去重**：`findBinChild()` 复用已有回收站。
7. **全新图标** + 版本号 1.1.0 + 新增本交接文档 CLAUDE.md。

> 验证状态：四个 JS `node --check` 通过；electron 直接启动主进程无报错；用户实机用过多标签/新建/形式/颜色/拖拽。Notion 真实读写已由用户验证可用。

**下一步可做（尚未实现）**：
- 已有标签**切换形式**（todo↔list，需转换现有块类型，注意块 id 会变）。
- 跨 workspace 多 token（当前 token 全局共享，见数据模型）。
- 完成/删除**可撤销**（目前直接进回收站）。
- 列表内**搜索/过滤**、切标签**快捷键**（Ctrl+数字）。
- 设置面板：token 显示/隐藏、一键测试连接。

> 发布流程：`npm run package` → 压缩 `dist\Notion-Float-win32-x64` 成 `PinMD-notion-v<ver>-win-x64.zip` → `gh release create v<ver> <zip> ...`。gh 在 `C:\Program Files\GitHub CLI\gh.exe`，账号 `loadingkuu`。改版本号要同时改 `package.json` 的 `version` 和 package 脚本里的 `--app-version`。

---

## 8. 工作约定（与用户协作时）

- 用户是中文沟通，**非专业程序员**，讲清楚"做了什么、怎么用"，少堆术语。
- 改完代码要**实际重启 app 验证**（直接跑 electron.exe），别只靠语法检查。
- 涉及对外动作（提交/推送/发 Release）**先问用户**再做。
- 该机器没有全局 `gh` 的 PATH；GitHub CLI 在 `C:\Program Files\GitHub CLI\gh.exe`，已登录账号 `loadingkuu`。
