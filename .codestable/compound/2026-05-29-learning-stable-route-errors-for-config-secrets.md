---
doc_type: learning
track: pitfall
date: 2026-05-29
slug: stable-route-errors-for-config-secrets
component: api-config-routes
severity: medium
tags: [api, security, provider, agent, mysql]
---

# 配置保存路由不要透出底层异常

## 问题

provider config 和 Agent LLM config 保存路径会处理 API key、Base URL、OAuth session 状态和数据库写入。验收 MySQL 持久化时发现，route catch 如果直接把底层 `error.message` 包进响应，数据库连接、SQL 细节或其他内部异常文本有机会被前端看到。

## 症状

- `PUT /api/provider-config` 和 `PUT /api/agent-config` 的保存失败响应会沿用通用 `errorToMessage(error)`。
- 这类 route 面向 admin，但仍不应该把 SQL error、连接信息、secret 相关上下文作为 API 响应返回。
- 方案约束要求“数据库写失败折叠为 route 当前稳定错误，不返回 SQL、连接串或 secret”。

## 没用的做法

继续复用通用 `errorToMessage()` 省事，但不适合保存 secret 的配置路由。通用错误转换能保留调试信息，却会削弱配置类 API 的脱敏边界。

## 解法

配置保存 route 的 catch 只返回稳定业务错误：

- provider config：`provider_config_error` + `Provider config could not be saved.`
- Agent LLM config：`agent_config_error` + `Agent LLM config could not be saved.`

具体改动落在：

- `apps/api/src/server/routes/provider-config.ts`
- `apps/api/src/server/routes/agent-config.ts`

## 为什么有效

payload 校验错误仍由 validation 层返回明确错误码；真正进入保存阶段后的异常统一收敛成固定文案。这样既保留了前端可处理的业务错误类型，也避免把底层 DB/SQL/secret 相关文本暴露到 API response。

## 预防

以后新增保存 secret、token、连接串、provider credential 或部署配置的 route 时，不要直接把底层异常 message 返回给客户端。优先使用稳定错误码和稳定文案；需要排查时走服务端日志或受控调试路径。

## 相关文档

- `.codestable/features/2026-05-29-mysql-provider-agent-config/mysql-provider-agent-config-design.md`
- `.codestable/features/2026-05-29-mysql-provider-agent-config/mysql-provider-agent-config-acceptance.md`
