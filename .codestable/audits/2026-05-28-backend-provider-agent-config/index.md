---
doc_type: audit-index
audit: 2026-05-28-backend-provider-agent-config
scope: Backend image provider configuration, Codex fallback selection, Agent LLM configuration, and provider error handling.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-provider-agent-config 审计报告

## 范围

本次审计覆盖 provider 与 Agent LLM 配置：

- `apps/api/src/server/routes/provider-config.ts`
- `apps/api/src/server/routes/agent-config.ts`
- `apps/api/src/domain/providers/provider-config.ts`
- `apps/api/src/domain/providers/image-provider-selection.ts`
- `apps/api/src/domain/agent/config.ts`
- `apps/api/src/infrastructure/providers/image-provider.ts`
- `apps/api/src/infrastructure/providers/codex-image-provider.ts`
- `packages/shared/src/provider-config.ts`
- `packages/shared/src/agent.ts`
- `docs/PRODUCT_SENSE.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`

## 总评

共发现 3 条问题：`security` 1 条、`bug` 1 条、`arch-drift` 1 条；严重度为 P1 2 条、P2 1 条。默认 provider 顺序和产品文档一致，Agent LLM 与图片 provider 也保持了独立配置；响应侧会返回 masked secret 而不是 raw key。主要风险是配置接口只要求登录却修改全局凭据和 base URL、后端无法识别 masked secret 回传导致覆盖真实 key，以及 MySQL 已建配置表但域逻辑完全忽略这些表。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P1 | high | Provider/Agent 配置接口只要求登录用户，却读写全局凭据和 base URL | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | medium | masked secret 回传时会被当成真实 API key 保存，缺少后端防误写 | [finding-02.md](finding-02.md) |
| 3 | arch-drift | P2 | high | MySQL 初始化了 provider/Agent 配置表，但配置域逻辑完全不读写 MySQL | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 0 | 1 |
| security | 0 | 1 | 0 | 1 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 1 | 1 |
| **合计** | **0** | **2** | **1** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01 建议走 `cs-issue`，明确 provider/Agent 配置是否 admin-only；Finding 02 建议走 `cs-issue`，后端识别 masked secret 或强制 preserve 语义，避免误覆盖密钥。
- **P2 有空再看**：Finding 03 建议走 `cs-refactor` 或 roadmap 子任务，决定 MySQL 是否支持本地配置表；不支持就移除/标注表，不要保留不可达 schema。
