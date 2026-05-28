---
doc_type: audit-finding
audit: 2026-05-28-backend-agent-runtime
finding_id: "bug-01"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：客户端恢复计划只做浅校验，绕过 planner 的完整 DAG 校验

## 速答

WebSocket 执行计划时，如果 session 内没有已存 plan，会接受客户端随消息带回的 `message.plan`；该路径只调用 `isExecutableGenerationPlan` 做浅结构校验，没有复用 planner 的 `validateGenerationPlan` 图校验，可能执行缺少 dependency edge 的 generated-output 计划。

## 关键证据

- `apps/api/src/domain/agent/websocket-session.ts:1176` — `const storedPlan = session.plans.get(message.planId);` —— 优先取 session 内 plan。
- `apps/api/src/domain/agent/websocket-session.ts:1184` — `if (!message.plan || message.plan.id !== message.planId || !isExecutableGenerationPlan(message.plan))` —— session miss 时只用 `isExecutableGenerationPlan` 接受客户端 plan。
- `apps/api/src/domain/agent/websocket-session.ts:1188` — `const restoredPlan: StoredAgentGenerationPlan = { plan: message.plan, ... }` —— 通过浅校验后直接恢复为可执行 plan。
- `apps/api/src/domain/agent/executor.ts:56` — `export function isExecutableGenerationPlan(value: unknown)` —— executor 自己的运行时类型检查入口。
- `apps/api/src/domain/agent/executor.ts:77` — `executionPlanWithinBounds(...)` —— 只检查总数量、引用数量和 source job count。
- `apps/api/src/domain/agent/executor.ts:683` — `function executionPlanWithinBounds(...)` —— 没有检查 edge 两端是否存在、generated_output 引用是否有匹配 edge、是否有环。
- `apps/api/src/domain/agent/planner.ts:1221` — `if (issues.length === 0) { validatePlanGraph(...) }` —— planner 正常输出路径会做完整图校验。
- `apps/api/src/domain/agent/planner.ts:1841` — `if (!edges.some((edge) => edge.fromJobId === sourceJobId && edge.toJobId === job.id))` —— 完整校验明确要求 generated_output 引用必须有匹配 dependency edge。
- `apps/api/src/domain/agent/executor.ts:115` — `const runnableJobs = plan.jobs.filter((job) => job.status === "queued" && dependenciesSucceeded(...))` —— 执行器只根据 edges 判断可运行。
- `apps/api/src/domain/agent/executor.ts:343` — `const sourceJob = reference.jobId ? plan.jobs.find(...) : undefined` —— 缺少匹配 edge 时，下游 job 可能提前运行，再因 source output 缺失失败。

## 影响

浏览器重连或画布节点回放时，客户端带回的 plan 可能不是 planner 刚校验过的对象。若 generated_output reference 没有 matching edge，执行器会把下游 job 当作无依赖任务提前执行，随后报 “Generated reference has no available output”。结果是用户看到计划失败，而不是在执行前得到可恢复的校验错误。

## 修复方向

在 `resolveStoredPlanForExecution` 接受 `message.plan` 前复用 `validateGenerationPlan` 的图校验，或把完整 graph validation 抽成 executor 可调用的共享函数。

## 建议动作

`cs-issue`，因为这是执行前校验缺口，会把无效计划推进到运行时失败。

