---
doc_type: audit-finding
audit: 2026-05-28-web-gallery-assets-publication
finding_id: "security-03"
nature: security
severity: P2
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 03：详情弹窗直接使用 API asset.url，绕过统一资产 helper

## 速答

Gallery 卡片使用 `assetPreviewUrl` 生成受控预览 URL，但详情弹窗直接把 API 返回的 `item.asset.url` 放进 `<img>`，访问路径不一致。

## 关键证据

- `apps/web/src/features/gallery/GalleryPage.tsx:648` — 卡片图使用 `src={assetPreviewUrl(item.asset.id, 1024)}`。
- `apps/web/src/features/gallery/GalleryPage.tsx:743` — 普通卡片使用 `src={assetPreviewUrl(item.asset.id, 512)}`。
- `apps/web/src/features/gallery/GalleryPage.tsx:1034` — 详情弹窗使用 `src={item.asset.url}`。
- `apps/web/src/shared/api/assets.ts:1` — `assetPreviewUrl(assetId, width)` 是统一预览路由 helper。
- `apps/web/src/shared/api/assets.ts:5` — `assetDownloadUrl(assetId)` 是统一下载路由 helper。

## 影响

如果 API 在不同存储模式下返回原图 URL、签名 URL 或未来字段含义变化，详情弹窗会绕过前端统一 asset route 约束，也可能加载比预期更大的原图。

## 修复方向

详情弹窗也改用 `assetPreviewUrl`，下载动作继续用 `assetDownloadUrl`；如确需原图，建立显式 helper 和权限语义。

## 建议动作

`cs-issue`，因为这触及资产访问路径一致性和隐私边界。
