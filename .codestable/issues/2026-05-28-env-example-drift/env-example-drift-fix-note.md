---
doc_type: issue-fix
issue: 2026-05-28-env-example-drift
path: fast-track
fix_date: 2026-05-28
tags: [config, env, documentation]
---

# 环境变量示例漂移修复记录

## 1. 问题描述

根目录 `.env` 与 `.env.example` 的变量集合不一致，导致本地配置模板不能完整表达当前代码支持的运行时配置项。

本次处理只同步可提交的安全占位和默认值，不复制 `.env` 中的真实凭据或本机私有值。

## 2. 根因

`.env.example` 缺少部分代码已读取的可选环境变量：

- `apps/api/src/infrastructure/providers/codex-image-provider.ts` 读取 `CODEX_IMAGE_TIMEOUT_MS`。
- `apps/api/src/domain/providers/codex-auth.ts` 读取 `CODEX_RESPONSES_BASE_URL`、`CODEX_AUTH_ISSUER`、`CODEX_REFRESH_TOKEN_URL`、`CODEX_AUTH_TIMEOUT_MS`。
- `apps/api/src/smoke/mailgun-smoke.ts` 读取 `MAILGUN_SUBJECT`、`MAILGUN_TEXT`。
- `apps/api/src/server/http/auth.ts` 读取 `COOKIE_SECURE`。

本机 `.env` 里额外存在 `DATABASE_DRIVER`，但仓库代码未读取该变量；因此没有把它加入 `.env.example`。

## 3. 修复方案

在 `.env.example` 中补充 Codex、Mailgun smoke 和 Cookie 安全相关的可选配置项，所有敏感值保持空占位或安全默认值。

## 4. 改动文件清单

- `.env.example`：补充 `CODEX_IMAGE_TIMEOUT_MS`、Codex 服务覆盖项、`MAILGUN_SUBJECT`、`MAILGUN_TEXT`、`COOKIE_SECURE`。

## 5. 验证结果

- `git diff --check`：通过。
- `.env.example` 重复变量检查：通过，没有重复 key。
- `.env` / `.env.example` 变量差异复核：`.env` 只剩未被代码读取的 `DATABASE_DRIVER` 没有进入模板；`.env.example` 保留可选安全占位项。
- `source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 && pnpm typecheck`：通过。
- `source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 && pnpm build`：通过；Vite 报告既有 chunk 体积警告，不影响构建退出状态。

## 6. 遗留事项

无。
