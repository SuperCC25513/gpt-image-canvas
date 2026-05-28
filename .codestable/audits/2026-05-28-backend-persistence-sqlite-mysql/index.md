---
doc_type: audit-index
audit: 2026-05-28-backend-persistence-sqlite-mysql
scope: Backend database driver selection, SQLite migration, MySQL schema bootstrap, runtime data paths, and generated schema documentation.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-persistence-sqlite-mysql 审计报告

## 范围

本次审计覆盖 SQLite/MySQL 持久化一致性：

- `apps/api/src/infrastructure/schema.ts`
- `apps/api/src/infrastructure/sqlite-database.ts`
- `apps/api/src/infrastructure/mysql-database.ts`
- `apps/api/src/infrastructure/database.ts`
- `apps/api/src/infrastructure/database-config.ts`
- `apps/api/src/infrastructure/app-config.ts`
- `apps/api/src/infrastructure/runtime.ts`
- `apps/api/drizzle.config.ts`
- `docs/generated/db-schema.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `.codestable/architecture/ARCHITECTURE.md`

## 总评

共发现 3 条问题：`bug` 1 条、`arch-drift` 1 条、`maintainability` 1 条；严重度为 P1 1 条、P2 2 条。数据库选择边界清晰：只有 `USE_MYSQL=true` 且 MySQL 配置完整时才进入 MySQL，否则使用 SQLite；MySQL 模式不会读取 SQLite 数据，也要求 OSS 凭据承载资产 bytes。主要风险集中在旧库迁移补 `generation_audits.generation_id` 的唯一索引路径、MySQL 初始化了 provider/Agent 配置表但域层仍声明只支持 SQLite、本地生成的 schema 文档已明显落后于代码。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | medium | 旧 `generation_audits` 表补 `generation_id` 后立即建唯一索引，可能让已有多条 audit 的 SQLite 库启动失败 | [finding-01.md](finding-01.md) |
| 2 | arch-drift | P2 | high | MySQL 初始化 provider/Agent 配置表和默认行，但域层完全不读写这些表 | [finding-02.md](finding-02.md) |
| 3 | maintainability | P2 | high | `docs/generated/db-schema.md` 已落后于 schema，漏掉兑换码表和 redemption 交易字段 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 0 | 1 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 1 | 1 |
| **合计** | **0** | **1** | **2** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01 建议走 `cs-issue`，给旧 `generation_audits` 迁移补真实 generation id 或可空过渡列，避免启动期唯一索引失败。
- **P2 有空再看**：Finding 02 建议走 `cs-refactor`，统一 MySQL 配置表与域层能力；Finding 03 建议走 `cs-refactor` 或文档 backfill，刷新 `docs/generated/db-schema.md`。
