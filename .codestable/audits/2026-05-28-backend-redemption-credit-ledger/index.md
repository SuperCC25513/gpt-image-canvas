---
doc_type: audit-index
audit: 2026-05-28-backend-redemption-credit-ledger
scope: Backend redemption code lifecycle, user redemption, credit transactions, daily check-in, and balance ledger consistency.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-redemption-credit-ledger 审计报告

## 范围

本次审计覆盖积分兑换码和交易流水：

- `apps/api/src/server/routes/redemption-codes.ts`
- `apps/api/src/server/routes/credits.ts`
- `apps/api/src/server/routes/auth.ts`
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts`
- `apps/api/src/domain/credits/credit-store.ts`
- `packages/shared/src/redemption-codes.ts`
- `packages/shared/src/credits.ts`
- `apps/api/src/infrastructure/schema.ts`
- `apps/api/src/infrastructure/mysql-database.ts`

## 总评

共发现 3 条问题：`security` 1 条、`bug` 2 条；严重度均为 P2。兑换码主流程的账务一致性较好：用户兑换在同一事务内检查兑换码、更新用户余额、写 `credit_transactions`、写 `credit_redemptions` 并标记兑换码；MySQL 路径对兑换码和用户行使用 `FOR UPDATE`，删除已兑换码也有保护。主要剩余风险是兑换接口会暴露兑换码状态 oracle，用户/管理员列表只有 limit 没有游标，以及 MySQL 每日签到对“不存在的签到行”缺少稳定幂等处理。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P2 | medium | 兑换接口按不存在/停用/过期/已兑换返回不同错误，形成兑换码状态 oracle | [finding-01.md](finding-01.md) |
| 2 | bug | P2 | high | 积分流水和兑换码列表只有 limit，没有 cursor，历史账本不可完整遍历 | [finding-02.md](finding-02.md) |
| 3 | bug | P2 | medium | MySQL 每日签到并发首次请求可能撞唯一键并返回通用错误 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 0 | 2 | 2 |
| security | 0 | 0 | 1 | 1 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **0** | **3** | **3** |

## 下一步建议

- **P2 有空再看**：Finding 01 建议走 `cs-issue`，统一失败响应并考虑兑换尝试节流；Finding 02 建议走 `cs-refactor`，给账本列表补 cursor；Finding 03 建议走 `cs-issue`，把签到唯一键冲突转成幂等的已签到响应。
