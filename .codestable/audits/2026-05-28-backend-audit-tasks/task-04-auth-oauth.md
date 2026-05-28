---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "04"
slug: backend-auth-oauth
status: completed
priority: P0
recommended_dimensions:
  - security
  - bug
  - arch-drift
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-auth-oauth/
---

# Task 04：认证/注册/session/Codex OAuth

## 目标产物

`.codestable/audits/2026-05-28-backend-auth-oauth/`

## 路径

- `apps/api/src/server/routes/auth.ts`
- `apps/api/src/server/http/auth.ts`
- `apps/api/src/domain/auth/auth-store.ts`
- `apps/api/src/domain/auth/password.ts`
- `apps/api/src/domain/providers/codex-auth.ts`
- `apps/api/src/domain/providers/codex-auth-utils.ts`
- `packages/shared/src/auth.ts`

## 业务含义

负责本地账号注册登录、session cookie、管理员 bootstrap、每日签到、Codex device auth 和 OAuth token 存储。

## 风险理由

这是整个后端权限边界入口。注册策略、邮箱域名限制、session hash、管理员权限、OAuth token 保存和 logout 都需要同时满足安全和兼容旧库要求。

## 推荐审计维度

- `security`：session cookie、token 存储、权限判断、OAuth 响应脱敏、用户枚举。
- `bug`：注册开关/邮箱域名策略、管理员 bootstrap、过期 session、logout。
- `arch-drift`：是否符合架构记录中的注册策略和默认邮箱域名约束。

## 重点检查

- session cookie 是否保持 `HttpOnly`、`SameSite=Lax`、`Path=/`。
- 数据库存储是否只保存 session token hash。
- 不支持邮箱域名是否在邮箱查重前拒绝。
- `ADMIN_PASSWORD` 是否只用于首次创建管理员，不重置已有密码。
- Codex OAuth token 是否不在响应或日志中泄露。

## 不做

不做公网部署级安全加固评估；不更改账号策略。
