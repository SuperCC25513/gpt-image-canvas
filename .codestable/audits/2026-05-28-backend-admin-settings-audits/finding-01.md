---
doc_type: audit-finding
audit: 2026-05-28-backend-admin-settings-audits
finding_id: "security-01"
nature: security
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：generation audit 错误摘要只脱敏 Bearer/sk，后台会展示其他形态的上游敏感错误

## 速答

后台 generation audit 列表会返回 `errorSummary` 和每个 output 的 `error`；写入 audit 时只替换 `Bearer ...` 和 `sk-...`，无法覆盖 query string token、`api_key=...`、自定义 provider key、signed URL 等常见敏感错误形态。

## 关键证据

- `docs/SECURITY.md:56` — 后台响应允许 generation audit summaries，但不得包含 raw provider API keys、Agent API keys、OAuth tokens、cookies、DB 密码或未脱敏上游错误 payload。
- `apps/api/src/domain/admin/audit-store.ts:35` — `errorSummary: sanitizeAuditError(input.record.error)` —— generation audit 起始写入使用本地脱敏函数。
- `apps/api/src/domain/admin/audit-store.ts:121` — `const errorSummary = sanitizeAuditError(record.error ?? firstOutputError(record.outputs));` —— 最终状态也依赖同一脱敏函数。
- `apps/api/src/domain/admin/audit-store.ts:213` — `error: sanitizeAuditError(output.error) ?? undefined` —— output 错误同样进入 audit。
- `apps/api/src/domain/admin/audit-store.ts:224` — `.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")` —— 只覆盖 Bearer token。
- `apps/api/src/domain/admin/audit-store.ts:225` — `.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")` —— 只覆盖 `sk-` 形态 key。
- `apps/api/src/domain/admin/admin-store.ts:502` — `prompt: row.prompt` 和 `errorSummary: row.errorSummary ?? undefined` —— 后台 audit 查询直接返回已保存摘要。
- `apps/api/src/domain/admin/admin-store.ts:519` — `error: row.error ?? undefined` —— output 级错误也返回给后台。

## 影响

如果 OpenAI-compatible provider、代理、网关或 OSS 客户端把敏感信息放进错误消息，例如 `api_key=...`、`access_token=...`、`X-Api-Key: ...` 或带签名的 URL，当前规则不会清理，后台审计表会长期保存并展示这些内容。即使后台是 admin-only，这仍违背项目安全文档对 admin 响应的脱敏要求。

## 修复方向

把 provider 响应错误和 audit 持久化错误共用一套 secret redaction helper，覆盖 header、query 参数、常见 key 名、signed URL 参数和 OAuth token 形态，并加测试样例。

## 建议动作

`cs-issue`，因为这是安全边界缺口，修复需要明确脱敏规则和回归测试。
