---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "03"
slug: backend-agent-runtime
status: completed
priority: P1
recommended_dimensions:
  - bug
  - performance
  - maintainability
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-agent-runtime/
---

# Task 03：Agent 规划/执行/WebSocket

## 目标产物

`.codestable/audits/2026-05-28-backend-agent-runtime/`

## 路径

- `apps/api/src/domain/agent/planner.ts`
- `apps/api/src/domain/agent/executor.ts`
- `apps/api/src/domain/agent/websocket-session.ts`
- `apps/api/src/domain/agent/conversation-store.ts`
- `apps/api/src/domain/agent/skill-store.ts`
- `apps/api/src/domain/agent/config.ts`
- `apps/api/src/server/routes/agent-ws.ts`
- `apps/api/src/server/routes/agent-conversations.ts`
- `apps/api/src/server/routes/agent-skills.ts`
- `apps/api/src/server/routes/agent-config.ts`
- `packages/shared/src/agent.ts`

## 业务含义

负责 Agent LLM 配置、计划生成、DAG 校验、任务执行、技能管理、会话存储和 WebSocket 实时事件。

## 风险理由

该模块代码量最大，包含长连接、状态机、DAG、重试/取消、文件导入和跨端事件契约。错误通常不是单点异常，而是状态不一致或恢复路径不可观察。

## 推荐审计维度

- `bug`：计划校验、依赖关系、取消/重试、连接断开、会话恢复。
- `performance`：内存中 session/map 清理、长连接事件积压、重复 provider 调用。
- `maintainability`：超长函数、高复杂度、跨文件隐式耦合、重复事件转换。

## 重点检查

- DAG 计划是否在执行前完整校验。
- 下游引用的 source job 是否强制 `count=1`。
- 失败 job 重试是否避免重跑成功上游。
- WebSocket 断开后是否清理 session 和 pending 状态。
- 技能导入是否限制大小、格式和错误输出。

## 不做

不评估 Agent prompt 质量；不改 planner 策略。
