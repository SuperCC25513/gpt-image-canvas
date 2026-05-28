---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "02"
slug: backend-generation-credits
status: completed
priority: P0
recommended_dimensions:
  - bug
  - security
  - performance
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-generation-credits/
---

# Task 02：图片生成 + 积分扣退 + 生成记录

## 目标产物

`.codestable/audits/2026-05-28-backend-generation-credits/`

## 路径

- `apps/api/src/server/routes/images.ts`
- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/domain/generation/generation-tasks.ts`
- `apps/api/src/domain/credits/credit-store.ts`
- `apps/api/src/domain/storage/store.ts`
- `apps/api/src/domain/admin/audit-store.ts`
- `apps/api/src/infrastructure/providers/image-provider.ts`
- `apps/api/src/infrastructure/providers/codex-image-provider.ts`

## 业务含义

负责文生图、参考图生成、生成任务生命周期、取消、生成记录、输出资产、积分预扣和失败退款。

## 风险理由

这里串起 provider 调用、异步任务、资产落库、积分流水和 generation audit。任一环节顺序错误都可能导致扣费不一致、成功记录找不到资产、失败不退款、审计状态不完整或上游错误泄露。

## 推荐审计维度

- `bug`：预扣/退款事务、部分失败、取消、重试、任务 map 清理、生成记录状态。
- `security`：prompt 和 provider 错误入库/响应时是否泄露凭据或内部细节。
- `performance`：批量生成并发、参考图读取、同步 CPU/IO 热点。

## 重点检查

- `users.credits` 和 `credit_transactions` 是否总在同一事务中更新。
- 全失败、部分失败、取消和异常路径是否有幂等退款。
- 生成成功前是否确认资产 bytes 已写入本地或 OSS。
- `generation_audits` 是否在成功、失败、取消和重启中断路径尽力更新。
- provider 原始错误是否被稳定错误码包裹。

## 不做

不审计前端生成面板；不压测 provider。
