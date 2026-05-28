---
doc_type: audit-finding
audit: 2026-05-28-backend-auth-oauth
finding_id: "security-02"
nature: security
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 02：`/api/auth/status` 对所有登录用户暴露 Codex 账号邮箱和 accountId

## 速答

Codex device login 和 logout 只允许 admin 操作，但 `/api/auth/status` 只要求任意 active 登录用户，就会返回 Codex session view 中的邮箱、accountId、过期时间和刷新时间。

## 关键证据

- `apps/api/src/server/routes/auth.ts:77` — `app.get("/api/auth/status", async (c) => {` —— provider/auth 状态查询入口。
- `apps/api/src/server/routes/auth.ts:78` — `const auth = await requireAuth(c);` —— 这里只要求登录用户，不要求 admin。
- `apps/api/src/server/routes/auth.ts:83` — `return c.json(getAuthStatus());` —— 返回完整 auth status。
- `apps/api/src/domain/providers/codex-auth.ts:37` — `const codex = providerConfig.sources.find(...).details.codex ?? codexSessionView(...)` —— status 包含 Codex session view。
- `apps/api/src/domain/providers/codex-auth.ts:372` — `return { available, email: row?.email ?? undefined, accountId: row?.accountId ?? undefined, ... }` —— Codex 账号身份字段会进入响应。
- `apps/api/src/server/routes/auth.ts:86` — `app.post("/api/auth/codex/device/start", async (c) => { const auth = await requireAdmin(c); ... })` —— Codex 登录设置本身是 admin-only。

## 影响

这不会泄露 raw OAuth token，但会把管理员配置的 Codex 账号邮箱、accountId、token 到期和刷新时间暴露给所有普通登录用户。项目安全文档把 provider、OAuth 和 admin 能力视为本地运行时敏感边界；多用户本地部署时，这些身份信息应至少和 Codex 登录操作保持同一 admin 可见边界。

## 修复方向

让 `/api/auth/status` 对普通用户只返回 provider 可用性或当前运行 provider 摘要；Codex `email`、`accountId`、`expiresAt`、`refreshedAt` 等身份/生命周期字段仅在 admin 请求或 admin-only provider config 接口中返回。

## 建议动作

`cs-issue`，因为这是响应字段权限边界问题，修复应同步覆盖共享契约和前端消费。
