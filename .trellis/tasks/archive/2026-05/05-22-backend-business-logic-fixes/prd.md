# 修复后端业务逻辑风险

## Goal

修复静态代码审查发现的后端业务逻辑风险，重点保护本地账户边界、全局 Codex OAuth 登录态、Agent 执行计划可信来源，以及私有资产读取权限。

## Confirmed Facts

- 项目安全模型要求登录后才能使用 creative、Gallery、asset、provider、Agent、prompt-favorite API。
- Codex OAuth token 是本地运行时数据中的全局 provider 登录态，不属于单个用户的临时会话状态。
- `/api/auth/codex/device/start`、`/api/auth/codex/device/poll`、`/api/auth/codex/logout` 当前未鉴权，其中 `poll` 会写入 token，`logout` 会删除 token。
- Agent 执行阶段当前允许客户端传入的 `message.plan` 覆盖服务端会话中保存的 plan。
- Agent executor 当前通过 `readStoredAsset()` 读取参考资产，读取点未调用 `userCanReadAsset()`。
- 普通资产 HTTP 路由在读取前已有 owner/public 权限校验，可作为期望行为参考。
- 注册审核开启时，注册接口会先插入 pending 用户，再抛 `account_inactive` 403，导致客户端视角像失败，但邮箱已被占用。

## Requirements

- Codex OAuth 状态读取和登录态修改接口必须落在本地账户鉴权边界内。
- 修改全局 Codex OAuth 登录态的接口必须限定管理员调用。
- Agent `execute_plan` / `retry_failed` 执行时，服务端已保存 plan 必须是可信事实来源；客户端不能用同 id plan 覆盖服务端 plan。
- Agent 读取任何存储资产作为参考图前，必须执行与 HTTP asset 路由一致的 `userCanReadAsset()` 校验。
- 注册审核开启时，接口创建 pending 用户后必须返回“已提交审核”的成功态，不创建 session，不能“落库后返回失败”。
- 不扩大本次范围到前端 UI 重构、数据库迁移、公开部署加固、完整多租户隔离。

## Acceptance Criteria

- [x] 未登录请求不能读取或修改 Codex OAuth 登录态。
- [x] 非授权角色不能调用会修改全局 Codex OAuth token 的接口。
- [x] 授权角色仍可完成 Codex device login、poll 和 logout。
- [x] 客户端篡改 `execute_plan` 消息里的 prompt、jobs、references 后，服务端不会执行篡改后的 plan。
- [x] 未知 `planId` 仍返回 `unknown_agent_plan`。
- [x] Agent 引用当前用户无权读取的 assetId 时执行失败，且不会把资产内容传给 provider。
- [x] Agent 可继续引用当前用户自己的资产，以及现有规则允许读取的公开输出关联资产。
- [x] 审核开启时注册接口创建 pending 用户并返回 pending 成功态，不设置 session cookie。
- [x] pending 用户重复注册仍返回邮箱已注册。
- [x] 通过 `pnpm typecheck` 和 `pnpm build`。
- [x] Agent/provider 相关 smoke 按影响范围执行，至少覆盖 executor 或 planner 相关路径。

## Notes

- 本次是后端安全和业务逻辑修复，不改变生成 provider 的核心调用协议。
- 已确认：Codex OAuth device start、poll、logout 限定管理员调用。
- 已确认：注册审核开启时采用 pending 成功态，保留 pending 用户，不创建 session。

## Open Questions

- 暂无。

## Verification

- `pnpm --filter @gpt-image-canvas/api smoke:executor` 通过。
- `pnpm --filter @gpt-image-canvas/api smoke:planner` 通过。
- 临时 `.codex-temp` 数据目录下的 auth route smoke 通过，覆盖 Codex OAuth 鉴权和 pending 注册语义。
- `pnpm typecheck` 通过。
- `pnpm build` 通过，Vite 保留既有 large chunk warning。
