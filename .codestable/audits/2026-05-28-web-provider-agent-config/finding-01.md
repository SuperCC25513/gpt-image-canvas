---
doc_type: audit-finding
audit: 2026-05-28-web-provider-agent-config
finding_id: "bug-01"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: deferred
---

# Finding 01：图片 provider 和 Agent LLM 配置保存不是原子操作

## 速答

保存按钮先 PUT `/api/provider-config`，应用返回并刷新 auth status 后，才 PUT `/api/agent-config`；第二步失败会留下图片配置已保存、Agent 配置未保存的半成功状态。

## 关键证据

- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:415` — `fetch("/api/provider-config", { method: "PUT", ... })` —— 第一段请求先保存图片 provider。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:426` — `const savedConfig = (await response.json()) as ProviderConfigResponse;` —— 第一段返回后立即读取配置。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:427` — `applyProviderConfig(savedConfig);` —— 图片配置先更新到 UI。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:432` — `fetch("/api/agent-config", { method: "PUT", ... })` —— Agent LLM 第二段保存独立执行。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:439` — `if (!agentResponse.ok) { throw new Error(...) }` —— 第二段失败时不会回滚第一段。

## 影响

用户看到保存失败，但一部分配置已经生效。Provider source order 和 Agent LLM 独立配置都是信任关键路径，半成功状态容易导致后续生成可用但 Agent 不可用，或反过来。

## 修复方向

拆成两个明确保存动作，或提供后端组合事务接口；至少在 UI 文案中准确说明哪个配置已保存、哪个失败。

## 建议动作

`cs-issue`，因为这是配置一致性 bug。
