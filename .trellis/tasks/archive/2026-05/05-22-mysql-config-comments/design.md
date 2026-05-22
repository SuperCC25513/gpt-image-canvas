# 技术设计

## 边界

本任务只修改后端运行时配置、MySQL 初始化/兼容迁移、示例环境配置和数据库文档。前端不新增数据库凭据 UI。

相关文件预计包括：

- `apps/api/src/infrastructure/database-config.ts`
- `apps/api/src/infrastructure/mysql-database.ts`
- `.env.example`
- `docs/generated/db-schema.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- 可能的 API 配置单元测试或 smoke 入口

## 配置契约

新增布尔环境变量 `USE_MYSQL`：

- `true`、`1`、`yes`、`on` 视为启用 MySQL。
- 其他值、空值、缺失均视为 SQLite。

`MYSQL_CREATE_DATABASE` 保持现有语义：

- `true` 时先用不带 database 的连接执行 `CREATE DATABASE IF NOT EXISTS`。
- `false` 时直接连接 `MYSQL_DATABASE`，数据库不存在则由 MySQL 返回连接错误。

兼容策略：

- 示例配置移除 `DATABASE_DRIVER`。
- 代码可选择对旧 `DATABASE_DRIVER=mysql` 做短期兼容，但文档和示例不再暴露该字段。若保留兼容，不应让 `DATABASE_DRIVER=sqlite` 覆盖 `USE_MYSQL=true`。

## MySQL 注释设计

把 schema 定义从纯字符串数组提升为结构化表定义，至少包含：

- 表名
- 表注释
- 字段定义：字段名、SQL 类型/约束、字段注释
- 索引和外键 SQL 片段

生成 `CREATE TABLE IF NOT EXISTS` 时：

- 每个字段追加 `COMMENT '...'`。
- 表尾追加 `COMMENT='...'`。
- 注释字符串经过 SQL 字面量转义。

已有表/字段注释补齐：

- 启动迁移后执行 `ALTER TABLE ... COMMENT = '...'` 更新表注释。
- 对每个字段执行 `ALTER TABLE ... MODIFY COLUMN ... COMMENT '...'` 更新字段注释。
- `MODIFY COLUMN` 必须使用完整字段定义，避免丢失 `NOT NULL`、默认值等属性。
- 现有 `ensureMySqlColumn()` 新增列时也应携带字段注释，避免新增字段缺注释。

## 数据流

启动流程保持不变：

1. 解析环境变量得到 `databaseConfig`。
2. SQLite 模式创建 SQLite 上下文。
3. MySQL 模式按 `MYSQL_CREATE_DATABASE` 决定是否先建库。
4. 创建 MySQL pool。
5. 执行建表、补列、补索引、回填和单例行初始化。
6. 新增一步：补齐 MySQL 表注释和字段注释。

## 兼容和回滚

- SQLite 默认行为必须保持不变。
- MySQL 已有数据不迁移、不删除、不重建表。
- 注释迁移只改 metadata，不改业务数据。
- 如注释迁移出错，启动应失败，避免 schema 元数据处于未知状态；用户可回滚代码恢复旧启动路径。

## 风险

- `ALTER TABLE ... MODIFY COLUMN` 若字段定义不完整会改变字段属性；实现时必须复用同一份字段定义生成创建和修改语句。
- 文档和规范当前仍写 `DATABASE_DRIVER`，需要同步更新，避免用户继续配置旧字段。
- 如果保留旧 `DATABASE_DRIVER` 兼容，解析优先级必须明确，避免两个字段冲突。
