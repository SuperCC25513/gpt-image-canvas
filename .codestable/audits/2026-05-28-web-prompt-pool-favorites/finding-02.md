---
doc_type: audit-finding
audit: 2026-05-28-web-prompt-pool-favorites
finding_id: "bug-02"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 02：Prompt Pool 响应校验只检查 items 数组存在

## 速答

Prompt Pool 页面只检查 `body.items` 是数组且有 summary；Home 预览只检查 `items` 数组存在，没有验证每个 `PromptPoolItem` 的字段。

## 关键证据

- `apps/web/src/features/pool/PromptPoolPage.tsx:106` — `const body = (await response.json()) as PromptPoolResponse;` —— 响应先强转。
- `apps/web/src/features/pool/PromptPoolPage.tsx:107` — `if (!Array.isArray(body.items) || !body.summary)` —— 主页面只做浅层校验。
- `apps/web/src/features/home/HomePage.tsx:56` — `const body = (await response.json()) as unknown;` —— Home 预览读取同一接口。
- `apps/web/src/features/home/HomePage.tsx:253` — `function isPromptPoolResponse(value: unknown): value is PromptPoolResponse` —— Home 自建 guard。
- `apps/web/src/features/home/HomePage.tsx:254` — `Array.isArray((value as { items?: unknown }).items)` —— Home guard 只看 items 是否数组。

## 影响

畸形 item 会在筛选、图片展示、统计格式化或详情弹窗处抛错，且两个入口校验口径不同。

## 修复方向

在 shared 层补 `isPromptPoolResponse` / `isPromptPoolItem`，Pool 和 Home 共用同一个 guard。

## 建议动作

`cs-issue`，因为这是 API 响应边界 bug。
