# API 质量规范

## 类型和契约

- 跨层类型从 `packages/shared` 来，API 通过 `domain/contracts.ts` 复用导出。
- 请求边界先把 `unknown` 缩窄为 typed request，再传给 domain/provider。
- 类型守卫集中写在本模块附近，例：`isRecord()`、`isProviderSourceOrder()`、`isExecutableGenerationPlan()`。
- 不要用 `as any` 穿透契约；确需绕 SDK 类型时要说明原因，例：OpenAI 图片尺寸 union 落后时 `imageGenerateRequestBody()` 有注释。

## 异步和取消

- 长任务使用 `AbortController` 和 `AbortSignal` 贯穿 provider、fetch、Agent run。
- 生成任务后台执行，不阻塞 POST 响应；记录先入库为 running，再轮询读取。
- 取消要更新状态并清理 active map，参考 `generation-tasks.ts` 的 `finally` 删除 task。
- WebSocket session 要保留断线宽限和 pending events，参考 `websocket-session.ts`。

## 并发和部分失败

- 批量图片生成用有限并发，当前 `BATCH_CONCURRENCY = 2`。
- 单个输出失败不能抹掉整条 generation record；outputs 保留成功/失败状态，record 可为 `partial`。
- 本地资产写入失败不能记录成成功输出；单个输出失败应写入 output error 并保留其他成功输出。

## Provider 和 secret

- Provider 选择顺序来自保存配置：环境 OpenAI、local OpenAI、Codex。
- Agent LLM 配置和图片 provider 配置是两个体系，不要假设同一个 provider/model。
- 保存 secret 时支持 preserve flag；读取时只返回 mask。

## Agent 计划执行

- Plan 是可检查 DAG。执行前必须验证 schema、job、edge、dependency source count。
- 被下游依赖的 source job count 必须为 `1`。
- `retry_failed` 保留已成功 job，重置失败/未完成 job。
- Agent events 必须保持 `packages/shared` 中的类型兼容。

## 验证命令

- 常规：`pnpm typecheck`
- 构建：`pnpm build`
- Agent/provider 改动可加 smoke：`pnpm --filter @gpt-image-canvas/api smoke:agent`、`smoke:executor`、`smoke:planner`

## 避免

- route 中做重业务或直接访问 SQLite。
- 新增 shared 字段但只改 API，不改 Web。
- 无界 `Promise.all` 处理大量图片/资产。
- 把取消当普通失败写成误导性错误。
