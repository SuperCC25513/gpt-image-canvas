---
doc_type: audit-finding
audit: 2026-05-28-backend-admin-settings-audits
finding_id: "bug-02"
nature: bug
severity: P2
confidence: high
suggested_action: cs-refactor
status: fixed
---

# Finding 02：后台用户和 audit 列表只有 limit，没有 offset/cursor，超过上限的数据不可达

## 速答

后台用户列表最多返回 100 条，generation audit 最多返回 200 条，但接口和共享响应都没有 cursor、offset、page 或 `hasMore`；数据量超过上限后，管理员无法通过 API 获取更早记录。

## 关键证据

- `apps/api/src/server/routes/admin.ts:28` — `await listAdminUsers({ query: c.req.query("q"), limit: parseLimit(c.req.query("limit")) })` —— 用户列表只接收 query 和 limit。
- `apps/api/src/domain/admin/admin-store.ts:113` — `const limit = clampLimit(input.limit, 100);` —— 用户列表最多 100 条。
- `apps/api/src/domain/admin/admin-store.ts:122` — `.orderBy(desc(users.createdAt)).limit(limit)` —— SQLite 只截取最新 N 条。
- `apps/api/src/domain/admin/admin-store.ts:138` — `ORDER BY created_at DESC LIMIT ${limit}` —— MySQL 同样只截取最新 N 条。
- `apps/api/src/server/routes/admin.ts:120` — `await listGenerationAudits({ limit: parseLimit(c.req.query("limit")) })` —— audit 列表只接收 limit。
- `apps/api/src/domain/admin/admin-store.ts:37` — `const MAX_ADMIN_AUDIT_LIMIT = 200;` —— audit 查询最大 200 条。
- `apps/api/src/domain/admin/admin-store.ts:333` — `.orderBy(desc(generationAudits.createdAt)).limit(limit).all()` —— SQLite audit 查询无翻页参数。
- `packages/shared/src/admin.ts:8` — `export interface AdminUsersResponse { users: AdminUserSummary[]; }` —— 响应没有分页元数据。
- `packages/shared/src/admin.ts:80` — `export interface AdminGenerationAuditsResponse { items: AdminGenerationAuditRecord[]; }` —— audit 响应也没有分页元数据。

## 影响

一旦本地运行时间较长或多人使用，后台只能看到最新 100 个用户和最新 200 条 generation audit。旧用户仍可通过精确搜索命中，但没有完整遍历能力；旧 audit 没有搜索条件，超过上限后基本不可达，影响问题追踪和合规排查。

## 修复方向

给用户列表和 audit 列表增加 cursor 或 offset 参数，并在响应中返回 `nextCursor` / `hasMore`；audit 可以以 `(createdAt, id)` 做稳定游标。

## 建议动作

`cs-refactor`，因为这是列表查询能力补齐，行为向后兼容。
