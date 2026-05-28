---
doc_type: audit-finding
audit: 2026-05-28-web-canvas-agent-runtime
finding_id: "bug-02"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: deferred
---

# Finding 02：Agent WebSocket 事件只校验 type 后就被当成完整事件处理

## 速答

Agent WebSocket 消息解析只要求 JSON 对象有字符串 `type`，随后 handler 按具体事件结构读取 `asset`、`jobId`、`planId` 等字段；畸形事件可能让 Agent 面板或画布更新路径抛错。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:2147` — `const parsed = JSON.parse(data) as unknown;` —— 解析后没有按事件类型做结构校验。
- `apps/web/src/features/canvas/CanvasApp.tsx:2148` — `typeof parsed.type === "string" ? (parsed as unknown as AgentServerEvent)` —— 只凭 `type` 就强转为完整 `AgentServerEvent`。
- `apps/web/src/features/canvas/CanvasApp.tsx:5718` — `case "asset_preview": ... addAgentAssetPreview(event);` —— `asset_preview` 分支不再校验 `asset` 等字段。
- `apps/web/src/features/canvas/CanvasApp.tsx:5558` — `createImageShape(event.asset, ... event.asset.fileName)` —— 畸形 `asset_preview` 会直接解引用 `event.asset`。

## 影响

Agent WebSocket 是长连接路径，任何后端版本漂移、重连残包或异常事件都可能破坏当前会话体验。触发条件依赖服务端事件质量，置信度为 medium。

## 修复方向

为 `AgentServerEvent` 建立按 `type` 分支的运行时 guard，至少对 `asset_preview`、`job_completed`、`job_failed` 和 `error` 做字段校验后再更新画布。

## 建议动作

`cs-issue`，因为这是 WebSocket 输入边界导致的运行时稳定性风险。
