---
doc_type: audit-finding
audit: 2026-05-28-backend-generation-credits
finding_id: "bug-03"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 03：取消发生在输出保存后时会留下未关联资产 bytes

## 速答

生成取消只改变 generation record 状态并退款；如果 abort 信号在 provider 返回后、记录完成前到达，代码可能已经把图片 bytes 写入本地/OSS，但随后因取消不插入 generation output，留下不可见的 orphan asset bytes。

## 关键证据

- `apps/api/src/domain/generation/image-generation.ts:199` — `const outputs = await mapWithConcurrency(...)` —— 完成记录前先生成所有输出。
- `apps/api/src/domain/generation/image-generation.ts:202` — `async () => generateSingleOutput(input, provider, signal)` —— 每个输出独立执行生成。
- `apps/api/src/domain/generation/image-generation.ts:495` — `const saved = await saveProviderImage(providerImage, input, signal);` —— provider 返回后立即保存资产。
- `apps/api/src/domain/generation/image-generation.ts:566` — `await writeStoredAssetBytes(relativePath, bytes, mimeType);` —— 资产 bytes 已写入本地或 OSS。
- `apps/api/src/domain/generation/image-generation.ts:204` — `throwIfAborted(signal);` —— 所有输出生成后才再次检查取消。
- `apps/api/src/domain/generation/generation-tasks.ts:205` — `if (controller.signal.aborted) { await cancelGenerationRecord(...) }` —— 背景任务看到 abort 后标记取消。
- `apps/api/src/domain/generation/image-generation.ts:264` — `const record = await updateGenerationRecordStatus(generationId, "cancelled", ...)` —— 取消路径只改状态。
- `apps/api/src/domain/generation/image-generation.ts:266` — `await refundGenerationCreditsForFailures(...)` —— 取消路径退款，但没有清理已写入的资产 bytes。

## 影响

用户取消后不会在生成历史看到这些输出，积分也会退款；但对象 bytes 已经占用 `DATA_DIR/assets` 或 OSS 空间。单次影响较小，重复取消或 provider 不及时响应 abort 时会持续积累不可达资产。

## 修复方向

在保存资产前后增加更细粒度 abort 检查，并为“保存成功但记录未完成”的路径建立清理策略；也可以把资产写入和 generation output 插入做成更明确的两阶段生命周期，取消时清理未关联资产。

## 建议动作

`cs-refactor`，因为修复涉及生成输出生命周期和资产清理结构。

