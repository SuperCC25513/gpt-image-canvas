---
doc_type: audit-finding
audit: 2026-05-28-web-provider-agent-config
finding_id: "bug-02"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 02：配置响应被强转后直接应用到表单和运行状态

## 速答

Provider 和 Agent 配置接口返回值都被 `as ProviderConfigResponse` / `as AgentLlmConfigView` 强转后直接写入表单，没有运行时 guard。

## 关键证据

- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:140` — `const body = (await response.json()) as ProviderConfigResponse;` —— provider load 响应直接强转。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:145` — `applyProviderConfig(body);` —— 强转数据直接进入 UI。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:175` — `const body = (await response.json()) as AgentLlmConfigView;` —— Agent load 响应直接强转。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:426` — `const savedConfig = (await response.json()) as ProviderConfigResponse;` —— 保存响应也没有 guard。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:442` — `savedAgentConfig = (await agentResponse.json()) as AgentLlmConfigView;` —— Agent 保存响应同样强转。

## 影响

配置接口一旦发生字段缺失、旧版本响应或代理错误 JSON，页面可能渲染错误状态，甚至用错误的 source order、timeout 或 secret mask 继续保存。

## 修复方向

为 `ProviderConfigResponse` 和 `AgentLlmConfigView` 补运行时解析器；失败时保留旧配置并显示稳定错误。

## 建议动作

`cs-issue`，因为这是配置边界数据校验缺失。
