---
doc_type: audit-index
audit: 2026-05-28-web-prompt-pool-favorites
scope: prompt pool, home prompt preview, filters, favorites API
created: 2026-05-28
status: active
total_findings: 4
---

# web-prompt-pool-favorites 审计报告

## 范围

扫描 `apps/web/src/features/pool/PromptPoolPage.tsx`、`apps/web/src/features/pool/promptPoolFilters.ts`、`apps/web/src/features/prompt-favorites/promptFavoritesApi.ts` 和 `apps/web/src/features/home/HomePage.tsx`。重点看提示池加载、客户端筛选排序、瀑布流分发、收藏 CRUD、收藏分组和 localStorage 过滤偏好。

## 总评

共发现 4 条：3 条 `bug`、1 条 `performance`。最值得先处理的是 Prompt Pool 和 Favorites API 的响应解析都偏浅，数据 shape 不稳时 UI 会写入畸形收藏或渲染错误卡片。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | performance | P1 | medium | Prompt Pool 全量加载后在客户端筛选排序和瀑布流分发 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | medium | Prompt Pool 响应校验只检查 items 数组存在 | [finding-02.md](finding-02.md) |
| 3 | bug | P1 | medium | Prompt Favorites API helper 直接返回泛型结果 | [finding-03.md](finding-03.md) |
| 4 | bug | P2 | medium | 持久化的 modelFilter 不随当前数据集校正 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 2 | 1 | 3 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 1 | 0 | 1 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **3** | **1** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-02、finding-03 建议开 `cs-issue` 补响应 guard；finding-01 建议走 `cs-refactor` 优化大数据集路径。
- **P2 有空再看**：finding-04 可随筛选状态治理一起修。
