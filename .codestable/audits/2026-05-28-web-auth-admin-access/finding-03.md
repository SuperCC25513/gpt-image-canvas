---
doc_type: audit-finding
audit: 2026-05-28-web-auth-admin-access
finding_id: "bug-03"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 03：登出请求失败时前端仍会先清空当前用户

## 速答

`logout` 不检查 `/api/auth/logout` 是否成功，发出请求后立即 `setCurrentUser(null)`，网络失败或服务端失败时会造成前端状态和真实 session 不一致。

## 关键证据

- `apps/web/src/App.tsx:135` — `async function logout(): Promise<void>` —— 登出逻辑集中在 App shell。
- `apps/web/src/App.tsx:137` — `await fetch("/api/auth/logout", { credentials: "same-origin", method: "POST" });` —— 没有检查 `response.ok`。
- `apps/web/src/App.tsx:141` — `setCurrentUser(null);` —— 无论登出请求是否成功都先清空本地用户。
- `apps/web/src/App.tsx:142` — `await loadMe();` —— 失败时依赖后续状态重载兜底，但重载本身也可能失败。

## 影响

用户可能以为已经登出，但服务端 session 仍有效。下一次刷新或 API 恢复后状态可能反跳，影响本地账号安全感和调试判断。

## 修复方向

检查 logout 响应；失败时保留当前用户并展示错误，成功后再清空用户并刷新 `me` 状态。

## 建议动作

`cs-issue`，因为这是认证状态一致性问题。
