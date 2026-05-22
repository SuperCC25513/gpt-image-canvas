# 验证规范

## Shared 验证职责

`packages/shared/src/validation.ts` 放跨端都需要的纯函数验证，当前核心是图片尺寸：

- 最小边 `512`
- 最大边 `3840`
- 尺寸必须是 `16px` 倍数
- 长短边比例不超过 `3:1`
- 总像素范围 `655_360` 到 `8_294_400`
- preset 校验和 API size value 生成

这些规则同时被 Web 表单提示和 API 请求解析使用。

## 返回形态

验证函数返回 discriminated union：

```ts
{ ok: true, ... }
{ ok: false, code, message, reason? }
```

新增验证保持这个模式，便于 API 映射 error code、Web 映射 localized message。

## 消息和 reason

- `code` 是稳定机器码。
- `reason` 是 UI 可细分显示的原因。
- `message` 可以是中文 fallback，但 Web 仍应在 i18n 中提供用户文案。

## API 边界

Shared 验证不替代 API request parsing。API 仍需：

- 校验 JSON object。
- 校验字段类型。
- trim 字符串。
- 处理 preserve secret、legacy 字段、DB 存在性。

参考：`apps/api/src/server/http/validation.ts` 先解析字段，再调用 `validateSceneImageSize()`。

## 避免

- 在 shared 中读取环境变量、DB、filesystem。
- 在 shared 中返回 Hono response 或 HTTP status。
- 新增验证规则只改 Web，不改 API。
