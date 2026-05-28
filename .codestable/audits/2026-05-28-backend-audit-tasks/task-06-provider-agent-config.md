---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "06"
slug: backend-provider-agent-config
status: completed
priority: P1
recommended_dimensions:
  - security
  - bug
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-provider-agent-config/
---

# Task 06：Provider 配置 + Agent LLM 配置

## 目标产物

`.codestable/audits/2026-05-28-backend-provider-agent-config/`

## 路径

- `apps/api/src/server/routes/provider-config.ts`
- `apps/api/src/server/routes/agent-config.ts`
- `apps/api/src/domain/providers/provider-config.ts`
- `apps/api/src/domain/providers/image-provider-selection.ts`
- `apps/api/src/domain/agent/config.ts`
- `apps/api/src/infrastructure/providers/image-provider.ts`
- `apps/api/src/infrastructure/providers/codex-image-provider.ts`
- `packages/shared/src/provider-config.ts`
- `packages/shared/src/agent.ts`

## 业务含义

负责 OpenAI-compatible 图像 provider、本地保存配置、环境变量配置、Codex fallback，以及 Agent LLM 独立配置。

## 风险理由

配置里含 API key、base URL、模型名和 OAuth fallback。mask/preserve 语义、配置来源优先级和错误处理如果不一致，可能造成 secret 丢失、误用 provider 或响应泄密。

## 推荐审计维度

- `security`：secret mask/preserve、响应脱敏、日志、上游错误、OAuth fallback。
- `bug`：provider source order、空值保存、Agent LLM 与图像 provider 混用、配置校验。

## 重点检查

- provider 来源顺序是否仍是 env -> local config -> Codex login fallback。
- 读取 API 是否只返回 masked secret。
- 更新 API 是否只在明确 preserve 或 masked 值未变时保留旧 secret。
- Agent LLM 配置是否不误用图像 provider 配置。
- 上游错误是否避免带出 credential-bearing URL 或 headers。

## 不做

不评估具体模型选择；不调用真实 provider。
