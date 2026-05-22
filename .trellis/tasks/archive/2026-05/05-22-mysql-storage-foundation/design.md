# MySQL 存储底座设计

## Architecture

本任务只处理存储底座，不引入登录、积分、公开广场或后台 UI。目标是让当前单用户能力在 SQLite 与 MySQL 两种驱动下都有同等行为。

推荐结构：

- `apps/api/src/infrastructure/database-config.ts`：解析 `DATABASE_DRIVER` 和 MySQL 环境变量。
- `apps/api/src/infrastructure/sqlite-database.ts`：保留当前 SQLite 初始化和兼容迁移。
- `apps/api/src/infrastructure/mysql-database.ts`：新增 MySQL 连接池、建库、建表和关闭逻辑。
- `apps/api/src/infrastructure/database.ts`：只导出当前驱动上下文，不承载所有建表 SQL。
- `apps/api/src/domain/*/*-store.ts`：逐步改为调用 store 边界。

## Driver Choice

推荐第一阶段使用 `mysql2/promise` 实现 MySQL 建表和 store 查询。

原因：

- 当前 SQLite Drizzle schema 绑定 `sqlite-core`，复用到 MySQL 需要重复维护 MySQL Drizzle schema。
- 本任务核心是建立存储边界和运行时切换，`mysql2/promise` 参数化 SQL 能更快完成可验证底座。
- 后续如果 store 边界稳定，再评估是否把 MySQL store 迁到 Drizzle MySQL schema。

约束：

- 所有 MySQL 查询必须使用参数化 SQL。
- 表名和列名只用内部常量，不拼接用户输入。
- 连接和迁移日志不能打印密码或完整连接串。

## Data Flow

启动时：

1. `dotenv` 读取 `.env`。
2. 解析 `DATABASE_DRIVER`，默认 `sqlite`。
3. SQLite 模式执行当前初始化逻辑。
4. MySQL 模式按 `MYSQL_CREATE_DATABASE` 决定是否先创建库。
5. MySQL 模式创建连接池并执行第一阶段建表。
6. route/domain 通过 store 层读写，不直接关心驱动。

请求时：

- 项目保存、Gallery 查询、资产元数据、生成记录写入等通过 store facade 分发到 SQLite 或 MySQL 实现。
- 图片二进制仍只从 `DATA_DIR/assets` 读取。

## First-Phase Tables

MySQL 第一阶段只创建当前业务已经使用的表：

- `projects`
- `assets`
- `provider_configs`
- `agent_llm_configs`
- `agent_conversations`
- `agent_skills`
- `prompt_favorite_groups`
- `prompt_favorites`
- `codex_oauth_tokens`
- `generation_records`
- `generation_outputs`
- `generation_reference_assets`

这些表不包含云存储字段，也不包含用户 owner 字段。用户表、owner、公开状态、积分表由后续子任务按依赖追加。

## Compatibility

- SQLite 仍是默认驱动，现有本地数据路径不变。
- MySQL 与 SQLite 数据互相独立。
- 不提供 SQLite 到 MySQL 的迁移脚本。
- 当前 `docs/RELIABILITY.md` 中“本地资产存储”规则继续适用。

## Risk

- 直接导入 `db` 的调用点较多，迁移 store 边界时容易漏路径。
- 生成流程同时写资产文件和数据库，MySQL store 必须保持记录、输出和资产一致。
- Provider、Agent 和 Codex token 表包含敏感字段，读接口仍只能返回 mask 或状态。

## Rollback

- 关闭 MySQL：删除或改回 `DATABASE_DRIVER=sqlite`。
- 代码回滚时不删除 MySQL 数据库，避免误删用户本地验证数据。
- 新增 MySQL 文件和依赖应单独提交，便于回滚底座。
