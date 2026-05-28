---
doc_type: audit-finding
audit: 2026-05-28-backend-auth-oauth
finding_id: "performance-03"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 03：每次鉴权都会更新 session lastSeenAt，SQLite 下形成全站写放大

## 速答

所有需要登录的 API 都会读取 cookie 并调用 `currentUserFromToken`；该函数每次认证成功都更新 `sessions.last_seen_at`，即使 session 不做滑动续期，也会让读请求变成数据库写请求。

## 关键证据

- `apps/api/src/server/http/auth.ts:20` — `export async function requireAuth(c: Context)` —— 后端多数业务路由通过该入口鉴权。
- `apps/api/src/server/http/auth.ts:51` — `export async function currentUserFromRequest(c: Context)` —— 从 cookie 取 session token。
- `apps/api/src/server/http/auth.ts:52` — `return currentUserFromToken(getCookie(c, SESSION_COOKIE_NAME));` —— 每次鉴权进入 auth store。
- `apps/api/src/domain/auth/auth-store.ts:212` — `await touchSession(tokenHash);` —— 每次有效 session 都触发写库。
- `apps/api/src/domain/auth/auth-store.ts:592` — `async function touchSession(tokenHash: string): Promise<void>` —— 只更新 `lastSeenAt`。
- `apps/api/src/domain/auth/auth-store.ts:594` — `db.update(sessions).set({ lastSeenAt }).where(eq(sessions.tokenHash, tokenHash)).run();` —— SQLite 模式下每个已登录请求都有一次写事务。
- `apps/api/src/domain/auth/auth-store.ts:289` — `const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();` —— session 过期时间只在创建时确定，touch 不会延长过期时间。

## 影响

在 SQLite 默认本地模式下，Gallery、生成轮询、Agent WebSocket 辅助请求和后台查询等所有已登录请求都会产生 session 写入。`lastSeenAt` 不参与续期，收益主要是审计可见性，但代价是增加 SQLite 写锁竞争和磁盘写放大，负载上来后会放大接口尾延迟。

## 修复方向

对 `touchSession` 做节流，例如同一 session 5-15 分钟最多写一次；或者只在需要滑动续期、用户活跃统计或后台审计查询时更新。

## 建议动作

`cs-refactor`，因为这是行为保持的性能优化，适合在 auth helper 内集中收敛。
