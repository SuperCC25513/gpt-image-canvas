---
doc_type: audit-finding
audit: 2026-05-28-backend-generation-credits
finding_id: "security-02"
nature: security
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 02：OpenAI/custom provider 原始错误可进入用户响应或生成历史

## 速答

OpenAI-compatible provider 会把 SDK/API 的 `error.message` 直接包装成 `ProviderError`；随后错误响应和生成记录只做很窄的 Bearer/sk 脱敏，无法覆盖自定义 provider 返回的 header、URL、账号、请求 ID 或其他内部细节。

## 关键证据

- `apps/api/src/infrastructure/providers/image-provider.ts:197` — `if (error instanceof APIError)` —— 捕获 OpenAI SDK APIError。
- `apps/api/src/infrastructure/providers/image-provider.ts:198` — `return new ProviderError("upstream_failure", error.message || ..., ...)` —— 直接使用上游 `error.message`。
- `apps/api/src/infrastructure/providers/image-provider.ts:201` — `if (error instanceof Error && error.message)` —— 兜底捕获任意 Error。
- `apps/api/src/infrastructure/providers/image-provider.ts:202` — `return new ProviderError("upstream_failure", error.message, 502);` —— 任意错误 message 也直接进入 ProviderError。
- `apps/api/src/server/http/errors.ts:34` — `export function providerErrorJson(...)` —— ProviderError 直接转 HTTP 错误响应。
- `apps/api/src/server/http/errors.ts:35` — `const body = errorResponse(error.code, error.message);` —— 响应体使用原 message。
- `apps/api/src/domain/generation/image-generation.ts:851` — `function errorToMessage(error: unknown)` —— 生成失败记录会使用 ProviderError message。
- `apps/api/src/domain/generation/image-generation.ts:861` — `function sanitizeGenerationErrorMessage(message: string)` —— 仅替换 `Bearer ...` 和 `sk-...` 两类模式。

## 影响

`docs/SECURITY.md` 要求不要把 raw upstream provider errors 直接传给客户端，也不要暴露 credential-bearing URL、headers 或内部细节。当前 OpenAI-compatible provider 支持自定义 `OPENAI_BASE_URL`，上游错误内容不受本项目控制；窄脱敏容易漏掉非 `sk-` 格式 token、查询串密钥、组织/账号 ID、内部 URL 或代理错误详情。

## 修复方向

Provider 层统一返回稳定、安全的用户错误文案；原始上游详情只写受控日志且先脱敏，或只保留短 request id。`providerErrorJson` 和 generation record/audit 共享同一套错误净化策略。

## 建议动作

`cs-issue`，因为这是安全边界 bug，涉及 API 响应和持久化错误摘要。

