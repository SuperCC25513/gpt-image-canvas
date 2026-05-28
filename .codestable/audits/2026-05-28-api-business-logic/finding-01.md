---
doc_type: audit-finding
audit: 2026-05-28-api-business-logic
finding_id: "bug-01"
nature: bug
severity: P0
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 01：已成功生成仍可调用取消接口触发全额退款

## 速答

`POST /api/generations/:id/cancel` 没有限制只能取消 `pending/running` 记录；对已 `succeeded` 的历史生成调用时，状态函数返回终态记录，外层仍按 `record.count` 执行退款，导致成功生成可被全额退积分。

## 关键证据

- `apps/api/src/server/routes/images.ts:108` — 注册取消接口，认证用户可调用 `/api/generations/:id/cancel`。
- `apps/api/src/domain/generation/generation-tasks.ts:105` — `cancelGenerationTask` 只检查 `getGenerationRecord` 是否可读，不检查记录状态。
- `apps/api/src/domain/generation/generation-tasks.ts:111` — 如果任务不在 `activeGenerationTasks`，`abort()` 不发生，但仍继续调用取消记录逻辑。
- `apps/api/src/domain/generation/image-generation.ts:255` — `cancelGenerationRecord` 对返回的任意 record 执行退款。
- `apps/api/src/domain/generation/image-generation.ts:757` — `updateGenerationRecordStatus` 遇到终态记录直接 `return existing`，包括 `succeeded`。
- `apps/api/src/domain/credits/credit-store.ts:718` — 退款金额按 `failedCount / count` 计算；取消路径传入 `record.count` 和 `record.count`，所以成功生成会算出全额退款。

## 影响

普通用户只要知道自己历史成功生成的 ID，就可以补发 cancel 请求为该生成写入一次 `generation_refund`，取回当次生成扣除的全部积分。`generation_refund` 的幂等检查只能防止同一生成重复退款，不能防止成功生成第一次被错误退款。

## 修复方向

取消入口应在读取记录后只允许 `pending` / `running` 状态进入取消和退款流程；对 `succeeded` / `partial` / `failed` / `cancelled` 应返回原记录或业务错误，但不能触发退款。

## 建议动作

`cs-issue`，因为这是可由普通用户触发的积分账本错误，需要定点修复并补回归测试。
