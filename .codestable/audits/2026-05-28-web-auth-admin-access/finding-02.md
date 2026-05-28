---
doc_type: audit-finding
audit: 2026-05-28-web-auth-admin-access
finding_id: "bug-02"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 02：多个后台响应被泛型强转后直接写入高权限状态

## 速答

`adminRequest<T>` 返回值直接 `as T`，用户、系统设置、积分调整等高权限路径没有像兑换码列表那样做运行时结构校验。

## 关键证据

- `apps/web/src/features/admin/AdminPage.tsx:206` — `adminRequest<AdminUserResponse>(/api/admin/users/${...})` —— 用户更新响应直接声明类型。
- `apps/web/src/features/admin/AdminPage.tsx:212` — `setUsers((items) => items.map(... body.user ...))` —— 未校验 `body.user` 就写入用户表。
- `apps/web/src/features/admin/AdminPage.tsx:268` — `adminRequest<AdminSettingsResponse>("/api/admin/settings", ...)` —— 系统设置保存响应也直接声明类型。
- `apps/web/src/features/admin/AdminPage.tsx:274` — `setSettings(body.settings);` —— 未校验 settings shape。
- `apps/web/src/features/admin/AdminPage.tsx:1137` — `return (await response.json()) as T;` —— 泛型 helper 没有 guard。

## 影响

如果 API 版本漂移、错误代理返回非预期 JSON，后台 UI 可能把畸形数据写入用户、积分或系统设置视图，进一步诱发错误操作。

## 修复方向

为 `AdminUserResponse`、`AdminSettingsResponse`、`AdminCreditAdjustmentResponse` 等关键响应补运行时 guard，或把 shared 契约升级为可复用解析器。

## 建议动作

`cs-issue`，因为这是后台高权限数据边界的运行时 bug 风险。
