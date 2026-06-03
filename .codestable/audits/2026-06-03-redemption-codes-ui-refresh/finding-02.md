---
doc_type: audit-finding
audit: 2026-06-03-redemption-codes-ui-refresh
finding_id: "bug-02"
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 02：筛选和统计只覆盖最近 200 条，但 UI 表达像全量

## 速答

兑换码页只加载最近 200 条，新增的“全部 / 总数 / 当前显示”统计都基于这 200 条，但界面没有提示这是局部窗口。

## 关键证据

- `apps/web/src/features/admin/AdminPage.tsx:245` — `"/api/admin/redemption-codes?limit=200"` —— 页面只请求 200 条兑换码。
- `apps/web/src/features/admin/AdminPage.tsx:144` — `redemptionCodeStatsFor(redemptionCodes, redemptionCodeNow)` —— 统计只基于已加载的 `redemptionCodes`。
- `apps/web/src/features/admin/AdminPage.tsx:146-153` — `visibleRedemptionCodes` 只过滤 `sortedRedemptionCodes`，没有继续请求后端 cursor。
- `apps/web/src/shared/i18n/index.tsx:430-445` — 文案使用“全部”“总数”“当前显示 x / y 个”，没有说明 `y` 是“已加载数量”或“最近 200 条”。

## 影响

当系统兑换码超过 200 条时，运营搜索一个较旧但存在的兑换码会得到“没有匹配”，统计也会显示局部总数。这会让后台使用者误判兑换码不存在或状态分布错误。

## 修复方向

短期：文案明确“最近 200 条”或“已加载”。中期：接入服务端筛选 / 搜索 / cursor 分页，让统计与搜索语义明确。

## 建议动作

`cs-issue`，因为这是用户可见行为和数据语义不一致。

## 修复记录

2026-06-03：兑换码列表标题、筛选、搜索 placeholder、统计和显示数量文案已明确“已加载 / 最近最多 200 条”。
