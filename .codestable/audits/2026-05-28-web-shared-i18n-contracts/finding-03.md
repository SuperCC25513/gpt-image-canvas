---
doc_type: audit-finding
audit: 2026-05-28-web-shared-i18n-contracts
finding_id: "maintainability-03"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: deferred
---

# Finding 03：i18n 函数消息参数类型靠 any 和 never cast 维持

## 速答

i18n catalog 的函数消息类型用 `any` 推断，再在 `createTranslate` 内把 `params` cast 成 `never` 调用；类型系统无法在实现内部保护参数 shape。

## 关键证据

- `apps/web/src/shared/i18n/index.tsx:1150` — `type MessageValue = string | ((params: any) => string);` —— 函数消息入口使用 `any`。
- `apps/web/src/shared/i18n/index.tsx:2044` — `I18nMessages[K] extends (params: any) => string` —— key 分类也依赖 `any`。
- `apps/web/src/shared/i18n/index.tsx:2133` — `return ((key: keyof I18nMessages, params?: unknown) => { ... })` —— translate 实现接收 unknown params。
- `apps/web/src/shared/i18n/index.tsx:2136` — `return value(params as never);` —— 最终用 `never` cast 调用函数消息。

## 影响

调用侧有 overload 保护，但实现侧没有运行时或编译期兜底。新增复杂消息时，如果参数结构不一致，错误可能只在运行时暴露。

## 修复方向

把 message catalog 定义为显式 schema，或用 `satisfies` 保留函数参数类型，避免 `any`/`never` 贯穿核心 i18n 实现。

## 建议动作

`cs-refactor`，因为这是类型模型维护性问题。
