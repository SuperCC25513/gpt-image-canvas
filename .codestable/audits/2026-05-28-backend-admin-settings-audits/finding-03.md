---
doc_type: audit-finding
audit: 2026-05-28-backend-admin-settings-audits
finding_id: "bug-03"
nature: bug
severity: P2
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 03：后台积分和设置数字字段用 `parseInt`，会接受 `10abc` 这类部分非法值

## 速答

管理端积分调整和系统设置的数字解析使用 `Number.parseInt`，字符串只要前缀是数字就会被接受；例如 `"10abc"` 会变成 `10`，超出 safe integer 的值也没有统一拒绝。

## 关键证据

- `apps/api/src/server/http/validation.ts:237` — `export function parseAdminCreditAdjustmentPayload(...)` —— 后台积分调整校验入口。
- `apps/api/src/server/http/validation.ts:252` — `const amount = parseInteger(input.amount);` —— 调整金额使用宽松解析。
- `apps/api/src/server/http/validation.ts:366` — `export function parseAdminSettingsPayload(...)` —— 后台设置校验入口。
- `apps/api/src/server/http/validation.ts:389` — `const amount = parseInteger(input[key]);` —— 积分设置使用同一宽松解析。
- `apps/api/src/server/http/validation.ts:401` — `const maxImagesPerRequest = parseInteger(input.maxImagesPerRequest);` —— 单次生成上限也用同一宽松解析。
- `apps/api/src/server/http/validation.ts:990` — `function parseInteger(value: unknown): number | undefined` —— helper 对字符串执行 `Number.parseInt(value.trim(), 10)`。
- `apps/api/src/server/http/validation.ts:998` — `return Number.isInteger(parsed) ? parsed : undefined;` —— 没有校验整个字符串是否为整数，也没有 `Number.isSafeInteger`。
- `apps/api/src/server/http/validation.ts:1001` — `function parseStrictInteger(value: unknown): number | undefined` —— 同文件已有严格整数解析，但后台积分/设置没有复用。

## 影响

管理员输入或前端状态异常时，`"100credits"`、`"1.9"`、`"10abc"` 这类值会被静默截断为整数并保存或入账。对于积分调整，静默转换会生成真实交易流水；对于系统设置，会让保存结果和用户输入不一致，增加排查成本。

## 修复方向

管理端数字字段统一改用严格 safe integer 解析：字符串必须完全匹配整数格式，数值必须 `Number.isSafeInteger`，并保留现有业务范围校验。

## 建议动作

`cs-issue`，因为这是输入校验 bug，适合加表驱动校验测试。
