---
doc_type: audit-finding
audit: 2026-05-28-backend-provider-agent-config
finding_id: "security-01"
nature: security
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 01：Provider/Agent 配置接口只要求登录用户，却读写全局凭据和 base URL

## 速答

`/api/provider-config` 和 `/api/agent-config` 的 GET/PUT 都只调用 `requireAuth`，但保存的是全局 `active` provider/Agent 配置，包含 API key、base URL、模型和 source order；任意 active 用户都能读取 masked 配置并替换全局凭据或把 base URL 指向自定义地址。

## 关键证据

- `apps/api/src/server/routes/provider-config.ts:9` — `app.get("/api/provider-config", async (c) => {` —— provider 配置读取入口。
- `apps/api/src/server/routes/provider-config.ts:10` — `const auth = await requireAuth(c);` —— 只要求登录，不要求 admin。
- `apps/api/src/server/routes/provider-config.ts:18` — `app.put("/api/provider-config", async (c) => {` —— provider 配置保存入口。
- `apps/api/src/server/routes/provider-config.ts:19` — `const auth = await requireAuth(c);` —— 保存也只要求登录。
- `apps/api/src/server/routes/agent-config.ts:9` — `app.get("/api/agent-config", async (c) => {` —— Agent LLM 配置读取入口。
- `apps/api/src/server/routes/agent-config.ts:18` — `app.put("/api/agent-config", async (c) => {` —— Agent LLM 配置保存入口。
- `apps/api/src/server/routes/agent-config.ts:19` — `const auth = await requireAuth(c);` —— 保存 Agent API key/base URL 也只要求登录。
- `apps/api/src/domain/providers/provider-config.ts:25` — `const ACTIVE_PROVIDER_CONFIG_ID = "active";` —— provider 配置是全局单行。
- `apps/api/src/domain/agent/config.ts:6` — `const ACTIVE_AGENT_LLM_CONFIG_ID = "active";` —— Agent LLM 配置也是全局单行。
- `apps/api/src/domain/providers/provider-config.ts:70` — `localApiKey: local.localApiKey` —— 保存本地 OpenAI-compatible API key。
- `apps/api/src/domain/agent/config.ts:60` — `apiKey` —— 保存 Agent LLM API key。

## 影响

在多用户本地部署或注册开放时，普通用户可以替换所有人的图片 provider、Agent LLM provider、API key 和 base URL。即使响应只返回 masked key，写权限仍可导致全局服务不可用、费用走到错误账号，或让后端向用户控制的 OpenAI-compatible endpoint 发送生成 prompt、参考图和 Agent 上下文。

## 修复方向

明确配置所有权：如果配置是全局运行时能力，应把 GET/PUT 至少限制为 admin；如果要允许普通用户配置，则需要改为 per-user provider/Agent config，并确保生成和 Agent 执行只读取当前用户配置。

## 建议动作

`cs-issue`，因为这是权限边界问题，修复需要产品策略和后端鉴权一起确认。
