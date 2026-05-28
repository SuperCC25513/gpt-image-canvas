---
doc_type: audit-finding
audit: 2026-05-28-web-provider-agent-config
finding_id: "maintainability-04"
nature: maintainability
severity: P2
confidence: medium
suggested_action: cs-refactor
status: deferred
---

# Finding 04：Base URL 和 timeout 校验散落在保存函数内

## 速答

配置表单只在 `saveProviderConfig` 内集中检查 timeout，Base URL 仅 trim 后发送；图片 provider 和 Agent LLM 的输入规则没有提成可复用解析层。

## 关键证据

- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:354` — `const timeoutMs = Number.parseInt(localForm.timeoutMs, 10);` —— 图片 provider timeout 校验写在保存函数里。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:381` — `(!Number.isInteger(agentTimeoutMs) || agentTimeoutMs <= 0)` —— Agent timeout 另写一份相似校验。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:398` — `baseUrl: localForm.baseUrl.trim()` —— 图片 provider Base URL 只 trim 后发送。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:407` — `baseUrl: agentForm.baseUrl.trim()` —— Agent Base URL 同样只 trim。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:596` 和 `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:799` —— 两个 Base URL 输入没有 `type="url"` 或共享验证提示。

## 影响

输入规则分散会让 provider 与 Agent 配置逐步漂移。Base URL 错误只能等 API 拒绝或后续调用失败，用户反馈不够直接。

## 修复方向

提取 `parseProviderConfigForm` / `parseAgentConfigForm`，统一 trim、URL 校验、timeout 范围和错误文案。

## 建议动作

`cs-refactor`，因为这是输入解析职责整理。
