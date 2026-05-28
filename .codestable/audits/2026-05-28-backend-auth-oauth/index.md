---
doc_type: audit-index
audit: 2026-05-28-backend-auth-oauth
scope: Backend local account auth, session cookies, registration policy, admin bootstrap, and Codex OAuth token lifecycle.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-auth-oauth 审计报告

## 范围

本次审计覆盖认证与 Codex OAuth 后端路径：

- `apps/api/src/server/routes/auth.ts`
- `apps/api/src/server/http/auth.ts`
- `apps/api/src/domain/auth/auth-store.ts`
- `apps/api/src/domain/auth/password.ts`
- `apps/api/src/domain/providers/codex-auth.ts`
- `apps/api/src/domain/providers/codex-auth-utils.ts`
- `apps/api/src/domain/providers/provider-config.ts`
- `packages/shared/src/auth.ts`
- `packages/shared/src/provider-config.ts`

## 总评

共发现 3 条问题：`bug` 1 条、`security` 1 条、`performance` 1 条；严重度为 P1 1 条、P2 2 条。基础认证策略与项目安全文档总体一致：session cookie 设置了 `HttpOnly`、`SameSite=Lax`、`Path=/`，数据库只保存 session token hash，自助注册先校验邮箱后缀再查重，`ADMIN_PASSWORD` 只用于首次创建管理员。主要风险在 Codex refresh token 并发刷新可能误清有效登录态、普通用户可读取 Codex 账号状态，以及每次鉴权都写 session 造成 SQLite 热点写。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | medium | 并发刷新 Codex token 可能用旧 refresh token 把有效会话标记为不可用 | [finding-01.md](finding-01.md) |
| 2 | security | P2 | high | `/api/auth/status` 对所有登录用户暴露 Codex 账号邮箱和 accountId | [finding-02.md](finding-02.md) |
| 3 | performance | P2 | medium | 每次鉴权都会更新 session lastSeenAt，SQLite 下形成全站写放大 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 0 | 1 |
| security | 0 | 0 | 1 | 1 |
| performance | 0 | 0 | 1 | 1 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **1** | **2** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01 建议走 `cs-issue`，给 Codex token refresh 加单飞或乐观版本检查，避免旧 refresh 结果覆盖新会话。
- **P2 有空再看**：Finding 02 建议走 `cs-issue`，把 Codex 账号身份字段限制为 admin 可见；Finding 03 建议走 `cs-refactor`，对 session touch 做节流或只在滑动过期窗口需要时写库。
