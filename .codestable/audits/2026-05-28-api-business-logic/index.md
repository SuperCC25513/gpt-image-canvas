---
doc_type: audit-index
audit: 2026-05-28-api-business-logic
scope: apps/api backend business logic, focused on generation credits, cancellation, storage-driver branching, and Agent service routes
created: 2026-05-28
status: active
total_findings: 2
---

# api-business-logic 审计报告

## 范围

本次按用户要求审计后端服务业务逻辑，重点读取 `apps/api/src/server/routes/`、`apps/api/src/domain/generation/`、`apps/api/src/domain/credits/`、`apps/api/src/domain/storage/`、`apps/api/src/domain/agent/`，并抽查 auth、admin、redemption、Gallery 相关路径。审计目标只看逻辑 bug，不做代码修复。

## 总评

共发现 2 条高置信 bug。最严重的是生成取消接口允许对终态成功记录触发全额退款，普通用户可对历史成功生成补调 cancel 取回积分。另一条是 MySQL 模式下 Agent conversation 和 skill 路由仍走 SQLite-only `db`，路由已注册且 MySQL 表已创建，但实际调用会 500。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P0 | high | 已成功生成仍可调用取消接口触发全额退款 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | high | MySQL 模式下 Agent conversation/skill 路由会走 SQLite proxy 直接 500 | [finding-02.md](finding-02.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 1 | 1 | 0 | 2 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **1** | **1** | **0** | **2** |

## 下一步建议

- **P0 立刻修**：finding-01，建议开 `cs-issue`，先让取消路径只处理 `pending/running`，并补成功记录取消不退款的回归测试。
- **P1 本迭代修**：finding-02，建议开 `cs-issue`，补 MySQL 分支实现或显式返回稳定 unsupported 错误，避免运行时 500。
- **P2 有空再看**：本次未记录 P2 发现。
