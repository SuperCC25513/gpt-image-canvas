# 日志规范

## 当前日志形态

项目没有日志库，使用少量 `console`：

- `server/app.ts` 的全局 `app.onError` 打印未处理异常，并返回 `internal_error`。
- `server/app.ts` 静态资源 fallback 找不到 build bundle 时打印路径和构建提示。
- `index.ts` 启动时打印监听地址。
- `infrastructure/database.ts` 在 WAL 不可用且可降级时 `console.warn`。
- `server/http/validation.ts` 的 `logProjectSaveRejected()` 只记录 sanitized header 摘要。

## 该记录什么

- 启动、关闭、存储降级这类运维状态。
- 被拒绝的大请求摘要：只记录 content-length、content-type、transfer-encoding，且先清洗 CR/LF。
- 可恢复的配置/环境降级。

## 不该记录什么

- `.env` 内容、API key、OAuth token、Authorization header。
- 用户 prompt、生成图片 data URL、base64、完整快照 JSON，除非明确做本地 debug 且不会提交。
- provider 原始请求/响应体。
- 本机绝对路径作为客户端错误；server-only warn 可短暂出现，但不要传给 Web。

## 新增日志规则

- 优先在错误转换点清洗敏感信息，参考 `sanitizeCodexErrorDetail()`。
- 记录用户输入错误时，只记录 stable code 和体积/类型摘要，不记录 body。
- 后台任务失败如果要落库，先走 `sanitizeGenerationErrorMessage()`，避免超长或敏感内容。

## 避免

- 临时 `console.log(payload)`、`console.log(config)` 留在提交中。
- 在 catch 中吞错且无状态更新；生成任务至少要更新 record/job 状态。
- 为了调试 Docker config 运行会展开 secret 的命令；有真实 `.env` 时只能用 `docker compose config --quiet --no-env-resolution`。
