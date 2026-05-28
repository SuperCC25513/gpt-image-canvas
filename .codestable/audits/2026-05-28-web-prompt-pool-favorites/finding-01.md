---
doc_type: audit-finding
audit: 2026-05-28-web-prompt-pool-favorites
finding_id: "performance-01"
nature: performance
severity: P1
confidence: medium
suggested_action: cs-refactor
status: deferred
---

# Finding 01：Prompt Pool 全量加载后在客户端筛选排序和瀑布流分发

## 速答

提示池一次请求 `/api/pool` 全量数据，然后前端对全部 items 做筛选、排序、切片和瀑布流列分发；数据集变大后主线程成本会明显上升。

## 关键证据

- `apps/web/src/features/pool/PromptPoolPage.tsx:101` — `fetch("/api/pool", { signal: controller.signal })` —— 页面一次拉取提示池。
- `apps/web/src/features/pool/PromptPoolPage.tsx:112` — `setItems(body.items);` —— 全量 items 进入 state。
- `apps/web/src/features/pool/PromptPoolPage.tsx:183` — `filterPromptPoolItems(items, deferredQuery, mediaFilter, modelFilter, sortMode)` —— 筛选排序在客户端执行。
- `apps/web/src/features/pool/PromptPoolPage.tsx:187` — `filteredItems.slice(0, visibleCount)` —— 前端只切可见数量，但过滤已先扫全集。
- `apps/web/src/features/pool/PromptPoolPage.tsx:898` — `distributePromptPoolItems(items, columnCount)` —— 瀑布流列分发继续遍历可见 items。

## 影响

Prompt Pool 是浏览和复用入口，未来数据量增长时，搜索输入和筛选切换会变成主线程热点。`useDeferredValue` 只能缓解输入优先级，不能降低总计算量。

## 修复方向

给 `/api/pool` 增加分页/查询参数，或在前端引入索引/worker；瀑布流分发只处理当前窗口。

## 建议动作

`cs-refactor`，因为这是数据流和渲染策略优化。
