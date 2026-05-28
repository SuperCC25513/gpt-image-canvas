---
doc_type: audit-finding
audit: 2026-05-28-backend-provider-agent-config
finding_id: "arch-drift-03"
nature: arch-drift
severity: P2
confidence: high
suggested_action: cs-refactor
status: fixed
---

# Finding 03：MySQL 初始化了 provider/Agent 配置表，但配置域逻辑完全不读写 MySQL

## 速答

MySQL schema 创建了 `provider_configs` 和 `agent_llm_configs`，但 provider/Agent 配置域服务在非 SQLite 模式下直接返回空行或抛错；因此 MySQL 下这些配置表不可达，Agent LLM 配置也无法启用。

## 关键证据

- `apps/api/src/infrastructure/mysql-database.ts:202` — `name: "provider_configs"` —— MySQL 初始化 provider 配置表。
- `apps/api/src/infrastructure/mysql-database.ts:217` — `name: "agent_llm_configs"` —— MySQL 初始化 Agent LLM 配置表。
- `apps/api/src/domain/providers/provider-config.ts:138` — `function getProviderConfigRow(): ProviderConfigRow | undefined {` —— provider 配置读取入口。
- `apps/api/src/domain/providers/provider-config.ts:139` — `if (databaseDriver !== "sqlite") { return undefined; }` —— MySQL 下完全不读 `provider_configs`。
- `apps/api/src/domain/providers/provider-config.ts:55` — `export function saveProviderConfig(...)` —— provider 配置保存入口。
- `apps/api/src/domain/providers/provider-config.ts:56` — `if (databaseDriver !== "sqlite") { throw new Error("MySQL 模式当前只支持环境变量 provider 配置。"); }` —— MySQL 下无法保存。
- `apps/api/src/domain/agent/config.ts:87` — `function getAgentLlmConfigRow(): AgentLlmConfigRow | undefined {` —— Agent 配置读取入口。
- `apps/api/src/domain/agent/config.ts:88` — `if (databaseDriver !== "sqlite") { return undefined; }` —— MySQL 下完全不读 `agent_llm_configs`。
- `apps/api/src/domain/agent/config.ts:43` — `if (databaseDriver !== "sqlite") { throw new Error("MySQL 模式当前只支持环境变量图片 provider；Agent LLM 配置仍需后续任务接入。"); }` —— MySQL 下无法保存 Agent LLM 配置。
- `apps/api/src/domain/agent/websocket-session.ts:364` — `const llmConfig = getUsableAgentLlmConfig();` —— Agent 执行只依赖该配置读取。
- `apps/api/src/domain/agent/websocket-session.ts:367` — `code: "missing_agent_config"` —— MySQL 下会一直表现为未配置。

## 影响

MySQL 部署会看到数据库里存在配置表，但 API 层无法读写这些表。图片 provider 只能使用环境变量，local OpenAI-compatible 配置和 source order 无效；Agent LLM 没有环境变量 fallback，导致 Agent 无法使用。这会让 schema、文档和运行时能力产生误导。

## 修复方向

二选一收敛：要么补齐 MySQL 读写实现和初始化默认行，要么明确 MySQL 暂不支持本地 provider/Agent 配置，并移除或标注不可用表，避免持久化层暴露假能力。

## 建议动作

`cs-refactor`，因为这是持久化能力与域逻辑的架构漂移，需要统一 SQLite/MySQL 配置访问边界。
