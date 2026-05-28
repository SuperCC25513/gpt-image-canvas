---
doc_type: feature-ff-note
feature: remove-mailgun-email
date: 2026-05-28
requirement:
tags: [api, email, mailgun, cleanup]
---

## 做了什么
移除了项目中的 Mailgun 发邮件模块，不再提供独立发信 smoke 入口，也不再暴露 Mailgun 示例环境变量。

## 改了哪些
- `apps/api/src/infrastructure/email/mailgun-email.ts` — 删除 Mailgun 配置读取、消息构造、发送和错误封装实现。
- `apps/api/src/smoke/mailgun-smoke.ts` — 删除 Mailgun 发信 smoke 脚本。
- `apps/api/package.json` / `pnpm-lock.yaml` — 移除 `smoke:mailgun` 脚本以及 `mailgun.js`、`form-data` 依赖。
- `.env.example` — 移除 `MAILGUN_*` 示例配置，保留现有非邮件配置改动。

## 怎么验证的
独立 subagent 已运行 Mailgun 关键字残留搜索、`pnpm typecheck` 和 `pnpm build`，均通过。浏览器验证未运行，因为本次没有 UI 改动。
