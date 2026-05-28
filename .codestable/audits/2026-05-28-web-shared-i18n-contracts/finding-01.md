---
doc_type: audit-finding
audit: 2026-05-28-web-shared-i18n-contracts
finding_id: "bug-01"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: resolved
---

# Finding 01：CanvasApp 本地生成响应 guard 比 shared guard 弱很多

## 速答

`shared/api/generation.ts` 已有严格 `isGenerationResponse`，但 `CanvasApp.tsx` 本地又定义了同名弱 guard，只检查对象里有 `record` 字段；生成接口畸形响应可绕过校验。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:683` — `function isGenerationResponse(value: unknown): value is GenerationResponse` —— CanvasApp 本地定义同名 guard。
- `apps/web/src/features/canvas/CanvasApp.tsx:684` — `return typeof value === "object" && value !== null && "record" in value;` —— 只检查 `record` 字段存在。
- `apps/web/src/shared/api/generation.ts:40` — `export function isGenerationResponse(value: unknown): value is GenerationResponse` —— shared 层已有严格 guard。
- `apps/web/src/shared/api/generation.ts:44` — `export function isGenerationRecord(value: unknown): value is GenerationRecord` —— shared guard 会深入检查 record。
- `apps/web/src/shared/api/generation.ts:64` — `Array.isArray(value.outputs) && value.outputs.every(isGenerationOutput)` —— shared guard 校验 outputs 结构。
- `apps/web/src/features/canvas/CanvasApp.tsx:4488` — `if (!isGenerationResponse(body)) { throw new Error(...) }` —— 画布生成提交使用的是本地弱 guard。

## 影响

CanvasApp 是主生成路径。畸形 response 只要含有 `record` 就会通过校验，后续读取 `record.outputs`、`record.status` 时可能抛错或写入错误历史。

## 修复方向

删除 CanvasApp 本地 `isGenerationResponse`，改用 `../../shared/api/generation` 的严格 guard；如有性能顾虑，抽共享 parser。

## 建议动作

`cs-issue`，因为这是主生成路径响应校验 bug。
