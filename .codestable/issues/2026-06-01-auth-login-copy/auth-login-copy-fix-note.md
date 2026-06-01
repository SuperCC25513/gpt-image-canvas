---
doc_type: issue-fix
issue: 2026-06-01-auth-login-copy
path: fast-track
fix_date: 2026-06-01
tags: [web, auth, copy]
---

# 登录页本机文案修复记录

## 1. 问题描述

登录页中文副标题写着“登录后进入本机创作工作台。”，但当前产品状态不再应强调“本机”，容易让用户误解登录后的工作台只对应本机环境。

## 2. 根因

`apps/web/src/shared/i18n/index.tsx` 的 `authLoginCopy` 仍保留旧的 local-only 文案；英文副本也使用了 `local creative workspace`。

## 3. 修复方案

将登录页文案改为部署中立但仍贴合产品定位的表述：

- 中文：`登录后进入 AI 图像创作工作台。`
- 英文：`Sign in to enter the AI image creative workspace.`

## 4. 改动文件清单

- `apps/web/src/shared/i18n/index.tsx`：更新 `zhMessages.authLoginCopy` 和 `enMessages.authLoginCopy`。

## 5. 验证结果

- `source ~/.nvm/nvm.sh && nvm use 24.15.0 && pnpm typecheck`：通过。
- `source ~/.nvm/nvm.sh && nvm use 24.15.0 && pnpm build`：通过；Vite 仍有既有 chunk 体积警告，不影响构建退出状态。
- `source ~/.nvm/nvm.sh && nvm use 24.15.0 && USE_MYSQL=false pnpm dev`：Web 与 API 正常启动。
- 浏览器验证 `http://127.0.0.1:5173/`：桌面 `1280x900` 和移动 `390x844` 都显示 `登录后进入 AI 图像创作工作台。`，未出现旧文案 `登录后进入本机创作工作台。`，页面无运行时错误。

## 6. 遗留事项

无。
