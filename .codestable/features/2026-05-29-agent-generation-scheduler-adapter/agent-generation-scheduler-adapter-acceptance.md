---
doc_type: feature-acceptance
feature: 2026-05-29-agent-generation-scheduler-adapter
status: accepted
summary: Agent 生成 job 已在 Redis 模式下接入现有 generation queue，并保留 inline/provider override direct path。
tags: [agent, generation, redis, queue, scheduler]
roadmap: generation-provider-scheduler
roadmap_item: agent-generation-scheduler-adapter
accepted_at: "2026-05-29"
---

## 1. 验收结论

`agent-generation-scheduler-adapter` 已完成。Redis driver 且未传 provider override 时，Agent job 现在通过 `startTextToImageGenerationTask` / `startReferenceImageGenerationTask` 创建 pending generation record 并复用现有 generation queue；Agent executor 等待 DB generation record 到 terminal 后回写 plan job。`GENERATION_QUEUE_DRIVER=inline` 或 fake provider override 继续走 direct path，保留现有 smoke 和本地调试语义。

## 2. Checklist 对照

- [x] 新增 Agent generation scheduler adapter，集中处理 queue/direct 分支判定。
- [x] Agent executor 在 Redis queue path 中保持 job `queued`，观察到 DB record `running` 或 terminal 后发送 `job_started`。
- [x] queue path 等待 DB terminal，并在 abort / run inactive 时调用 `cancelGenerationTask()`。
- [x] Redis queue payload 不包含 prompt、reference bytes、provider credential、audit payload、credit transaction 或完整 generation record。
- [x] inline / provider override path 保留 direct execution；`retry_failed`、DAG 依赖和既有 Agent smoke 仍通过。
- [x] 未新增 Agent 专用 Redis queue key、per-output Redis job、delayed queue、Agent run 重启恢复、Agent retrying 状态、前端 retrying UI 或 admin queue monitor。

## 3. 关键代码证据

- `apps/api/src/domain/agent/generation-scheduler-adapter.ts`：新增 adapter API，Redis/no provider override 调用 `start*GenerationTask` 入队并轮询 `readGenerationTaskRecord`，abort 时取消 generation。
- `apps/api/src/domain/agent/executor.ts`：不再总是提前创建 provider；按 adapter 判定 queue/direct path，并把 queued/running 状态映射到 Agent plan events。
- `apps/api/src/smoke/agent-generation-queue-smoke.ts`：覆盖 Agent Redis 入队、payload 安全边界、queued -> running event、terminal failed 收敛和 pending 取消清理。
- `apps/api/package.json`：新增 `smoke:agent-generation-queue`。

## 4. 验证记录

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:agent-generation-queue`
- [x] `USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:executor`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-queue`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:provider-retry`
- [x] `unset GENERATION_PROVIDER_GLOBAL_CONCURRENCY && GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `GENERATION_QUEUE_DRIVER=redis REDIS_URL=redis://127.0.0.1:6379 GENERATION_PROVIDER_GLOBAL_CONCURRENCY=1 pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:planner`
- [x] `docker compose config --quiet --no-env-resolution`
- [x] `redis-cli -h 127.0.0.1 -p 6379 zcard generation:provider:permits` -> `0`
- [x] `redis-cli -h 127.0.0.1 -p 6379 llen generation:queue:ready` -> `0`

## 5. 架构 / Roadmap 回写

- [x] `.codestable/architecture/ARCHITECTURE.md` 已记录 Agent generation scheduler adapter、scheduled Agent generation、queue/direct path 和并发边界。
- [x] `docs/RELIABILITY.md` 已记录 Agent Redis queue path、`AGENT_JOB_CONCURRENCY` 与 provider concurrency 的边界，以及 provider override / inline path。
- [x] `docs/SECURITY.md` 已记录 Agent queue path 复用 generation queue payload 安全边界。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml` 已把 `agent-generation-scheduler-adapter` 标记为 `done`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md` 已更新 Agent 接入协议、子 feature 状态和备注。

## 6. 剩余边界

- Agent run 重启恢复、per-output Redis job、delayed retry queue、取消恢复和队列可观测性仍未实现，继续留给 roadmap 后续 `generation-cancel-and-recovery` / `generation-queue-observability`。
- provider retry 的可见状态仍由 generation finish 流程收敛，不新增 Agent `retrying` plan 状态或前端 UI。
