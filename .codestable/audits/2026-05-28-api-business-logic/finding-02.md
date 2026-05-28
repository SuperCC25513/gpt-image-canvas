---
doc_type: audit-finding
audit: 2026-05-28-api-business-logic
finding_id: "bug-02"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 02：MySQL 模式下 Agent conversation/skill 路由会走 SQLite proxy 直接 500

## 速答

应用在 MySQL 模式下仍注册 Agent conversation 和 skill 路由，MySQL 初始化也创建了对应表，但 domain store 无条件使用 SQLite `db`；`USE_MYSQL=true` 时该 `db` 是抛错 proxy，调用这些 API 会进入全局 500。

## 关键证据

- `apps/api/src/server/app.ts:47` — `/api/agent-conversations` 路由无条件注册。
- `apps/api/src/server/app.ts:48` — `/api/agent-skills` 路由无条件注册。
- `apps/api/src/infrastructure/database.ts:15` — 非 SQLite 模式下导出的 `db` 是 `createUnavailableSqliteDatabase()`。
- `apps/api/src/infrastructure/database.ts:35` — 访问该 proxy 任意属性会抛出 `SQLite database access is unavailable when USE_MYSQL=true.`。
- `apps/api/src/domain/agent/conversation-store.ts:37` — Agent conversation 查询直接 `db.select()`，没有 MySQL 分支。
- `apps/api/src/domain/agent/skill-store.ts:73` — Agent skill 列表直接 `db.select()`，没有 MySQL 分支。
- `apps/api/src/infrastructure/mysql-database.ts:232` — MySQL 初始化声明 `agent_conversations` 表。
- `apps/api/src/infrastructure/mysql-database.ts:246` — MySQL 初始化声明 `agent_skills` 表，说明这些数据面并非完全不存在。

## 影响

MySQL 部署中，用户打开 Agent 历史、保存 Agent 对话、列出或编辑 Agent skills 时会触发服务端异常并返回 500。更隐蔽的是 WebSocket Agent 规划也会通过 skill loadout 读取 skill store，存在同类运行时失败风险。

## 修复方向

为 Agent conversation 和 skill store 补 MySQL 实现；如果当前版本不支持这些能力，则路由和 WebSocket 入口应显式返回稳定的 unsupported 错误，而不是访问 SQLite proxy。

## 建议动作

`cs-issue`，因为这是 MySQL 运行模式下的后端可用性 bug，触发路径明确且修复需要补 driver 分支或能力降级策略。
