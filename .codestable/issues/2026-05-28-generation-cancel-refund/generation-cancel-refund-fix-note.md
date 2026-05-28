---
doc_type: issue-fix
issue: 2026-05-28-generation-cancel-refund
path: fast-track
fix_date: 2026-05-28
tags: [generation, credits, cancellation]
---

# 成功生成取消误退款修复记录

## 1. 问题描述

审计发现 `POST /api/generations/:id/cancel` 可对已成功的历史生成触发退款。成功记录本应保持终态，不应再写 `generation_refund`。

## 2. 根因

`cancelGenerationRecord` 调用 `updateGenerationRecordStatus` 后，只要拿到 record 就执行退款；而 `updateGenerationRecordStatus` 遇到 `succeeded` 等终态记录会直接返回 existing record，导致外层把成功记录当作取消成功处理。

同类风险也存在于 `failGenerationRecord`：如果终态记录进入失败路径，也可能被当作失败记录退款。

## 3. 修复方案

在取消和失败入口先读取 generation owner/status，只有非终态记录才允许进入状态更新与退款逻辑。终态记录直接按权限返回原记录，不触发退款或审计状态更新。

## 4. 改动文件清单

- `apps/api/src/domain/generation/image-generation.ts`：取消/失败入口增加 owner 权限和终态短路；退款只在最终状态确认为 `cancelled` / `failed` 时执行。
- `apps/api/src/domain/storage/store.ts`：将 `GenerationRecordOwner.status` 收窄为 `GenerationStatus`。
- `apps/api/src/smoke/agent-executor-smoke.ts`：增加成功生成调用 cancel 不改状态、不退积分、不写退款流水的回归断言。

## 5. 验证结果

- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:executor`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。

## 6. 遗留事项

无。
