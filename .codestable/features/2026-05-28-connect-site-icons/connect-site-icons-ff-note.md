---
doc_type: feature-ff-note
feature: connect-site-icons
date: 2026-05-28
requirement:
tags: [web, assets, favicon, pwa]
---

## 做了什么

接入网站 favicon、Apple touch icon 和 PWA 图标文件，让浏览器标签页、收藏夹、移动主屏和 manifest 都使用提供的 CC 图标套件。

## 改了哪些

- apps/web/public — 复制 `favicon.ico`、`favicon.svg`、`apple-touch-icon.png`、`icon-192.png`、`icon-512.png` 和 `site.webmanifest`。
- apps/web/index.html:6 — 增加 theme color，并把 head 图标引用切到 `.ico`、`.svg`、Apple touch icon 和 manifest。
- apps/web/public/site.webmanifest:2 — 改成 GPT Image CC 的站点名称、PWA 图标和项目色。
- apps/web/src/features/canvas/CanvasApp.tsx:2548 — 通知图标改用 192px PWA 图标。

## 怎么验证的

独立验证 subagent 运行 `source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 && pnpm typecheck` 与 `source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 && pnpm build`，均通过；原样 `nvm use 24.15.0 && ...` 在 subagent shell 因未加载 nvm 失败。主上下文用 Vite dev server `http://127.0.0.1:5174/` 确认 head 引用和 `/favicon.ico`、`/favicon.svg`、`/site.webmanifest`、`/icon-192.png` 能返回 200。
