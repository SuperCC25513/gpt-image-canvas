---
doc_type: audit-finding
audit: 2026-05-28-backend-assets-gallery
finding_id: "performance-01"
nature: performance
severity: P1
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 01：Gallery 导出没有业务上限，OSS 模式会把全部资产读入内存

## 速答

`/api/gallery/export` 对 `outputIds` 没有合理业务上限，且在 MySQL + OSS 模式下会逐个把原图读成 `Buffer` 后再创建 ZIP；大量 2K/4K 图片导出会造成内存峰值和响应延迟风险。

## 关键证据

- `apps/api/src/server/routes/gallery.ts:154` — `outputIds: body.outputIds.filter((outputId): outputId is string => typeof outputId === "string")` —— 请求体只过滤字符串，没有限制数组长度或总导出大小。
- `apps/api/src/server/routes/gallery.ts:47` — `const zipInputs: ZipFileInput[] = [];` —— 路由会为所有导出项累积 ZIP 输入。
- `apps/api/src/server/routes/gallery.ts:49` — `const asset = await readStoredAsset(exportAsset.assetId);` —— 每个导出项都会先读完整资产。
- `apps/api/src/domain/generation/image-generation.ts:425` — `return { file, bytes: await readStoredAssetBytes(file.relativePath) }` —— `readStoredAsset` 返回完整 `Buffer`。
- `apps/api/src/domain/assets/zip.ts:150` — `yield file.bytes;` —— 对 bytes 来源的 ZIP 项一次性输出完整内存块；OSS 导出没有本地 `filePath` 流式读取优势。

## 影响

已登录用户可以提交很长的 `outputIds` 列表。即使每张图片都归属合法，OSS 模式也会把每个对象下载到 API 进程内存，再开始输出 ZIP。4K 输出或批量导出时容易触发高内存、长尾延迟，最差情况下影响同一进程上的其他 API 请求。

## 修复方向

给 Gallery 导出设置明确的最大张数和/或总字节数上限；OSS 模式优先改成对象流式写 ZIP，或分批读取并限制并发/内存。

## 建议动作

`cs-refactor`，因为这是行为边界和导出实现结构调整，不是单点 bug 修补。

