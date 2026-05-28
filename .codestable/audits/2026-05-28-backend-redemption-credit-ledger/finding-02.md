---
doc_type: audit-finding
audit: 2026-05-28-backend-redemption-credit-ledger
finding_id: "bug-02"
nature: bug
severity: P2
confidence: high
suggested_action: cs-refactor
status: fixed
---

# Finding 02：积分流水和兑换码列表只有 limit，没有 cursor，历史账本不可完整遍历

## 速答

用户积分流水最多返回 100 条，后台兑换码列表最多返回 200 条，但实现没有 cursor/offset；共享契约里的 `CreditTransactionListResponse.nextCursor` 也从未赋值，长期使用后旧账本和旧兑换码不可完整遍历。

## 关键证据

- `apps/api/src/server/routes/credits.ts:13` — `await listCreditTransactionsForUser(auth.user.id, { limit: ... })` —— 用户流水路由只传 limit。
- `apps/api/src/domain/credits/credit-store.ts:96` — `const limit = creditTransactionLimit(options.limit);` —— 只计算 limit。
- `apps/api/src/domain/credits/credit-store.ts:102` — `.orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id)).limit(limit)` —— SQLite 只截取最新 N 条。
- `apps/api/src/domain/credits/credit-store.ts:114` — `ORDER BY created_at DESC, id DESC LIMIT ?` —— MySQL 只截取最新 N 条。
- `apps/api/src/domain/credits/credit-store.ts:732` — `return Math.min(..., MAX_CREDIT_TRANSACTION_LIMIT);` —— 用户流水上限 100。
- `packages/shared/src/credits.ts:32` — `export interface CreditTransactionListResponse { items: CreditTransaction[]; nextCursor?: string; }` —— 契约预留 cursor，但实现没有返回。
- `apps/api/src/server/routes/redemption-codes.ts:50` — `await listAdminRedemptionCodes({ limit: parseLimit(...) })` —— 后台兑换码列表也只传 limit。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:101` — `.orderBy(desc(redemptionCodes.createdAt), desc(redemptionCodes.id)).limit(limit)` —— SQLite 后台兑换码只返回最新 N 条。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:652` — `return Math.min(..., REDEMPTION_CODE_MAX_CREATE_COUNT);` —— 后台兑换码列表上限 200。
- `packages/shared/src/redemption-codes.ts:28` — `export interface RedemptionCodeListResponse { items: RedemptionCodeSummary[]; }` —— 兑换码列表响应没有分页元数据。

## 影响

积分是本地经济账。用户交易超过 100 条后，客户端无法获取更早流水；后台兑换码超过 200 条后，管理员无法完整查看、停用或确认旧的未兑换码。对账、客服排查和审计都会丢失可访问历史。

## 修复方向

以 `(createdAt, id)` 做稳定游标，为用户流水和后台兑换码列表补 `cursor` 入参、`nextCursor` 响应和 `hasMore` 语义。

## 建议动作

`cs-refactor`，因为这是列表查询能力补齐，兼容现有 limit 调用。
