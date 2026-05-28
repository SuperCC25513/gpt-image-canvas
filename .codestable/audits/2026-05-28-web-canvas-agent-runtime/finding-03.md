---
doc_type: audit-finding
audit: 2026-05-28-web-canvas-agent-runtime
finding_id: "performance-03"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: resolved
---

# Finding 03：资产元数据缓存是模块级 Map 且没有淘汰策略

## 速答

画布资产尺寸缓存保存在模块级 `Map`，只增不减；长时间使用或浏览大量资产后，缓存会跟随页面生命周期持续增长。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:156` — `const initialCanvasPreviewWidths = new Map<string, AssetPreviewWidth>();` —— 模块级缓存跨组件实例存在。
- `apps/web/src/features/canvas/CanvasApp.tsx:157` — `const assetMetadataCache = new Map<string, ImageSize>();` —— 资产尺寸缓存没有容量上限。
- `apps/web/src/features/canvas/CanvasApp.tsx:1913` — `function rememberAssetMetadata(assetId: string, size: ImageSize)` —— 只在 size 可用时写入缓存。
- `apps/web/src/features/canvas/CanvasApp.tsx:1951` — `assetMetadataRequests.delete(assetId);` —— 只清理 in-flight 请求，不清理已完成的 `assetMetadataCache`。

## 影响

本地创作工作台通常长时间打开。生成、Gallery 复用、Agent 输出越多，缓存项越多；单项很小，但没有边界会让长期会话内存不可预测。

## 修复方向

给资产元数据缓存加 LRU/容量上限，或按当前画布引用资产集合做周期性清理。

## 建议动作

`cs-refactor`，因为行为目标不变，主要是缓存生命周期和边界治理。
