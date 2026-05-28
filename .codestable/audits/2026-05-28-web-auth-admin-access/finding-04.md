---
doc_type: audit-finding
audit: 2026-05-28-web-auth-admin-access
finding_id: "maintainability-04"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: deferred
---

# Finding 04：AdminPage 单文件承载五类后台子系统

## 速答

`AdminPage.tsx` 同时处理用户、兑换码、Provider、生成审计和系统设置，数据加载、mutations 和 UI 都在一个 1k+ 行文件里。

## 关键证据

- `apps/web/src/features/admin/AdminPage.tsx:120` — `loadUsers` 管用户列表。
- `apps/web/src/features/admin/AdminPage.tsx:144` — `loadSettings` 管系统设置。
- `apps/web/src/features/admin/AdminPage.tsx:157` — `loadAudits` 管生成审计列表。
- `apps/web/src/features/admin/AdminPage.tsx:173` — `loadRedemptionCodes` 管兑换码。
- `apps/web/src/features/admin/AdminPage.tsx:440` — tablist 同时列出 users、redemptionCodes、providers、audits、settings。

## 影响

后台每个子系统都带独立权限、错误和数据 shape，聚在单文件后局部修改容易牵动无关 state，也让审计和测试难以按业务域切片。

## 修复方向

按 tab 提取 `AdminUsersPanel`、`AdminSettingsPanel`、`AdminRedemptionCodesPanel` 和 `AdminGenerationAuditsPanel`，保留 `AdminPage` 只做 tab 编排。

## 建议动作

`cs-refactor`，因为这是行为不变的结构整理。
