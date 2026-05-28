---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "08"
slug: backend-persistence-sqlite-mysql
status: completed
priority: P2
recommended_dimensions:
  - bug
  - arch-drift
  - maintainability
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-persistence-sqlite-mysql/
---

# Task 08：SQLite/MySQL 持久化一致性

## 目标产物

`.codestable/audits/2026-05-28-backend-persistence-sqlite-mysql/`

## 路径

- `apps/api/src/infrastructure/schema.ts`
- `apps/api/src/infrastructure/sqlite-database.ts`
- `apps/api/src/infrastructure/mysql-database.ts`
- `apps/api/src/infrastructure/database.ts`
- `apps/api/src/infrastructure/database-config.ts`
- `apps/api/src/infrastructure/app-config.ts`
- `apps/api/src/infrastructure/runtime.ts`
- `apps/api/drizzle.config.ts`
- `docs/generated/db-schema.md`

## 业务含义

负责数据库 schema、SQLite 初始化、MySQL 初始化、运行时数据库选择、表/字段补齐和配置读取。

## 风险理由

项目支持 SQLite 和 MySQL 两种运行模式。字段默认值、迁移补齐、TEXT 默认限制、表注释、旧数据兼容和 DATA_DIR 语义如果漂移，会造成不同环境行为不一致。

## 推荐审计维度

- `bug`：schema 差异、默认值、初始化顺序、旧库升级、环境变量解析。
- `arch-drift`：MySQL 模式不读 SQLite 数据、资产 metadata/bytes 分离、注册设置持久化约束。
- `maintainability`：SQLite/MySQL 初始化逻辑重复、字段清单漂移、生成文档过期。

## 重点检查

- `USE_MYSQL=true` 是否唯一启用 MySQL 的路径。
- MySQL 模式是否不读 SQLite 数据，也不做 SQLite 到 MySQL 迁移。
- `allowed_registration_email_domains_json` 在 SQLite/MySQL 下是否有一致默认/补齐语义。
- 资产路径在 SQLite 为本地相对路径、MySQL 为 OSS object key 的约束是否一致。
- `docs/generated/db-schema.md` 是否和 schema 代码一致。

## 不做

不运行真实 MySQL 迁移；不修改 schema。
