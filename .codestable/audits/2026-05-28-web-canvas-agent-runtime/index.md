---
doc_type: audit-index
audit: 2026-05-28-web-canvas-agent-runtime
scope: apps/web canvas runtime, tldraw integration, generation flow, Agent WebSocket orchestration
created: 2026-05-28
status: active
total_findings: 4
---

# web-canvas-agent-runtime 审计报告

## 范围

扫描 `apps/web/src/features/canvas/CanvasApp.tsx`、`apps/web/src/features/canvas/GenerationPlaceholderShape.tsx` 和 `apps/web/src/features/agent/AgentPlanNodeShape.tsx`。重点看画布自动保存、生成轮询、Agent WebSocket、tldraw shape 数据和长期会话内存。

## 总评

共发现 4 条：2 条 `bug`、1 条 `performance`、1 条 `maintainability`。最值得优先处理的是画布自动保存缺少服务端版本保护，旧 PUT 有机会覆盖新快照；其次是 Agent WebSocket 事件只做 `type` 字段检查，后续处理直接解引用事件内容。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | high | 自动保存请求乱序可能用旧快照覆盖新画布 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | medium | Agent WebSocket 事件只校验 type 后就被当成完整事件处理 | [finding-02.md](finding-02.md) |
| 3 | performance | P2 | medium | 资产元数据缓存是模块级 Map 且没有淘汰策略 | [finding-03.md](finding-03.md) |
| 4 | maintainability | P2 | high | CanvasApp 聚合太多运行时职责，局部审计和回归成本高 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 2 | 0 | 2 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 1 | 1 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **2** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-01、finding-02 建议开 `cs-issue`，先保护画布数据和 Agent 事件输入边界。
- **P2 有空再看**：finding-03、finding-04 建议走 `cs-refactor`，降低长期会话内存和 CanvasApp 维护成本。
