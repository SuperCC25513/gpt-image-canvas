---
doc_type: audit-finding
audit: 2026-05-28-web-gallery-assets-publication
finding_id: "bug-02"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 02：可见性切换响应未校验就更新 Gallery 状态

## 速答

公开/私密切换后，响应体直接强转为 `GalleryVisibilityResponse` 并写入列表和详情弹窗，没有校验 `outputId`、`isPublic`、`publishedAt` 等字段。

## 关键证据

- `apps/web/src/features/gallery/GalleryPage.tsx:351` — `fetch(/api/gallery/${...}/visibility, { method: "PATCH", ... })` —— 可见性切换请求。
- `apps/web/src/features/gallery/GalleryPage.tsx:362` — `const body = (await response.json()) as GalleryVisibilityResponse;` —— 响应直接强转。
- `apps/web/src/features/gallery/GalleryPage.tsx:363` — `setItems((current) => current.map((galleryItem) => applyVisibility(galleryItem, body)));` —— 未校验响应就更新列表。
- `apps/web/src/features/gallery/GalleryPage.tsx:1173` — `function applyVisibility(item: GalleryImageItem, visibility: GalleryVisibilityResponse)` —— helper 假设 response shape 正确。

## 影响

如果 API 版本漂移或代理返回不完整 JSON，页面可能把错误公开状态写入 UI，造成用户对资产公开状态的误判。

## 修复方向

补 `isGalleryVisibilityResponse` guard；失败时保留原状态并显示错误，不应用部分字段。

## 建议动作

`cs-issue`，因为这是公开/私密边界状态一致性问题。
