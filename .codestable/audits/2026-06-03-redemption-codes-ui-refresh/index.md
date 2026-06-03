---
doc_type: audit-index
audit: 2026-06-03-redemption-codes-ui-refresh
scope: 后台兑换码筛选 / 创建表单 / 顶部导航与语言切换选中态
created: 2026-06-03
status: fixed
total_findings: 3
---

# redemption-codes-ui-refresh 审计报告

## 范围

本轮审计聚焦已完成的兑换码 UI 刷新相关改动：

- `apps/web/src/features/admin/AdminPage.tsx`
- `apps/web/src/shared/i18n/index.tsx`
- `apps/web/src/styles/admin.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/styles/layout-theme.css`
- `apps/web/src/styles/dark.css`
- 对照 `apps/api/src/domain/redemption-codes/redemption-code-store.ts` 的兑换可用性规则
- 对照 `.codestable/architecture/ARCHITECTURE.md` 中后台、账号、provider 和前端模块边界

## 总评

未发现 P0/P1 问题。新增筛选、搜索、快捷过期 selected、青绿色 active/focus 方向总体符合任务设计，未见新增安全敏感数据暴露。原发现 3 条 P2：1 条前后端过期边界不一致，1 条前端筛选范围与“总数/全部”表达存在误导，1 条移动端顶部导航 active 项可能在横向滚动区外不可见。2026-06-03 已完成对应修复。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P2 | medium | 前端过期判断与后端兑换判断边界不一致 | [finding-01.md](finding-01.md) |
| 2 | bug | P2 | high | 筛选和统计只覆盖最近 200 条，但 UI 表达像全量 | [finding-02.md](finding-02.md) |
| 3 | maintainability | P2 | medium | 移动端全站导航 active 项可能不可见 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---:|---:|---:|---:|
| bug | 0 | 0 | 2 | 2 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **0** | **3** | **3** |

## 下一步建议

- **P0 立刻修**：无。
- **P1 本迭代修**：无。
- **P2**：3 条已修复。后续如要彻底消除最近 200 条限制，可另开服务端筛选 / 分页任务。
