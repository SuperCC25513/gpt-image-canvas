---
doc_type: audit-index
audit: 2026-05-28-web-gallery-assets-publication
scope: Gallery listing, public/private visibility, export, and asset URLs
created: 2026-05-28
status: active
total_findings: 4
---

# web-gallery-assets-publication 审计报告

## 范围

扫描 `apps/web/src/features/gallery/GalleryPage.tsx` 和 `apps/web/src/shared/api/assets.ts`。重点看 Gallery 列表加载、公开/私密切换、资产预览/下载、导出 ZIP 和公开 Gallery 只读视图。

## 总评

共发现 4 条：1 条 `bug`、1 条 `security`、2 条 `performance`。最值得先处理的是私有 Gallery 没有分页/虚拟化，随着本地资产增长会变成明显热点；公开/私密切换响应也缺少运行时校验。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | performance | P1 | medium | 私有 Gallery 全量加载并在客户端过滤渲染 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | medium | 可见性切换响应未校验就更新 Gallery 状态 | [finding-02.md](finding-02.md) |
| 3 | security | P2 | medium | 详情弹窗直接使用 API asset.url，绕过统一资产 helper | [finding-03.md](finding-03.md) |
| 4 | performance | P2 | medium | Gallery 导出先把 ZIP 整体读入内存再下载 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 0 | 1 |
| security | 0 | 0 | 1 | 1 |
| performance | 0 | 1 | 1 | 2 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **2** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-01 建议走 `cs-refactor` 做分页/虚拟化；finding-02 建议开 `cs-issue` 补响应 guard。
- **P2 有空再看**：finding-03 和 finding-04 可以随资产访问与导出体验一起处理。
