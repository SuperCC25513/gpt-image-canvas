---
doc_type: audit-finding
audit: 2026-05-28-web-prompt-pool-favorites
finding_id: "bug-03"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 03：Prompt Favorites API helper 直接返回泛型结果

## 速答

收藏 API helper 的 `parseJsonResponse<T>` 只处理 HTTP 错误，不校验成功响应 shape；创建、移动、重命名等操作会把泛型结果直接写入 UI state。

## 关键证据

- `apps/web/src/features/prompt-favorites/promptFavoritesApi.ts:16` — `createPromptFavorite` 返回 `PromptFavoriteItem`。
- `apps/web/src/features/prompt-favorites/promptFavoritesApi.ts:24` — `return (await parseJsonResponse<{ favorite: PromptFavoriteItem }>(response)).favorite;` —— 创建响应未校验 favorite shape。
- `apps/web/src/features/prompt-favorites/promptFavoritesApi.ts:63` — `updatePromptFavoriteGroup` 返回 `PromptFavoriteGroup`。
- `apps/web/src/features/prompt-favorites/promptFavoritesApi.ts:71` — `return (await parseJsonResponse<{ group: PromptFavoriteGroup }>(response)).group;` —— 分组响应未校验 group shape。
- `apps/web/src/features/prompt-favorites/promptFavoritesApi.ts:81` — `async function parseJsonResponse<T>(response: Response): Promise<T>` —— 泛型 parser 是统一入口。
- `apps/web/src/features/prompt-favorites/promptFavoritesApi.ts:88` — `return body as T;` —— 成功响应直接强转。

## 影响

收藏数据是跨页面状态；错误 shape 会污染收藏列表、分组映射和提示池卡片状态，且问题可能持续到下一次加载。

## 修复方向

为 favorites response 增加运行时 guard，或者复用 shared contract 生成 parser；失败时不更新本地 state。

## 建议动作

`cs-issue`，因为这是收藏 API 边界 bug。
