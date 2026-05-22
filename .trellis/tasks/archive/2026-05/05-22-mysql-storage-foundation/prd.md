# MySQL 存储底座

## Goal

在不破坏默认 SQLite 本地模式的前提下，新增 MySQL 存储驱动、连接配置、建表入口和第一批持久化边界。完成后，当前单用户核心流程在 SQLite 和 MySQL 两种驱动下都能运行。

## Parent

- 父任务：`.trellis/tasks/05-21-mysql-users-gallery`
- 本任务是后续用户体系、图片广场、积分签到、后台管理的前置任务。

## Confirmed Facts

- 当前默认数据库是 SQLite，入口为 `apps/api/src/infrastructure/database.ts`。
- 当前 Drizzle schema 使用 `drizzle-orm/sqlite-core`，不能直接复用为 MySQL schema。
- 当前业务层仍有多处直接导入 `db` 和 `apps/api/src/infrastructure/schema.ts`。
- 当前本地资产文件仍保存到 `DATA_DIR/assets`，MySQL 只保存元数据和相对路径。
- 云存储移除任务已完成并归档，MySQL 新 schema 不需要云存储表或字段。
- 参考项目 `/Users/jesuscc/wcc/projects/github/image2creat` 使用 `mysql2/promise`、`MYSQL_CREATE_DATABASE` 和启动时建表策略，可作为本机 MySQL 验证参考。

## Requirements

- 默认不设置 `DATABASE_DRIVER` 时继续使用 SQLite。
- 只有设置 `DATABASE_DRIVER=mysql` 时才连接 MySQL。
- MySQL 配置只从 `.env` 或运行环境读取：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_CONNECTION_LIMIT`、`MYSQL_CREATE_DATABASE`。
- 本机验证可使用用户提供的 `127.0.0.1:3306` 和本机凭据，但不能写入代码默认值、提交 `.env` 或输出真实密码。
- 第一阶段 MySQL schema 覆盖当前已有表：项目、资产、生成记录、生成输出、生成参考资产、provider 配置、Agent LLM 配置、Agent 会话、Agent Skill、提示词收藏、Codex OAuth token。
- 第一阶段不引入用户登录业务；用户表和权限字段由后续子任务追加。
- 建表逻辑不得创建云存储相关表或字段。
- 新增 store 边界，先覆盖当前直接读写最集中的项目、资产、生成记录和 Gallery 流程。
- 读写资产文件前仍必须校验相对路径位于 `DATA_DIR/assets` 内。
- 文档更新 MySQL 配置、schema 差异、默认 SQLite 行为和本机验证方式。

## Acceptance Criteria

- [ ] 不设置 `DATABASE_DRIVER` 时，SQLite 模式启动和现有 Gallery、生成历史、provider 配置仍可用。
- [ ] 设置 `DATABASE_DRIVER=mysql` 后，API 连接本机 MySQL，并在允许时创建数据库和第一阶段表。
- [ ] MySQL 模式下可以保存项目快照、保存生成记录、保存输出资产元数据、读取 Gallery。
- [ ] MySQL 模式不会读取 SQLite 数据，也不会尝试做 SQLite 到 MySQL 的迁移。
- [ ] MySQL schema 不包含已移除的云存储配置或云资产字段。
- [ ] `.env.example` 或文档只包含安全占位值，不包含真实本机密码。
- [ ] `docs/generated/db-schema.md` 或等价数据库文档说明 SQLite 与 MySQL schema。
- [ ] 通过 `pnpm typecheck`。
- [ ] 通过 `pnpm build`。

## Out Of Scope

- 不实现注册、登录、角色、会话。
- 不实现图片公开、图片广场。
- 不实现积分、签到。
- 不实现后台管理和审计。
- 不迁移旧 SQLite 数据到 MySQL。
- 不把图片二进制写入 MySQL。

## Notes

- 推荐用 store 边界隔离 SQLite 和 MySQL，而不是让 route/domain 继续散落直接 Drizzle 查询。
- MySQL 实现可以使用 `drizzle-orm/mysql2` 加 MySQL schema，或使用 `mysql2/promise` 参数化 SQL；开工前需在 `design.md` 固化选择。
