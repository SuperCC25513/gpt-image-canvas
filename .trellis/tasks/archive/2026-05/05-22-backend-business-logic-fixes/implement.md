# 实施计划

## 前置确认

- 已确认 Codex OAuth 修改全局 token 的接口限定管理员。
- 已确认注册审核开启时采用 pending 成功态，保留 pending 用户，不创建 session。

## 实施步骤

1. 修复 Codex OAuth 鉴权。
   - 在 `apps/api/src/server/routes/auth.ts` 为 `auth/status` 加登录校验。
   - 为 Codex device start/poll/logout 加管理员权限校验。
   - 保持 ProviderError 映射不变。

2. 修复 Agent plan 执行可信来源。
   - 修改 `resolveStoredPlanForExecution()`，不允许客户端 `message.plan` 覆盖 `session.plans` 中的 plan。
   - 保留或移除 canvas payload fallback，按确认后的兼容策略实现。
   - 确认 `selectedReferences` 的来源仍经过 `persistAgentSelectedReferences()` 或权限校验。

3. 修复 Agent 参考资产权限。
   - 修改 `storedAssetReference()` 签名，传入 `CurrentUser`。
   - 读取资产前调用 `userCanReadAsset()`。
   - 所有 selected/generated reference 路径统一使用该 helper。

4. 修复注册审核返回语义。
   - 调整 `registerUser()` 返回类型、shared contract 和 Web 注册处理。
   - pending 注册成功时不调用 `setSessionCookie()`。
   - 返回清晰的 pending 状态和用户可理解消息。
   - 默认积分发放时机保持现状，后续如需激活时发放另起任务。

5. 补充验证。
   - 静态检查相关调用点和 shared 类型。
   - 如项目已有 smoke 可覆盖，执行 Agent executor/planner smoke。
   - 最终执行根 `pnpm typecheck` 和 `pnpm build`。

## 验证命令

按项目要求先使用 Node 24.15.0：

```bash
nvm use 24.15.0
pnpm --filter @gpt-image-canvas/api smoke:executor
pnpm --filter @gpt-image-canvas/api smoke:planner
pnpm typecheck
pnpm build
```

如果 `better-sqlite3` 出现 `NODE_MODULE_VERSION` 不匹配：

```bash
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## 高风险文件

- `apps/api/src/server/routes/auth.ts`
- `apps/api/src/domain/providers/codex-auth.ts`
- `apps/api/src/domain/agent/websocket-session.ts`
- `apps/api/src/domain/agent/executor.ts`
- `apps/api/src/domain/auth/auth-store.ts`
- `packages/shared/src/*`
- `apps/web/src/*` 中注册响应处理相关文件

## 回滚点

- Codex OAuth 鉴权可独立提交。
- Agent plan 来源和资产权限应同批提交，避免只修一半。
- 注册审核语义建议独立提交，便于产品行为单独回滚。
