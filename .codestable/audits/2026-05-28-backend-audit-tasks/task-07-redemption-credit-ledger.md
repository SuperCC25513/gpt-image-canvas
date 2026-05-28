---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "07"
slug: backend-redemption-credit-ledger
status: completed
priority: P1
recommended_dimensions:
  - bug
  - security
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-redemption-credit-ledger/
---

# Task 07：积分兑换码 + 交易流水

## 目标产物

`.codestable/audits/2026-05-28-backend-redemption-credit-ledger/`

## 路径

- `apps/api/src/server/routes/redemption-codes.ts`
- `apps/api/src/server/routes/credits.ts`
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts`
- `apps/api/src/domain/credits/credit-store.ts`
- `packages/shared/src/redemption-codes.ts`
- `packages/shared/src/credits.ts`

## 业务含义

负责兑换码创建、删除、列表、用户兑换、积分交易流水、每日签到和余额读取。

## 风险理由

积分是本地经济账。兑换码并发使用、重复兑换、删除已使用码、余额更新和流水缺失都可能导致账不平或越权。

## 推荐审计维度

- `bug`：事务边界、并发兑换、幂等、过期/次数限制、流水一致性。
- `security`：admin 创建/删除权限、兑换码枚举、跨用户交易读取。

## 重点检查

- 用户兑换是否在一个事务内检查 code、写 redemption、改余额、写 transaction。
- 重复兑换和并发兑换是否无法突破 `maxRedemptions`。
- 删除兑换码是否保护已使用记录或给出稳定语义。
- `/api/credits/transactions` 是否只返回当前用户交易。
- admin 路由是否全部 `requireAdmin`。

## 不做

不设计新的积分规则；不做经济模型调整。
