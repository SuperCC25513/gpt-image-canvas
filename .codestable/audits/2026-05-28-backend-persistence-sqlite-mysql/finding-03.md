---
doc_type: audit-finding
audit: 2026-05-28-backend-persistence-sqlite-mysql
finding_id: "maintainability-03"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: fixed
---

# Finding 03：`docs/generated/db-schema.md` 已落后于 schema，漏掉兑换码表和 redemption 交易字段

## 速答

生成的数据库 schema 文档标记最后检查为 2026-05-22，但当前代码已包含兑换码、兑换记录和 `credit_transactions.related_redemption_code_id`；文档没有这些表/字段，且 reason 列表也漏掉 `redemption_code`。

## 关键证据

- `docs/RELIABILITY.md:15` — 要求 SQLite schema 变化时保持 `docs/generated/db-schema.md` 更新。
- `docs/generated/db-schema.md:5` — `最后检查：2026-05-22。` —— 文档检查日期早于当前审计日。
- `apps/api/src/infrastructure/schema.ts:49` — `relatedRedemptionCodeId: text("related_redemption_code_id")` —— 代码中已有兑换码关联字段。
- `docs/generated/db-schema.md:74` — `credit_transactions` 表格列清单开始。
- `docs/generated/db-schema.md:80` — 只列 `related_generation_id`。
- `docs/generated/db-schema.md:81` — 只列 `related_output_id`。
- `docs/generated/db-schema.md:82` — 只列 `related_checkin_date`。
- `docs/generated/db-schema.md:83` — 直接到 `admin_note`，缺少 `related_redemption_code_id`。
- `docs/generated/db-schema.md:79` — reason 说明只列 `registration_bonus`、`daily_checkin`、`generation_charge`、`generation_refund`、`admin_adjustment`，缺少 `redemption_code`。
- `apps/api/src/infrastructure/schema.ts:69` — `export const redemptionCodes = sqliteTable("redemption_codes", ...)` —— 代码中已有兑换码表。
- `apps/api/src/infrastructure/schema.ts:82` — `export const creditRedemptions = sqliteTable("credit_redemptions", ...)` —— 代码中已有兑换审计表。
- `docs/generated/db-schema.md:101` — 文档从 `user_checkins` 直接跳到 `projects`，没有 `redemption_codes` 和 `credit_redemptions` 章节。

## 影响

后端持久化已经支持兑换码账本，但生成文档仍描述旧 schema。后续审计、迁移、排障或 MySQL/SQLite 对齐时，开发者会漏看兑换码表和 redemption 交易字段，增加误改风险。

## 修复方向

刷新 `docs/generated/db-schema.md`，补齐 `redemption_codes`、`credit_redemptions`、`related_redemption_code_id`、`redemption_code` reason，以及 SQLite/MySQL 两侧索引/外键差异。

## 建议动作

`cs-refactor`，因为这是文档与 schema 的维护性漂移，不需要改变运行时代码。
