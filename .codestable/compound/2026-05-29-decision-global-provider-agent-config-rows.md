---
doc_type: decision
category: architecture
date: 2026-05-29
slug: global-provider-agent-config-rows
status: active
area: provider-agent-config
tags: [provider, agent, mysql, sqlite, codex]
---

# Provider 和 Agent 配置使用全局配置行

## 背景

系统页面需要保存图片生成 provider、Codex fallback 和 Agent LLM 配置。SQLite 模式已有 `provider_configs`、`agent_llm_configs` 和 `codex_oauth_tokens` 的全局行语义；MySQL 模式需要补齐同等持久化能力，让系统页面配置在 MySQL + OSS 部署下也生效。

## 决定

Provider、Agent LLM 和 Codex OAuth 配置继续使用 admin-only 的工作站级全局配置行：

- `provider_configs.id = "active"`
- `agent_llm_configs.id = "active"`
- `codex_oauth_tokens.id = "default"`

SQLite 与 MySQL 共享同一语义。切换数据库驱动时不自动迁移这些配置；管理员需要在系统页面重新保存 provider/Agent 设置，并重新登录 Codex fallback。

## 理由

- 当前产品语义是本地工作站的全局生成服务配置，不是每个用户各自选择 provider 或 Agent 模型。
- 现有 `/api/provider-config`、`/api/agent-config` 和 Codex login/logout 已是 admin-only，继续读取全局行能保持调用方契约稳定。
- 图片生成和 Agent 规划运行时都需要一个明确的当前可用配置；全局 active/default 行能避免把用户上下文引入 provider selection 和 Agent WebSocket。
- SQLite 和 MySQL 使用同名同语义表，比引入新的 JSON settings 或按 driver 分叉概念更容易维护。

## 考虑过的替代方案

- **per-user 配置**：没有采用。它会要求 generation、Agent executor、provider selection 和 Codex fallback 都按当前用户路由配置，超出本次能力边界。
- **把配置塞进 `app_settings` JSON**：没有采用。它会把 secret、source order、Agent 模型和注册/积分等系统设置混在一起，数据归属变差。
- **自动从 SQLite 迁移到 MySQL**：没有采用。运行时只连接当前 driver，跨库迁移需要单独的数据迁移流程和凭据边界。

## 后果

- 系统页面保存后，所有用户的图片生成和 Agent 规划都读取同一组 provider/Agent/Codex 配置。
- 后续如果要做用户级 provider 或 Agent 模型选择，需要单独设计用户级配置表、鉴权和运行时上下文，不应在当前 active/default 行上追加兼容分支。
- 部署从 SQLite 切到 MySQL 后，需要明确告知管理员重新保存 provider/Agent 设置并重新登录 Codex fallback。

## 相关文档

- `.codestable/architecture/ARCHITECTURE.md`
- `.codestable/requirements/system-provider-configuration.md`
- `.codestable/features/2026-05-29-mysql-provider-agent-config/mysql-provider-agent-config-design.md`
- `.codestable/features/2026-05-29-mysql-provider-agent-config/mysql-provider-agent-config-acceptance.md`
