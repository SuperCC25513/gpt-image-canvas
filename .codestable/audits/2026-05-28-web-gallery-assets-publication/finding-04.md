---
doc_type: audit-finding
audit: 2026-05-28-web-gallery-assets-publication
finding_id: "performance-04"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: deferred
---

# Finding 04：Gallery 导出先把 ZIP 整体读入内存再下载

## 速答

导出选中图片时，前端调用 `/api/gallery/export` 后 `await response.blob()`，把 ZIP 全量读入内存，再创建 object URL 下载。

## 关键证据

- `apps/web/src/features/gallery/GalleryPage.tsx:277` — `fetch("/api/gallery/export", { method: "POST", ... })` —— 导出请求返回 ZIP。
- `apps/web/src/features/gallery/GalleryPage.tsx:289` — `const archive = await response.blob();` —— ZIP 整体进入内存。
- `apps/web/src/features/gallery/GalleryPage.tsx:294` — `const archiveUrl = window.URL.createObjectURL(archive);` —— 再用 object URL 触发下载。
- `apps/web/src/features/gallery/GalleryPage.tsx:301` — `window.setTimeout(() => window.URL.revokeObjectURL(archiveUrl), 1000);` —— 只在下载触发后清理 object URL。

## 影响

用户批量导出高分辨率图片时 ZIP 可能很大，前端内存会瞬时升高；移动端或低内存机器更明显。

## 修复方向

优先让后端导出端点通过导航下载或流式下载，前端只提交导出选择；至少增加选中数量/估计大小提示。

## 建议动作

`cs-refactor`，因为这是导出数据流优化。
