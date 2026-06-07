# PinMD-notion · Notion 待办桌面悬浮窗

> 一个基于 Electron 的 Windows 桌面悬浮窗，把你的 Notion 待办（to-do）页面常驻在屏幕上，随时勾选、增删、置顶。**非官方项目。**

[![Release](https://img.shields.io/github/v/release/loadingkuu/PinMD-notion)](https://github.com/loadingkuu/PinMD-notion/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## ✨ 功能特性

- **悬浮常驻**：无边框透明窗口，可置顶显示，记忆窗口位置与大小。
- **直连 Notion**：读取指定 Notion 页面下的待办块，支持新增、编辑、勾选完成。
- **回收站机制**：勾选完成的待办会移动到 Notion 子页面（回收站），可恢复或彻底删除，不会误删。
- **本地置顶**：把重要待办置顶显示（仅存本机，不写回 Notion）。
- **两种锁定模式**：
  - *锁定位置*：固定窗口位置/大小，窗口仍可正常操作。
  - *完全锁定*（`Ctrl+Alt+L`）：鼠标穿透 + 降低存在感，像贴在桌面上的便签；单击托盘图标或再次按快捷键解锁。
- **外观自定义**：透明度、字号、字体（读取系统已安装字体）。
- **托盘驻留**：关闭即隐藏到系统托盘，支持开机自启。

## 📦 下载使用（无需开发环境）

1. 前往 [Releases](https://github.com/loadingkuu/PinMD-notion/releases) 下载最新的 `PinMD-notion-vX.X.X-win-x64.zip`。
2. 解压后运行 `Notion-Float.exe`。
3. 首次打开在设置里填入 **Integration Token** 和 **页面 ID**（见下方）。

## 🔑 配置 Notion

1. 打开 [notion.so/my-integrations](https://www.notion.so/my-integrations)，新建一个 integration，复制它的 **Internal Integration Token**（`secret_xxx` 或 `ntn_xxx`）。
2. 打开你想用作待办列表的 Notion 页面，点右上角 `•••` → **Connections** → 添加刚才创建的 integration（**否则无权限读取**）。
3. 复制该页面的链接或页面 ID，填进应用设置里的「页面 ID」（URL 或带连字符的 ID 都能识别）。

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
