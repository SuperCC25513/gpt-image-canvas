---
doc_type: audit-finding
audit: 2026-05-28-backend-auth-oauth
finding_id: "bug-01"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：并发刷新 Codex token 可能用旧 refresh token 把有效会话标记为不可用

## 速答

多个请求同时发现 Codex token 需要刷新时，会并发使用同一个 refresh token；如果上游轮换 refresh token，其中一个请求先保存新 token，另一个请求随后收到 `invalid_grant` / reused 类错误，会清空刚保存的有效会话。

## 关键证据

- `apps/api/src/domain/providers/codex-auth.ts:156` — `export async function getValidCodexSession(...)` —— 每次需要 Codex access token 时都会读取当前 token row。
- `apps/api/src/domain/providers/codex-auth.ts:162` — `const sessionRow = shouldRefreshCodexToken(row) ? await refreshCodexToken(row, signal) : row;` —— 只按当前行判断是否刷新，没有进程内单飞或数据库条件更新。
- `apps/api/src/domain/providers/codex-auth.ts:244` — `async function refreshCodexToken(row: CodexTokenRow, ...)` —— 刷新函数接收调用开始时读到的旧 row。
- `apps/api/src/domain/providers/codex-auth.ts:257` — `refresh_token: row.refreshToken` —— 并发请求会复用同一个旧 refresh token。
- `apps/api/src/domain/providers/codex-auth.ts:270` — `classifyCodexRefreshFailure(response.status, body) === "permanent"` —— permanent 失败会被当成当前会话不可用。
- `apps/api/src/domain/providers/codex-auth.ts:271` — `markCodexSessionUnavailable("refresh_rejected");` —— 失败分支直接清空数据库中的 token 字段。
- `apps/api/src/domain/providers/codex-auth.ts:356` — `db.update(codexOAuthTokens).set({ accessToken: null, refreshToken: null, idToken: null, ... })` —— 清空操作没有验证数据库里的 refresh token 是否仍等于本次请求使用的旧值。

## 影响

触发条件是 Codex access token 到期或达到 8 天刷新间隔时，同一时间有多个生成/Agent 请求使用 Codex provider。若上游对 refresh token 做轮换或复用检测，一个请求成功刷新后，另一个旧 token 刷新失败可能把新会话标记为不可用，表现为 Codex 登录突然失效，需要管理员重新登录。

## 修复方向

给 Codex refresh 加单飞锁，或在 `markCodexSessionUnavailable` / `storeCodexTokens` 时带上旧 refresh token 条件，只有数据库仍是本次使用的 token 才允许清空或覆盖。

## 建议动作

`cs-issue`，因为这是 OAuth 会话生命周期 bug，需用并发测试复现和验证。
