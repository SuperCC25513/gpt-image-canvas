---
doc_type: audit-index
audit: 2026-05-28-backend-generation-credits
scope: Backend image generation routes, generation task lifecycle, credit reservation/refund, generation storage, provider error handling, and generation audits.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-generation-credits 审计报告

## 范围

本次审计覆盖图片生成、任务生命周期、积分扣退和 generation audit：

- `apps/api/src/server/routes/images.ts`
- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/domain/generation/generation-tasks.ts`
- `apps/api/src/domain/credits/credit-store.ts`
- `apps/api/src/domain/storage/store.ts`
- `apps/api/src/domain/admin/audit-store.ts`
- `apps/api/src/infrastructure/providers/image-provider.ts`
- `apps/api/src/infrastructure/providers/codex-image-provider.ts`

对照文档：

- `docs/RELIABILITY.md`
- `docs/SECURITY.md`

## 总评

共发现 3 条问题：`bug` 2 条，`security` 1 条；严重度为 P1 2 条、P2 1 条。积分预扣、失败退款和部分失败退款整体按事务写入 `users.credits` 与 `credit_transactions`，且用同一 generation id 的 charge/refund 保持幂等。主要风险集中在 generation audit 起始写入失败后的最终状态补写缺失、上游 provider 错误信息净化不足，以及取消时可能产生未关联资产。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | medium | audit start 失败后，最终成功/失败路径不会补建 generation audit | [finding-01.md](finding-01.md) |
| 2 | security | P1 | medium | OpenAI/custom provider 原始错误可进入用户响应或生成历史 | [finding-02.md](finding-02.md) |
| 3 | bug | P2 | medium | 取消发生在输出保存后时会留下未关联资产 bytes | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 1 | 2 |
| security | 0 | 1 | 0 | 1 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **1** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01 建议走 `cs-issue`，让最终审计更新具备 upsert/backfill 语义；Finding 02 建议走 `cs-issue`，统一 provider 错误净化。
- **P2 有空再看**：Finding 03 建议走 `cs-refactor`，给取消后的资产保存/清理建立明确策略。

