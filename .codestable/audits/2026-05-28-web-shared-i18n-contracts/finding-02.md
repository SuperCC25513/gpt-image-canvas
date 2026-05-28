---
doc_type: audit-finding
audit: 2026-05-28-web-shared-i18n-contracts
finding_id: "bug-02"
nature: bug
severity: P2
confidence: high
suggested_action: cs-refactor
status: deferred
---

# Finding 02：shared 错误码类型和 i18n 错误映射没有编译期同步

## 速答

shared 包定义了错误码 union，但前端 `commonApiErrorMessages` 用普通字符串索引；新增错误码不会强制 i18n 补齐，当前已经能看到未映射的 shared code。

## 关键证据

- `packages/shared/src/auth.ts:143` — `export type AuthErrorCode = ...` —— auth 错误码在 shared 中有类型。
- `packages/shared/src/agent.ts:31` — `export type AgentSkillErrorCode =` —— Agent Skill 错误码也在 shared 中有类型。
- `packages/shared/src/agent.ts:37` — `| "agent_skill_unsupported_storage"` —— shared 定义了 MySQL 模式不支持编辑的错误码。
- `apps/web/src/shared/i18n/index.tsx:227` — i18n 英文映射包含 `agent_skill_duplicate_slug` 等 Agent Skill 错误。
- `apps/web/src/shared/i18n/index.tsx:232` — i18n 英文映射到 `invalid_agent_skill` 结束，没有覆盖 `agent_skill_unsupported_storage`。
- `apps/web/src/shared/i18n/index.tsx:2122` — `commonApiErrorMessages[input.locale][input.code]` —— 运行时用任意 string 查表。

## 影响

API 返回新错误码时，前端会回退到服务端 message 或 fallback。若服务端 message 不够本地化或包含实现细节，用户体验和安全口径都不稳定。

## 修复方向

把 error map 类型绑定到 shared error code union，或在 shared 暴露统一错误码集合，前端编译期缺项即报错。

## 建议动作

`cs-refactor`，因为这是契约同步机制整理。
