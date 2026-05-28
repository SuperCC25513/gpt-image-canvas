---
doc_type: audit-finding
audit: 2026-05-28-web-provider-agent-config
finding_id: "security-03"
nature: security
severity: P2
confidence: low
suggested_action: cs-issue
status: resolved
---

# Finding 03：secret 展示组件完全信任 API 返回的 masked value

## 速答

前端 secret 展示只靠 `masked` 样式标记，不校验或限制显示值；如果 API 回归返回了原始 key，UI 会按普通文本展示出来。

## 关键证据

- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:726` — `<MiniRow label="Key" masked value={envSource?.secret.value ?? ...} />` —— env secret 的展示值直接来自响应。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:978` — `function MiniRow({ label, masked = false, value }: ... )` —— 展示组件只接受 value。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:982` — `<dd data-masked={masked}>{value}</dd>` —— masked 只是 DOM 属性，未对 value 做二次脱敏。
- `docs/SECURITY.md:34` — `Read APIs should return masked secrets only.` —— 当前安全模型把脱敏责任放在读 API，但 UI 没有防御性兜底。

## 影响

正常情况下 API 应只返回掩码，所以置信度为 low；但配置页本身是 secret 视图，一旦后端脱敏回归，前端会直接泄露。

## 修复方向

对 `masked` 行做前端兜底：只允许显示短掩码或固定文案，拒绝显示疑似完整 key；同时补 API 响应测试。

## 建议动作

`cs-issue`，因为这是 secret 防御纵深问题。
