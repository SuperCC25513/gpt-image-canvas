---
doc_type: audit-index
audit: 2026-05-28-backend-agent-runtime
scope: Backend Agent plan execution, WebSocket session lifecycle, selected references, skill import, and execution contracts.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-agent-runtime 审计报告

## 范围

本次审计覆盖 Agent 后端运行时：

- `apps/api/src/domain/agent/planner.ts`
- `apps/api/src/domain/agent/executor.ts`
- `apps/api/src/domain/agent/websocket-session.ts`
- `apps/api/src/domain/agent/skill-store.ts`
- `apps/api/src/server/routes/agent-ws.ts`
- `apps/api/src/server/routes/agent-skills.ts`
- `packages/shared/src/agent.ts`

## 总评

共发现 3 条问题：`bug` 1 条，`performance` 2 条；严重度为 P1 2 条、P2 1 条。Agent 的基础权限入口和断线清理有明确处理：WebSocket 先 `requireAuth`，断线后 active run 有 2 小时 grace，idle session 5 分钟回收，pending events 有 500 条上限。主要风险集中在客户端恢复计划绕过完整图校验、执行时全量 runnable job 并发，以及技能导入在限额检查前已经完整缓冲上传内容。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | medium | 客户端恢复计划只做浅校验，绕过 planner 的完整 DAG 校验 | [finding-01.md](finding-01.md) |
| 2 | performance | P1 | medium | Agent 执行会并发启动所有 runnable jobs，缺少全局 provider 并发上限 | [finding-02.md](finding-02.md) |
| 3 | performance | P2 | medium | 技能导入先完整读取 multipart 文件，大小限制生效过晚 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 0 | 1 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 1 | 1 | 2 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **1** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01 建议走 `cs-issue`，执行客户端恢复计划前复用完整 `validateGenerationPlan` 图校验；Finding 02 建议走 `cs-refactor`，给 Agent 执行器加全局 job 并发控制。
- **P2 有空再看**：Finding 03 建议走 `cs-refactor`，在 HTTP 层或 streaming 层提前限制上传大小。

