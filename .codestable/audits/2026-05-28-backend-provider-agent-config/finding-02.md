---
doc_type: audit-finding
audit: 2026-05-28-backend-provider-agent-config
finding_id: "bug-02"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 02：masked secret 回传时会被当成真实 API key 保存，缺少后端防误写

## 速答

配置读取接口返回 `MaskedSecret.value`；保存接口只要看到非空 `apiKey` 字符串就直接保存为新 key。如果客户端把 masked value 原样回传但没有同时设置 `preserveApiKey=true`，后端会把形如 `sk-p********abcd` 的展示值写进数据库，真实 key 被覆盖。

## 关键证据

- `packages/shared/src/provider-config.ts:8` — `export interface MaskedSecret { hasSecret: boolean; value?: string; }` —— 共享契约允许响应带 masked value。
- `apps/api/src/domain/providers/provider-config.ts:196` — `apiKey: maskedSecret(row?.localApiKey)` —— provider 配置读取返回 masked key。
- `apps/api/src/domain/providers/provider-config.ts:335` — `function maskSecret(value: string): string` —— 生成可展示的 masked 字符串。
- `apps/api/src/server/http/validation.ts:720` — `if (Object.hasOwn(input, "apiKey")) { ... config.apiKey = input.apiKey; }` —— provider 保存 payload 接受任意字符串。
- `apps/api/src/domain/providers/provider-config.ts:246` — `if (typeof input.apiKey === "string") {` —— 保存时只判断是否是字符串。
- `apps/api/src/domain/providers/provider-config.ts:248` — `if (trimmed) { return trimmed; }` —— 任意非空字符串都会成为新的 raw key。
- `packages/shared/src/agent.ts:10` — `export interface AgentLlmConfigView { ... apiKey: MaskedSecret; ... }` —— Agent 配置也返回 masked key。
- `apps/api/src/domain/agent/config.ts:102` — `apiKey: maskedSecret(apiKey)` —— Agent config 读取返回 masked key。
- `apps/api/src/domain/agent/config.ts:116` — `if (typeof input.apiKey === "string") {` —— Agent 保存同样把任意非空 `apiKey` 当新 key。
- `apps/api/src/domain/agent/config.ts:118` — `if (trimmed) { return trimmed; }` —— 没有识别 masked value。

## 影响

当前前端如果严格发送 `preserveApiKey` 可以避开问题，但后端契约本身不防误用。任何脚本、未来页面重构、表单序列化或第三方客户端只要把 GET 响应里的 masked value 带回 PUT，就会把真实 key 覆盖成无效字符串，导致生成或 Agent 运行突然失败。

## 修复方向

后端保存时识别当前 masked value 并视为 preserve，或改契约为响应不返回 `value`、只返回 `hasSecret`；同时对新 key 做最小格式校验并加保存回归测试。

## 建议动作

`cs-issue`，因为这是 secret preserve 语义 bug，会直接破坏生产配置。
