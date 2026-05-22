# 调整 MySQL 启用开关和初始化注释

## 目标

将数据库驱动选择从 `DATABASE_DRIVER=sqlite|mysql` 改为布尔式 MySQL 启用开关；在 MySQL 初始化语句中补齐数据库层表注释和字段注释，让新建表和已有表都能在 MySQL 元数据中看到清晰说明。

## 已确认事实

- 当前 API 默认通过 `DATABASE_DRIVER` 选择 SQLite 或 MySQL，空值等同 SQLite。
- 当前 `.env.example` 暴露 `DATABASE_DRIVER=sqlite`，用户希望去除该字段。
- 当前 MySQL 建表 SQL 已使用 `CREATE TABLE IF NOT EXISTS`，目标数据库存在时会自动创建缺失表。
- 当前 `MYSQL_CREATE_DATABASE=false` 只控制是否自动创建数据库本身；这项配置需要保留。
- 当前 MySQL 建表语句没有 `COMMENT`，已有表和字段不会获得数据库层注释。
- MySQL 凭据仍只能来自 `.env` 或运行时环境，不能进入前端 UI、日志或提交的真实配置。

## 需求

- 新增布尔式 MySQL 启用开关，建议命名为 `USE_MYSQL`：
  - `USE_MYSQL=true` 时使用 MySQL。
  - `USE_MYSQL` 为空、缺失或非 true 值时使用 SQLite。
- 移除示例配置中的 `DATABASE_DRIVER` 字段，不再鼓励使用 `DATABASE_DRIVER=sqlite|mysql`。
- 保留 `MYSQL_CREATE_DATABASE=false`，语义不变：
  - `false`：不自动创建数据库本身，目标数据库必须已存在。
  - `true`：启动时可自动创建数据库本身。
- 当目标数据库已存在时，缺失表必须自动创建对应表结构。
- MySQL 初始化 SQL 必须为每张表添加表注释。
- MySQL 初始化 SQL 必须为每个字段添加字段注释。
- 启动兼容迁移必须能为已有 MySQL 表/字段补上缺失或旧注释。
- 更新相关文档和示例，避免文档仍描述 `DATABASE_DRIVER` 为主入口。

## 验收标准

- [x] `.env.example` 不再包含 `DATABASE_DRIVER`，改为布尔式 MySQL 开关。
- [x] API 配置解析中不再依赖 `DATABASE_DRIVER` 作为推荐入口，`USE_MYSQL=true` 选择 MySQL，否则选择 SQLite。
- [x] `MYSQL_CREATE_DATABASE=false` 下，如果数据库已存在但表不存在，启动会创建全部 MySQL 表。
- [x] `MYSQL_CREATE_DATABASE=false` 下，如果数据库本身不存在，启动失败且不偷偷创建数据库。
- [x] MySQL 新建表包含数据库层表注释和字段注释。
- [x] 已有 MySQL 表/字段在启动迁移后能补齐注释。
- [x] `docs/generated/db-schema.md`、`docs/RELIABILITY.md`、`docs/SECURITY.md` 中相关描述同步更新。
- [x] 不记录、提交或展示真实 MySQL 密码。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm build` 通过。

## 范围外

- 不新增前端数据库连接配置入口。
- 不做 SQLite 到 MySQL 的数据迁移。
- 不修改业务表字段含义或授权逻辑。
- 不自动修复当前本机 MySQL 账号密码认证失败问题。

## 已确认决策

- 新布尔开关使用 `USE_MYSQL`。
