---
doc_type: audit-finding
audit: 2026-05-28-backend-assets-gallery
finding_id: "bug-02"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 02：OSS 访问 URL 和 metadata 只信数据库记录，无法发现对象缺失

## 速答

OSS 模式下，资产 metadata 和 access-url 只要数据库存在资产行就会返回成功；如果 OSS object 被外部删除、迁移遗漏或写入后损坏，API 仍会给出 metadata 或签名 URL，直到客户端访问 OSS 时才失败。

## 关键证据

- `apps/api/src/domain/generation/image-generation.ts:435` — `export async function readStoredAssetMetadata(...)` —— metadata 读取从 `findAssetById` 开始。
- `apps/api/src/domain/generation/image-generation.ts:441` — `if (!usesOssAssetStorage() && !(await readStoredAsset(assetId)))` —— 只有非 OSS 模式会实际读取资产 bytes 来验证可用性。
- `apps/api/src/domain/generation/image-generation.ts:452` — `export async function getStoredAssetAccessUrl(...)` —— access-url 读取资产行后直接返回。
- `apps/api/src/domain/generation/image-generation.ts:461` — `return { id: asset.id, url: storedAssetAccessUrl(...) }` —— 没有对 OSS object 执行 `head` 或 `get`。
- `apps/api/src/infrastructure/storage/asset-storage.ts:128` — `assertOssObjectKey(location.objectKey, this.config);` —— 签名 URL 前只校验 object key 格式和 root-path。
- `apps/api/src/infrastructure/storage/asset-storage.ts:130` — `return this.client.signatureUrl(location.objectKey, ...)` —— 签名动作本身不证明对象存在。

## 影响

数据库和 OSS 不一致时，`/api/assets/:id/metadata`、`/api/assets/:id/access-url`、OSS 模式下的 `/api/assets/:id` 重定向会表现为成功，但用户实际拿不到图片。该问题会让 Gallery 公开页或私有资产页出现“看起来存在、实际打不开”的坏状态，也弱化了 `docs/RELIABILITY.md` 中“生成图片成功后必须能从当前资产存储读取”的运行时保证。

## 修复方向

明确 OSS URL/metadata 的可用性语义：若 API 声称资产可用，应在返回 metadata/access-url 前执行对象存在检查；若为了性能不做检查，需要在响应契约和调用方中区分“数据库资产存在”和“对象已确认可读”。

## 建议动作

`cs-issue`，因为这是可复现的资产可用性语义缺口。

