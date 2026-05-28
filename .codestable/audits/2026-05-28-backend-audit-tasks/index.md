---
doc_type: audit-task-index
audit: 2026-05-28-backend-audit-tasks
scope: Backend audit task queue covering the 8 selected API/runtime modules.
created: 2026-05-28
status: archived
task_count: 8
completed: 2026-05-28
remediated: 2026-05-28
---

# 后端审计任务队列

## 范围

本队列把后端审计拆成 8 个独立任务。每个任务正式执行时，按 `cs-audit` 规则产出独立目录：

`.codestable/audits/{YYYY-MM-DD}-{slug}/index.md` 和 `finding-NN.md`。

本目录只定义任务，不记录发现，不替代正式审计报告。

修复归档：

- [后端审计修复方案](../../issues/2026-05-28-backend-audit-remediation/backend-audit-remediation-plan.md)
- [后端审计修复记录](../../issues/2026-05-28-backend-audit-remediation/backend-audit-remediation-fix-note.md)

## 执行顺序

| # | 任务 | 目标模块 | 优先级 | 状态 | 结果 |
|---|---|---|---|---|---|
| 1 | [task-01-assets-gallery.md](task-01-assets-gallery.md) | 资产读取 + Gallery 公开访问 | P0 | completed | [backend-assets-gallery](../2026-05-28-backend-assets-gallery/index.md) |
| 2 | [task-02-generation-credits.md](task-02-generation-credits.md) | 图片生成 + 积分扣退 + 生成记录 | P0 | completed | [backend-generation-credits](../2026-05-28-backend-generation-credits/index.md) |
| 3 | [task-03-agent-runtime.md](task-03-agent-runtime.md) | Agent 规划/执行/WebSocket | P1 | completed | [backend-agent-runtime](../2026-05-28-backend-agent-runtime/index.md) |
| 4 | [task-04-auth-oauth.md](task-04-auth-oauth.md) | 认证/注册/session/Codex OAuth | P0 | completed | [backend-auth-oauth](../2026-05-28-backend-auth-oauth/index.md) |
| 5 | [task-05-admin-settings-audits.md](task-05-admin-settings-audits.md) | 后台管理 + 系统设置 + 审计查询 | P1 | completed | [backend-admin-settings-audits](../2026-05-28-backend-admin-settings-audits/index.md) |
| 6 | [task-06-provider-agent-config.md](task-06-provider-agent-config.md) | Provider 配置 + Agent LLM 配置 | P1 | completed | [backend-provider-agent-config](../2026-05-28-backend-provider-agent-config/index.md) |
| 7 | [task-07-redemption-credit-ledger.md](task-07-redemption-credit-ledger.md) | 积分兑换码 + 交易流水 | P1 | completed | [backend-redemption-credit-ledger](../2026-05-28-backend-redemption-credit-ledger/index.md) |
| 8 | [task-08-persistence-sqlite-mysql.md](task-08-persistence-sqlite-mysql.md) | SQLite/MySQL 持久化一致性 | P2 | completed | [backend-persistence-sqlite-mysql](../2026-05-28-backend-persistence-sqlite-mysql/index.md) |

## 统一守护

- 每个任务单独跑，不把发现混到其他模块。
- 每个正式发现必须包含 `file:line`、代码片段、影响、严重度、置信度和建议动作。
- 每种维度最多报 5 条。
- 架构偏离必须对照 `.codestable/architecture/ARCHITECTURE.md`。
- 涉及 API、存储、provider、Docker、SQLite、资产、secret 或本地数据时，先读 `docs/RELIABILITY.md` 和 `docs/SECURITY.md`。
- 只审计，不修代码。
