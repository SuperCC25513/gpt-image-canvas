---
doc_type: feature-acceptance
feature: 2026-05-29-generation-cancel-and-recovery
status: accepted
summary: Redis generation queue 已具备 generation 级 pending 恢复、running interrupted 失败收敛和 terminal completion guard。
tags: [generation, redis, queue, recovery, credits]
roadmap: generation-provider-scheduler
roadmap_item: generation-cancel-and-recovery
accepted_at: "2026-05-29"
---

## 1. 验收结论

`generation-cancel-and-recovery` 已完成。Redis driver 启动现在先执行 generation state bridge：遗留 `running` record 失败收敛、audit 更新、积分幂等退款并清理 stale Redis job；仍为 `pending` 的 record 会从 DB routing 字段和 audit visibility 恢复到 ready queue。completion 持久化层新增 terminal guard，晚到的 finish 不能覆盖 cancelled / failed record，也不会落库新 outputs。

## 2. Checklist 对照

- [x] 新增 recovery record 查询、audit visibility 查询和 idempotent `ensureGenerationJobQueued()`。
- [x] Redis startup recovery 先 failed 收敛 running，再 requeue pending，最后启动 worker。
- [x] completion transaction 阻止 terminal record 被 late finish 覆盖，并清理未落库的成功 output bytes。
- [x] pending recovery payload 不包含 prompt、reference bytes、provider credential、audit payload、credit transaction 或完整 generation record。
- [x] audit visibility 缺失时按 private 恢复。
- [x] 未新增 per-output Redis job、delayed queue、attempt key、processing list、前端 UI 或 admin monitor。

## 3. 关键代码证据

- `apps/api/src/domain/generation/generation-state-bridge.ts`：集中实现 startup recovery orchestration。
- `apps/api/src/domain/generation/generation-queue.ts`：新增 `ensureGenerationJobQueued()`，对 ready list 去重后写入一条 entry。
- `apps/api/src/domain/storage/store.ts`：新增 recovery record 查询；`completeGenerationRecordWithOutputs()` 在事务内拦截 terminal record。
- `apps/api/src/domain/generation/image-generation.ts`：interrupted 收敛后按 generation id 更新 audit；completion skipped 时清理未落库 output assets。
- `apps/api/src/smoke/generation-recovery-smoke.ts`：覆盖 pending requeue、ready 去重、visibility fallback、running interrupted refund 幂等和 terminal guard。

## 4. 验证记录

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-recovery`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-queue`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:agent-generation-queue`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:provider-retry`
- [x] `unset GENERATION_PROVIDER_GLOBAL_CONCURRENCY && GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `GENERATION_QUEUE_DRIVER=redis REDIS_URL=redis://127.0.0.1:6379 GENERATION_PROVIDER_GLOBAL_CONCURRENCY=1 pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:executor`
- [x] `USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:planner`
- [x] `docker compose config --quiet --no-env-resolution`
- [x] `redis-cli -h 127.0.0.1 -p 6379 zcard generation:provider:permits` -> `0`
- [x] `redis-cli -h 127.0.0.1 -p 6379 llen generation:queue:ready` -> `0`

## 5. 架构 / Roadmap 回写

- [x] `.codestable/architecture/ARCHITECTURE.md` 已记录 generation state bridge、pending recovery、running interrupted 和 terminal guard。
- [x] `docs/RELIABILITY.md` 已记录 Redis startup recovery、running 不续跑和 terminal immutability。
- [x] `docs/SECURITY.md` 已记录 recovery payload 安全边界和 visibility fallback。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml` 已把 `generation-cancel-and-recovery` 标记为 `done`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md` 已同步子 feature 状态和备注。

## 6. 剩余边界

- per-output Redis job、`generation:queue:delayed`、`generation:attempt:*`、processing list、跨重启 provider call 续跑和队列可观测性仍未实现。
- 前端排队状态、admin queue monitor、retrying UI 和 Agent run 重启恢复仍由后续 `generation-queue-observability` 或单独 feature 处理。
