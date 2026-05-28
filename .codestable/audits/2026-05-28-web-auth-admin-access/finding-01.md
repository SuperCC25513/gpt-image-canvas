---
doc_type: audit-finding
audit: 2026-05-28-web-auth-admin-access
finding_id: "security-01"
nature: security
severity: P2
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 01：非管理员直接访问 /admin 仍会加载后台页面外壳

## 速答

顶部导航只对管理员显示后台入口，但 route 渲染没有用同一个管理员条件拦截；非管理员直接访问 `/admin/*` 时仍会加载 `AdminPage` 并触发后台请求。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:3417` — `const accountUser = accountStatus?.authenticated ? accountStatus.user : undefined;` —— 当前用户角色来自账号状态。
- `apps/web/src/features/canvas/CanvasApp.tsx:3418` — `const isCurrentUserAdmin = accountUser?.role === "admin";` —— 已有管理员判断。
- `apps/web/src/features/canvas/CanvasApp.tsx:2772` — `{isAdmin ? ( <a ... href={pathForAdminTab(DEFAULT_ADMIN_TAB)} ...>` —— 导航层只在 `isAdmin` 时显示后台入口。
- `apps/web/src/features/canvas/CanvasApp.tsx:6343` — `{route === "admin" ? ( ... <LazyAdminPage ... currentUser={accountUser} ... /> ) : null}` —— route 渲染没有检查 `isCurrentUserAdmin`。

## 影响

后端应继续作为真实权限边界，但前端会对非管理员暴露后台页面结构、触发多条 401/403 请求，并给本地工作站 auth 边界造成误导。

## 修复方向

在 route 层对 `route === "admin"` 增加管理员 guard：非管理员直接重定向或显示无权限状态，并避免预加载/发起后台 API。

## 建议动作

`cs-issue`，因为这是前端权限体验和防御纵深缺口。
