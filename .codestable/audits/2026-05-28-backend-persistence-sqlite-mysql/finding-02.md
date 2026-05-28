---
doc_type: audit-finding
audit: 2026-05-28-backend-persistence-sqlite-mysql
finding_id: "arch-drift-02"
nature: arch-drift
severity: P2
confidence: high
suggested_action: cs-refactor
status: fixed
---

# Finding 02：MySQL 初始化 provider/Agent 配置表和默认行，但域层完全不读写这些表

## 速答

MySQL schema 会创建 `provider_configs`、`agent_llm_configs` 并插入 `active` 默认行；但 provider 和 Agent 配置域服务在非 SQLite 模式下直接返回空或抛错，导致这些 MySQL 表是不可达的假能力。

## 关键证据

- `apps/api/src/infrastructure/mysql-database.ts:202` — `name: "provider_configs"` —— MySQL schema 定义 provider 配置表。
- `apps/api/src/infrastructure/mysql-database.ts:217` — `name: "agent_llm_configs"` —— MySQL schema 定义 Agent LLM 配置表。
- `apps/api/src/infrastructure/mysql-database.ts:489` — `await ensureProviderConfigRow(pool);` —— MySQL 初始化会插入 provider 默认行。
- `apps/api/src/infrastructure/mysql-database.ts:490` — `await ensureAgentLlmConfigRow(pool);` —— MySQL 初始化会插入 Agent 默认行。
- `apps/api/src/infrastructure/mysql-database.ts:731` — `async function ensureProviderConfigRow(pool: Pool)` —— 默认行写入 `provider_configs`。
- `apps/api/src/infrastructure/mysql-database.ts:740` — `async function ensureAgentLlmConfigRow(pool: Pool)` —— 默认行写入 `agent_llm_configs`。
- `docs/SECURITY.md:19` — 安全文档说 Local provider config stored in SQLite。
- `docs/SECURITY.md:22` — 安全文档说 Agent LLM config stored in SQLite。
- `apps/api/src/domain/providers/provider-config.ts:139` — `if (databaseDriver !== "sqlite") { return undefined; }` —— provider 读取不读 MySQL 表。
- `apps/api/src/domain/providers/provider-config.ts:56` — `if (databaseDriver !== "sqlite") { throw new Error("MySQL 模式当前只支持环境变量 provider 配置。"); }` —— provider 保存不写 MySQL 表。
- `apps/api/src/domain/agent/config.ts:88` — `if (databaseDriver !== "sqlite") { return undefined; }` —— Agent config 读取不读 MySQL 表。
- `apps/api/src/domain/agent/config.ts:43` — `if (databaseDriver !== "sqlite") { throw new Error(...) }` —— Agent config 保存不写 MySQL 表。

## 影响

MySQL 数据库结构看起来支持本地 provider 配置和 Agent LLM 配置，但运行时完全忽略这些表。运维或后续开发会误以为可以通过 MySQL 表恢复/迁移这些配置；实际 MySQL 模式只能使用环境变量图片 provider，Agent LLM 配置不可用。

## 修复方向

把能力边界收敛到一个方向：若 MySQL 需要支持这些配置，补齐 domain 层 MySQL CRUD；若暂不支持，从 MySQL schema/default row/docs 中移除或显式标注“预留未启用”，避免假表误导。

## 建议动作

`cs-refactor`，因为这是 schema 与运行时能力的架构漂移。
