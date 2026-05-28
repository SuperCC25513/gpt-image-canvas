---
doc_type: audit-finding
audit: 2026-05-28-backend-agent-runtime
finding_id: "performance-02"
nature: performance
severity: P1
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 02：Agent 执行会并发启动所有 runnable jobs，缺少全局 provider 并发上限

## 速答

Agent executor 对当前所有 runnable jobs 直接 `Promise.all`，没有全局并发上限；一个包含 16 个独立 job 的合法计划会同时发起最多 16 个生成任务，绕过普通生成内部 `BATCH_CONCURRENCY = 2` 的节流效果。

## 关键证据

- `packages/shared/src/generation.ts:19` — `export const MAX_GENERATION_PLAN_IMAGES = 16;` —— 合法 Agent plan 最多 16 张图。
- `apps/api/src/domain/agent/executor.ts:115` — `const runnableJobs = plan.jobs.filter(...)` —— 每一轮取出所有可运行 job。
- `apps/api/src/domain/agent/executor.ts:137` — `await Promise.all(` —— 所有 runnable jobs 同时执行。
- `apps/api/src/domain/agent/executor.ts:138` — `runnableJobs.map((job) => executeGenerationJob(...))` —— 没有 `mapWithConcurrency` 或队列。
- `apps/api/src/domain/agent/executor.ts:216` — `const request = createJobImageProviderInput(...)` —— 每个 job 都会形成独立生成请求。
- `apps/api/src/domain/agent/executor.ts:219` — `await runReferenceImageGenerationTask(...)` —— 引用图 job 直接调用生成任务。
- `apps/api/src/domain/agent/executor.ts:230` — `: await runTextToImageGenerationTask(...)` —— 文生图 job 也直接调用生成任务。
- `apps/api/src/domain/generation/image-generation.ts:50` — `const BATCH_CONCURRENCY = 2;` —— 普通单 job 内部有并发上限，但 Agent 跨 job 没有统一上限。

## 影响

合法计划可以由 16 个 count=1 的独立 job 组成。当前实现会同时打到 image provider、积分扣费和资产写入链路，容易触发上游 rate limit、CPU/IO 峰值和 WebSocket 事件爆发。该风险在 Agent 规划多个独立候选图或多商品图时较高。

## 修复方向

给 `executeGenerationPlan` 增加全局 job 并发限制，例如 2-4 个 runnable job 同时运行；保留依赖拓扑顺序，但用队列消费 runnable jobs。

## 建议动作

`cs-refactor`，因为这是执行调度结构优化，不改变计划语义。

