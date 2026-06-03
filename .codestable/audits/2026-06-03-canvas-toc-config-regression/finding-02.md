---
doc_type: audit-finding
status: resolved
severity: P2
nature: bug
confidence: high
suggested_action: cs-issue
---

# Agent 状态刷新失败后旧的可用状态仍可放行发送

## 证据

- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:3290) `isAgentConfigured` 只看 `agentConfig?.configured`。
- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:3292) `canSendAgentMessage` 不检查 `agentConfigError`。
- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:3450) `loadAgentConfig()` 刷新 `/api/agent-config/status`。
- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:3469) catch 分支只设置 `agentConfigError`，没有清空 `agentConfig`。
- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:6928) UI 会优先显示 `agentConfigError` 文案，但图标和标题仍由旧的 `isAgentConfigured` 决定。

## 为什么是问题

触发序列：

1. `/api/agent-config/status` 曾经返回 `{ configured: true }`，前端保存 `agentConfig.configured = true`。
2. 用户点击重新检查，或后台保存后触发刷新。
3. 状态接口因为网络、服务、响应结构错误失败。
4. catch 只写 `agentConfigError`，旧 `agentConfig` 仍保留。
5. `canSendAgentMessage` 继续按旧 `configured=true` 放行发送。

这会造成 UI 同时显示错误提示和“Agent 可用”状态，并且仍允许发送 Agent 消息。它不符合缺少或无法确认 Agent 服务时应阻止执行的验收口径。

## 影响

- 服务状态不可确认时，用户仍可能提交 Agent 请求。
- 画布 Agent 头部状态自相矛盾：错误文案 + 可用标题 / 可用图标。
- 后端若随后拒绝 WebSocket 或规划请求，用户会收到更晚、更弱的错误反馈。

## 建议

状态刷新失败时清空或标记 `agentConfig` 为不可用，或者把 `agentConfigError` 纳入 `isAgentConfigured` / `canSendAgentMessage` 判定。UI 标题也应在 error 状态下显示“检查失败 / Agent 暂不可用”，不要继续使用旧的 ready 状态。

## 修复记录

- 已在 `loadAgentConfig()` 的 catch 分支调用 `setAgentConfig(null)`。
- 状态接口失败或响应结构异常时，旧的 `configured=true` 不再保留。
- `canSendAgentMessage` 继续基于 `isAgentConfigured` 判定，因此状态不可确认时会阻止发送。
