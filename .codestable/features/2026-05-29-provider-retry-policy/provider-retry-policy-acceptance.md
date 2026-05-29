---
doc_type: feature-acceptance
feature: 2026-05-29-provider-retry-policy
status: accepted
summary: Provider 可恢复错误已按统一策略退避重试，耗尽后写稳定失败摘要。
tags: [generation, provider, retry, redis, reliability]
roadmap: generation-provider-scheduler
roadmap_item: provider-retry-policy
accepted_at: "2026-05-29"
---

## 1. 验收结论

`provider-retry-policy` 已完成。单图 `generate` / `edit` provider call 现在通过 `runProviderCallWithRetry` 执行；429、408、5xx、连接超时和临时网络错误会按指数退避 + jitter 重试，重试 attempt 会重新进入 `runProviderCall`，退避 sleep 不占 provider permit。不可重试错误保持原业务语义，retryable 错误耗尽后写稳定失败摘要。

## 2. Checklist 对照

- [x] 新增 retry config、decision 类型、分类函数和 retry wrapper。
- [x] 单图 generate/edit provider call 改为 retry wrapper，每次 attempt 重新进入 `runProviderCall`。
- [x] retryable 错误耗尽后抛稳定 `ProviderError`，不透出 secret-like 上游详情。
- [x] `.env.example`、`docker-compose.yml`、`docs/RELIABILITY.md`、`docs/SECURITY.md` 已记录 retry 配置和边界。
- [x] 未新增 `generation:queue:delayed`、`generation:attempt:*` 或 per-output Redis job。
- [x] 未改 Agent executor 的 `retry_failed` 用户操作语义。
- [x] 未改积分价格、最大图片数、退款规则或生成记录表结构。

## 3. 关键代码证据

- `apps/api/src/domain/generation/provider-retry-policy.ts`：集中实现配置解析、错误分类、退避 delay、abort 处理和稳定失败摘要。
- `apps/api/src/domain/generation/image-generation.ts`：`generateSingleOutput` / `editSingleOutput` 改为调用 `runProviderCallWithRetry`。
- `apps/api/src/smoke/provider-retry-policy-smoke.ts`：覆盖默认/非法配置、retryable/non-retryable 分类、成功重试、退避释放 permit、取消中断和最终失败摘要。
- `apps/api/package.json`：新增 `smoke:provider-retry`。

## 4. 验证记录

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:provider-retry`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-queue`
- [x] `GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `GENERATION_QUEUE_DRIVER=redis REDIS_URL=redis://127.0.0.1:6379 GENERATION_PROVIDER_GLOBAL_CONCURRENCY=1 pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:executor`
- [x] `USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline pnpm --filter @gpt-image-canvas/api smoke:planner`
- [x] `docker compose config --quiet --no-env-resolution`
- [x] `redis-cli -h 127.0.0.1 -p 6379 zcard generation:provider:permits` -> `0`
- [x] `redis-cli -h 127.0.0.1 -p 6379 llen generation:queue:ready` -> `0`

## 5. 架构 / Roadmap 回写

- [x] `.codestable/architecture/ARCHITECTURE.md` 已记录 provider retry policy、配置和剩余边界。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml` 已把 `provider-retry-policy` 标记为 `done`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md` 已更新子 feature 状态和备注。

## 6. 剩余边界

- per-output Redis job、`generation:queue:delayed`、`generation:attempt:*`、重启后继续剩余退避、取消恢复和 retry 可观测性仍未实现。
- Agent 生成接入同一队列仍由后续 `agent-generation-scheduler-adapter` 处理。
