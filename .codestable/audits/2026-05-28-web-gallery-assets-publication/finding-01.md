---
doc_type: audit-finding
audit: 2026-05-28-web-gallery-assets-publication
finding_id: "performance-01"
nature: performance
severity: P1
confidence: medium
suggested_action: cs-refactor
status: deferred
---

# Finding 01：私有 Gallery 全量加载并在客户端过滤渲染

## 速答

公开 Gallery 请求带 `limit=60`，私有 Gallery 请求没有 limit；页面随后在客户端对所有 items 搜索、切片、映射和渲染。

## 关键证据

- `apps/web/src/features/gallery/GalleryPage.tsx:91` — `variant === "public" ? "/api/gallery/public?limit=60" : "/api/gallery"` —— 私有 Gallery 没有限制。
- `apps/web/src/features/gallery/GalleryPage.tsx:156` — `const filteredItems = useMemo(() => { ... return items.filter(...) })` —— 搜索在客户端全量过滤。
- `apps/web/src/features/gallery/GalleryPage.tsx:171` — `const featuredItem = filteredItems[0] ?? null;` —— 所有结果先进入内存数组。
- `apps/web/src/features/gallery/GalleryPage.tsx:496` — `gridItems.map((item) => ( <GalleryCard ... /> ))` —— 渲染也按当前过滤结果直接 map。

## 影响

本地优先产品会积累大量生成资产。私有 Gallery 数据越多，首屏请求、搜索和渲染都会变慢，并增加内存压力。

## 修复方向

给私有 Gallery 增加分页或 cursor；前端保留当前页/增量加载，图片网格使用虚拟化或窗口化。

## 建议动作

`cs-refactor`，因为这是数据加载和渲染策略优化。
