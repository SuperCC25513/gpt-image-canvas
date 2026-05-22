# 错误处理

## API 响应格式

HTTP 错误统一返回：

```ts
{ error: { code: string, message: string } }
```

来源文件：`apps/api/src/server/http/errors.ts` 的 `errorResponse()`。

Route 中常见模式：

```ts
const payload = await readJson(c.req.raw);
if (!payload.ok) return c.json(payload.error, 400);

const parsed = parseGeneratePayload(payload.value);
if (!parsed.ok) return c.json(parsed.error, 400);
```

参考：`server/routes/images.ts`、`server/routes/provider-config.ts`。

## 请求解析

- 所有 JSON route 先用 `readJson()` 校验 content-type、空 body、JSON 语法。
- 业务字段解析放 `server/http/validation.ts` 的 `parse*Payload`。
- 解析函数返回 `ParseResult<T>`，不要 throw 作为正常用户输入错误。
- 用户可修复错误通常用 400，资源不存在用 404，provider 认证/上游问题由 `ProviderError.status` 映射。

## ProviderError

图片 provider 使用 `ProviderError` 表达可返回给客户端的稳定错误：

- `missing_api_key`
- `missing_provider`
- `unsupported_provider_behavior`
- `upstream_failure`

OpenAI/Codex SDK、fetch、超时、非图片结果在 `infrastructure/providers/image-provider.ts` 和 `codex-image-provider.ts` 中转换为 `ProviderError`。Route 捕获后用 `providerErrorJson()`。

## 用户消息和本地化

- API error code 要稳定；Web 用 `localizedApiErrorMessage()` 做本地化兜底。
- `packages/shared` 中新增错误 code 时，同步 `apps/web/src/shared/i18n/index.tsx` 的 `commonApiErrorMessages`。
- 当前 API 消息中英混用；新增面向用户的 API message 优先中文，Web 仍需提供 `zh-CN` 和 `en` 映射。

## 安全处理

- 不把 raw upstream error、token、API key、credential-bearing URL 直接返回给客户端。
- Codex 上游错误详情必须清洗，参考 `sanitizeCodexErrorDetail()`。
- 配置读取响应只返回 masked secret，参考 `maskedSecret()` / `maskSecret()`。

## 避免

- 在 route 中直接 `throw new Error("bad input")` 处理用户输入。
- 返回 OpenAI/Codex 原始响应体。
- 新增错误 code 但不更新 Web 本地化。
- 用 HTTP 200 包装失败业务状态，除非现有 response 类型明确这样设计。
