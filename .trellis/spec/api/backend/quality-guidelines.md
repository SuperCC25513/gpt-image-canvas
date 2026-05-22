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
- Codex OAuth token 是全局 provider 登录态。读取状态必须要求登录；device start、poll、logout 这类会创建、替换或删除 token 的接口必须要求管理员。

## Agent 计划执行

- Plan 是可检查 DAG。执行前必须验证 schema、job、edge、dependency source count。
- WebSocket 执行 `execute_plan` / `retry_failed` 时，服务端 `session.plans.get(planId)` 是可信来源；客户端传入的 `message.plan` 不得覆盖服务端 plan。
- 被下游依赖的 source job count 必须为 `1`。
- `retry_failed` 保留已成功 job，重置失败/未完成 job。
- 读取 selected/generated reference 的存储资产前必须传入当前用户并调用 `userCanReadAsset()`；不能直接 `readStoredAsset()`。
- Agent events 必须保持 `packages/shared` 中的类型兼容。

## Scenario: 全局 OAuth 与 Agent 执行权限边界

### 1. Scope / Trigger

- Trigger: 修改 provider OAuth、Agent WebSocket 执行、Agent reference asset 读取时必须检查账户边界。

### 2. Signatures

- `GET /api/auth/status` -> `AuthStatusResponse`，需要 active session。
- `POST /api/auth/codex/device/start|poll|logout` -> Codex auth responses，需要 admin session。
- `executeGenerationPlan(input)` 的 `input.user?: CurrentUser` 必须沿用到 reference asset 读取。

### 3. Contracts

- Codex OAuth token 是全局状态，不是当前普通用户的个人 token。
- Agent 执行只能执行服务端保存的 plan。
- Agent reference asset 读取必须复用 `userCanReadAsset(assetId, user)` 的 owner/admin/public-output 判定。

### 4. Validation & Error Matrix

- 未登录读 `/api/auth/status` -> `401 unauthorized`。
- 普通用户调用 Codex OAuth mutation -> `403 forbidden`。
- 未知 Agent `planId` -> `unknown_agent_plan`。
- Agent reference asset 不存在或无权读取 -> reference unavailable，不能暴露资产是否存在。

### 5. Good/Base/Bad Cases

- Good: WebSocket 消息带篡改后的 `message.plan`，executor 仍使用 `session.plans` 中的 plan。
- Base: Agent 使用当前用户自己的 selected reference asset，执行成功。
- Bad: executor 根据客户端 plan 里的 asset id 直接 `readStoredAsset()`，会绕过 asset route 的 owner/public 校验。

### 6. Tests Required

- API route smoke 覆盖匿名、普通用户、管理员的 Codex OAuth 权限。
- Agent executor smoke 必须传入 `CurrentUser`，确认 generated/selected reference 读取仍成功。
- 类型检查必须覆盖 `input.user` 到 `storedAssetReference()` 的传递。

### 7. Wrong vs Correct

#### Wrong

```ts
const stored = await readStoredAsset(assetId);
```

#### Correct

```ts
if (await userCanReadAsset(assetId, user)) {
  const stored = await readStoredAsset(assetId);
}
```

## 验证命令

- 常规：`pnpm typecheck`
- 构建：`pnpm build`
- Agent/provider 改动可加 smoke：`pnpm --filter @gpt-image-canvas/api smoke:agent`、`smoke:executor`、`smoke:planner`

## 避免

- route 中做重业务或直接访问 SQLite。
- 新增 shared 字段但只改 API，不改 Web。
- 无界 `Promise.all` 处理大量图片/资产。
- 把取消当普通失败写成误导性错误。
