---
doc_type: issue-fix
issue: 2026-05-28-mysql-agent-sqlite-proxy
path: fast-track
fix_date: 2026-05-28
tags: [mysql, agent, storage]
---

# MySQL 模式 Agent 路由 SQLite proxy 500 修复记录

## 1. 问题描述

审计发现 `USE_MYSQL=true` 时 Agent conversation 和 Agent skill 相关路由仍会访问 SQLite-only `db`，触发 `SQLite database access is unavailable when USE_MYSQL=true.` 并返回 500。

## 2. 根因

`database.ts` 在 MySQL 模式下把 `db` 替换为抛错 proxy；但 Agent conversation store 和 Agent skill store 没有 driver 分支。路由无条件注册后，只要调用这些 store，就会访问 proxy。

WebSocket Agent 规划也会读取 skill loadout，因此 skill store 的读路径不能只靠 HTTP 路由拦截。

## 3. 修复方案

Agent conversation 在 MySQL 模式下显式标记为不可用：HTTP 路由返回稳定 `501 agent_conversation_unsupported_storage`，WebSocket 上下文读取返回空、保存为 no-op，避免运行时 500。

Agent skill 在 MySQL 模式下保留内置技能的只读 fallback，保证 WebSocket planning 可以拿到 core skill；新增/编辑/import 返回稳定 `501 agent_skill_unsupported_storage`。

## 4. 改动文件清单

- `apps/api/src/domain/agent/conversation-store.ts`：增加 storage availability 判断；MySQL 下读上下文为空、写上下文 no-op、保存对话抛出稳定不可用错误。
- `apps/api/src/server/routes/agent-conversations.ts`：MySQL 下 conversation HTTP API 返回 `501 agent_conversation_unsupported_storage`。
- `apps/api/src/domain/agent/skill-store.ts`：MySQL 下 list/get/plan loadout 使用内置技能 fallback；写操作抛出 `agent_skill_unsupported_storage`。
- `apps/api/src/server/routes/agent-skills.ts`：MySQL 下 skill 写操作返回 501；错误码映射补充 501。
- `packages/shared/src/agent.ts`：补充 `agent_skill_unsupported_storage` 错误码类型。

## 5. 验证结果

- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:executor`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。

## 6. 遗留事项

当前修复选择稳定降级，而不是完整实现 MySQL Agent conversation/skill 持久化。若产品要求 MySQL 模式完整支持 Agent 历史和自定义 skills，需要另开 feature 或 issue 实现 MySQL store 分支。
