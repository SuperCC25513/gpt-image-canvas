---
doc_type: audit-finding
audit: 2026-05-28-backend-assets-gallery
finding_id: "performance-03"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 03：预览生成缺少单飞控制，并发请求会重复执行 Sharp/OSS 写入

## 速答

资产预览缓存采用“先查缓存，再生成，再写入”的直接流程；同一个 asset/width 首次被并发请求时，每个请求都会独立执行 Sharp resize，并在 OSS 模式下重复上传同一个预览对象。

## 关键证据

- `apps/api/src/domain/assets/preview.ts:78` — `const previewPath = resolvePreviewPath(asset.file.id, width);` —— 本地预览按 asset/width 固定缓存路径。
- `apps/api/src/domain/assets/preview.ts:79` — `const cached = await readCachedPreview(previewPath);` —— 只做静态缓存检查，没有 in-flight 去重。
- `apps/api/src/domain/assets/preview.ts:87` — `const bytes = await sharp(asset.bytes)...toBuffer();` —— 缓存未命中时每个请求都会执行 resize。
- `apps/api/src/domain/assets/preview.ts:99` — `await writeFile(previewPath, bytes);` —— 并发请求会写同一个缓存文件。
- `apps/api/src/domain/assets/preview.ts:124` — `const objectKey = previewObjectKeyForAsset(assetId, width);` —— OSS 预览也按 asset/width 固定 key。
- `apps/api/src/domain/assets/preview.ts:125` — `if (!(await ossObjectExists(objectKey)))` —— `head` 和后续生成/上传之间没有 single-flight 或锁。
- `apps/api/src/domain/assets/preview.ts:143` — `await writeOssObject(objectKey, bytes, "image/webp");` —— 并发未命中时会重复上传相同对象。

## 影响

热门 Gallery 图片或公开页首屏加载时，多个客户端可能同时请求相同预览宽度。当前实现结果仍大概率正确，但会放大 CPU、内存和 OSS 写入量，造成不必要的延迟和成本。该问题在冷缓存、部署重启、预览目录清空后更明显。

## 修复方向

为 `assetId + width` 增加进程内 single-flight map，或采用临时文件 + 原子 rename 搭配失败清理；OSS 模式可复用同一 single-flight key，避免重复 Sharp 和重复上传。

## 建议动作

`cs-refactor`，因为修复重点是缓存生成结构优化，不改变用户可见功能。

