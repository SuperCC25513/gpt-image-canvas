# 后端业务逻辑风险修复设计

## 架构边界

- Route 层负责鉴权、请求解析和错误响应。
- Domain 层负责业务状态变更、Agent 执行、资产读取和 provider 调用。
- Storage 层提供资产归属和公开可读判定，读取资产内容前必须先完成权限判断。
- Shared 契约变更只在注册返回语义需要新增字段时触发；其余修复优先保持既有 API contract。

## Codex OAuth 鉴权

涉及路由：

- `GET /api/auth/status`
- `POST /api/auth/codex/device/start`
- `POST /api/auth/codex/device/poll`
- `POST /api/auth/codex/logout`

设计：

- `GET /api/auth/status` 加 `requireAuth`。
- `start`、`poll`、`logout` 使用 `requireAdmin`，因为它们创建、替换或删除全局 Codex OAuth token。
- 错误响应复用现有 auth helper，保持 401/403 语义。

取舍：

- 已确认管理员限定。该决策会牺牲普通用户自助连接 Codex 的便利性。
- 但当前 token 是全局 provider 状态，不是每用户状态，普通用户修改会影响其他账户，管理员限定更符合本地账户边界。

## Agent Plan 可信来源

涉及代码：

- `resolveStoredPlanForExecution()`
- `handleAgentPlanExecutionMessage()`
- `isExecutableGenerationPlan()`

设计：

- 执行已保存 plan 时，只使用 `session.plans.get(message.planId)`。
- 客户端 `message.plan` 不能覆盖已有服务端 plan。
- 若要保留“从 canvas node payload 执行”的能力，必须独立命名为 fallback 分支，且仅在 `session.plans` 没有该 plan 时生效。
- fallback 分支也必须执行结构校验和资产引用权限校验，不能只依赖 `isExecutableGenerationPlan()`。

取舍：

- 严格只执行服务端 plan 最安全，但可能影响旧客户端从 canvas payload 直接执行历史 plan 的能力。
- 保留 fallback 兼容性需要更多校验，复杂度更高。建议第一版优先服务端 plan，旧 payload 能力若仍需要再补受控路径。

## Agent 参考资产权限

涉及代码：

- `resolveGenerationReference()`
- `storedAssetReference()`
- `userCanReadAsset()`

设计：

- `storedAssetReference(assetId, user)` 接收当前用户。
- 对 `storedAssetIdCandidates(assetId)` 的每个 candidate，先调用 `userCanReadAsset(candidate, user)`。
- 只有权限通过后才允许 `readStoredAsset(candidate)` 并转成 provider reference image。
- `resolveGenerationReference()` 所有调用点传入 `input.user`。
- 生成 job 输出引用也走同一校验，防止客户端伪造输出 asset id。

错误策略：

- 无权限和不存在都按“不可用 reference”处理，不暴露资产是否真实存在。
- WebSocket 仍通过现有 `agent_execution_failed` 事件传达失败。

## 注册审核语义

涉及代码：

- `registerUser()`
- `RegisterResponse` / Web 注册处理，如需要新增 pending 返回类型。

推荐设计：

- 保留 pending 用户落库。
- 已确认采用 pending 成功态：审核开启时返回成功业务状态，例如 `status: "pending"` 和中文消息。
- 不创建 session。
- 默认积分发放时机保持现状：pending 用户不可登录，积分暂不作为可用余额暴露给客户端；若后续要改成激活时发放，另起任务处理。

备选设计：

- 审核开启时不落库，直接拒绝注册。这会失去审核队列能力，不推荐。

## 兼容性和迁移

- Codex OAuth 鉴权变化会影响未登录或普通用户调用 provider 登录态接口。
- Agent plan 执行收紧可能影响旧的客户端 payload 直执行路径，需要通过 Web 代码确认当前前端是否依赖该路径。
- 注册 pending 返回会改 shared response，必须同步 Web 类型和本地化。
- 不需要数据库迁移，除非决定把 pending 用户默认积分移动到激活流水。

## 回滚

- Codex OAuth 权限可单独回滚到 `requireAuth`。
- Agent plan 来源和资产权限校验应作为安全修复保留，不建议回滚。
- 注册审核语义修复可与安全修复拆分提交，降低产品行为变更风险。
