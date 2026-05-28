---
doc_type: audit-index
audit: 2026-05-28-web-shared-i18n-contracts
scope: shared frontend i18n catalog, API response guards, and error mapping contracts
created: 2026-05-28
status: active
total_findings: 4
---

# web-shared-i18n-contracts 审计报告

## 范围

扫描 `apps/web/src/shared/i18n/index.tsx`、`apps/web/src/shared/api/generation.ts`，并对照 `packages/shared/src/auth.ts`、`packages/shared/src/agent.ts` 中的共享错误码类型，以及 `CanvasApp.tsx` 对生成响应的本地 guard。

## 总评

共发现 4 条：2 条 `bug`、1 条 `maintainability`、1 条 `arch-drift`。最值得先处理的是 `CanvasApp` 没有复用 shared 的严格生成响应 guard，而是本地定义了只检查 `record` 字段存在的弱 guard；这会绕过 `shared/api/generation.ts` 已有校验。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | high | CanvasApp 本地生成响应 guard 比 shared guard 弱很多 | [finding-01.md](finding-01.md) |
| 2 | bug | P2 | high | shared 错误码类型和 i18n 错误映射没有编译期同步 | [finding-02.md](finding-02.md) |
| 3 | maintainability | P2 | high | i18n 函数消息参数类型靠 any 和 never cast 维持 | [finding-03.md](finding-03.md) |
| 4 | arch-drift | P2 | medium | API guard 覆盖范围不均，多个新前端域回到本地浅校验 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 1 | 2 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 1 | 1 |
| **合计** | **0** | **1** | **3** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-01 建议开 `cs-issue`，让 CanvasApp 使用 shared 严格 guard。
- **P2 有空再看**：finding-02、finding-03、finding-04 建议走 `cs-refactor`，统一错误码和响应解析体系。
