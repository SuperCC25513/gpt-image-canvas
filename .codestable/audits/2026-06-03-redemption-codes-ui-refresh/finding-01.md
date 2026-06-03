---
doc_type: audit-finding
audit: 2026-06-03-redemption-codes-ui-refresh
finding_id: "bug-01"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：前端过期判断与后端兑换判断边界不一致

## 速答

兑换码到达精确过期时刻时，前端仍可能短暂把它算作未过期 / 可兑换，但后端会拒绝兑换。

## 关键证据

- `apps/web/src/features/admin/AdminPage.tsx:1357-1358` — `return Number.isFinite(expiresAt) && expiresAt < now;` —— 前端只有 `expiresAt < now` 才判为已过期。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:497-498` — `Date.parse(code.expiresAt) <= Date.parse(now)` 时后端直接抛出不可用错误 —— 后端在相等边界已经判定不可兑换。
- `apps/web/src/features/admin/AdminPage.tsx:1361-1362` — `isRedemptionCodeAvailable` 依赖 `!isRedemptionCodeExpired(code, now)` —— 这个边界会影响可兑换统计和可兑换筛选。

## 影响

触发窗口很窄，只在当前时间正好等于过期时间时出现。影响是后台运营看到“可兑换”数量或筛选结果和实际兑换 API 行为短暂不一致。

## 修复方向

把前端过期判断改成 `expiresAt <= now`，与后端 `assertRedeemableCode` 保持同一边界。

## 建议动作

`cs-issue`，因为这是前后端业务规则不一致，不是单纯样式调整。

## 修复记录

2026-06-03：前端过期判断已改为 `expiresAt <= now`，与后端兑换规则对齐。
