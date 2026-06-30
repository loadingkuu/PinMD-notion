# PinMD-notion · Notion 待办桌面悬浮窗

> 一个基于 Electron 的 Windows 桌面悬浮窗，把你的 Notion 待办（to-do）页面常驻在屏幕上，随时勾选、增删、置顶。**非官方项目。**

[![Release](https://img.shields.io/github/v/release/loadingkuu/PinMD-notion)](https://github.com/loadingkuu/PinMD-notion/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 功能特性

- **多标签切换**：左侧竖排标签栏，每个标签对应一个 Notion 页面。单击切换、双击重命名、右键菜单、**拖拽排序**、**自定义颜色**。
- **两种形式**：每个标签可选——
  - *待办*：带勾选框，勾选即完成（移入回收站）。
  - *列表*：无勾选框的清单项，点 ✕ 删除（移入回收站）。
- **直接新建页面**：在 ＋ 里「新建页面」就能用 API 在根页面下创建子页面（自动连好，无需手动操作），或「添加已有」粘贴链接接入现成页面。
- **悬浮常驻**：无边框透明窗口，可置顶显示，记忆窗口位置与大小。
- **回收站机制**：完成/删除的条目会移到各标签独立的 Notion 子页面（回收站），可恢复或彻底删除，不会误删。
- **本地置顶**：把重要条目置顶显示（仅存本机，不写回 Notion）。
- **启动秒显**：内容本地缓存，打开软件与切换标签立即显示，再后台同步。
- **两种锁定模式**：
  - *锁定位置*：固定窗口位置/大小，窗口仍可正常操作。
  - *完全锁定*（`Ctrl+Alt+L`）：鼠标穿透 + 降低存在感，像贴在桌面上的便签；单击托盘图标或再次按快捷键解锁。
- **外观自定义**：透明度、字号、字体（读取系统已安装字体）。
- **托盘驻留**：关闭即隐藏到系统托盘，支持开机自启。

## 📦 下载使用（无需开发环境）

1. 前往 [Releases](https://github.com/loadingkuu/PinMD-notion/releases/latest) 下载最新的 `PinMD-notion-vX.X.X-win-x64.zip`。
2. 解压后运行 `Notion-Float.exe`（绿色免安装）。
3. 首次打开在设置里填入 **Integration Token**（见下方），再用左侧 ＋ 添加 Notion 页面。

## 🔑 配置 Notion

1. 打开 [notion.so/my-integrations](https://www.notion.so/my-integrations)，新建一个 integration，复制它的 **Internal Integration Token**（`secret_xxx` 或 `ntn_xxx`）。
2. 打开你想用作清单的 Notion 页面，点右上角 `•••` → **Connections** → 添加刚才创建的 integration（**否则无权限读取**）。
3. 在软件设置里填入 Token，再用左侧标签栏的 ＋：
   - **添加已有**：粘贴上一步那个页面的链接或 ID（URL 或带连字符的 ID 都能识别）。
   - **新建页面**：直接起个名字，软件会在根页面下建子页面并自动连好（子页面继承父页面的连接，无需再手动 Connections）。

> Token 仅保存在本机 `%AppData%/notion-float/config.json`，不会上传到任何地方。

## 🛠️ 从源码运行 / 打包

需要 [Node.js](https://nodejs.org/)。

```powershell
# 安装依赖
npm install

# 开发运行
npm start

# 打包成 Windows x64 可执行程序（输出到 dist/）
npm run package
```

## 🧩 技术栈

- [Electron](https://www.electronjs.org/) 33
- [Notion API](https://developers.notion.com/)（`v1`，直接 REST 调用）
- 主进程 / 渲染进程通过 `contextBridge` + IPC 通信，`contextIsolation` 开启

## 📁 目录结构

```
src/
  main/        主进程：窗口、托盘、锁定、配置、Notion 调用
    main.js
    notion.js
  preload.js   预加载脚本，暴露安全的 IPC API
  renderer/    渲染层 UI
    index.html
    renderer.js
    styles.css
scripts/       图标生成、打包后裁剪脚本
assets/        图标资源
```

## ⚠️ 说明

本项目为个人非官方工具，与 Notion 官方无关。使用风险自负。

## 📄 License

[MIT](LICENSE) © loadingkuu
