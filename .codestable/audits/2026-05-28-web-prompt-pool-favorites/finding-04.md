---
doc_type: audit-finding
audit: 2026-05-28-web-prompt-pool-favorites
finding_id: "bug-04"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-refactor
status: resolved
---

# Finding 04：持久化的 modelFilter 不随当前数据集校正

## 速答

Prompt Pool 会从 localStorage 恢复任意非空 `modelFilter` 字符串，但当前数据集的 `modelOptions` 变化后没有自动重置无效 model，页面可能直接显示空结果。

## 关键证据

- `apps/web/src/features/pool/promptPoolFilters.ts:80` — `const parsed = JSON.parse(raw) as Partial<PromptPoolFilterState>;` —— 从本地存储恢复筛选状态。
- `apps/web/src/features/pool/promptPoolFilters.ts:83` — `modelFilter: typeof parsed.modelFilter === "string" && parsed.modelFilter.trim() ? parsed.modelFilter : ...` —— 任意非空字符串都会被接受。
- `apps/web/src/features/pool/PromptPoolPage.tsx:182` — `const modelOptions = useMemo(() => modelFilterOptions(items), [items]);` —— 当前可选模型来自新数据集。
- `apps/web/src/features/pool/PromptPoolPage.tsx:183` — `filterPromptPoolItems(items, deferredQuery, mediaFilter, modelFilter, sortMode)` —— 过滤仍使用恢复出的 modelFilter。
- `apps/web/src/features/pool/PromptPoolPage.tsx:232` — `resetFilters` 需要用户手动恢复默认筛选。

## 影响

当 prompt-pool 数据源变化、模型名改名或某模型被移除时，用户可能看到“无匹配结果”，但真正原因是旧 filter 残留。

## 修复方向

加载 items 后，如果 `modelFilter !== "all"` 且不在 `modelOptions` 中，自动重置为 `all` 并更新 localStorage。

## 建议动作

`cs-refactor`，因为这是筛选状态一致性整理。
