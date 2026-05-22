# MySQL 用户体系与图片广场设计

## Architecture

本任务应拆为一个父级能力规划和多个可独立验证的实现阶段。原因：MySQL 存储底座会影响 API 持久化边界；用户体系会影响所有资产访问；公开广场、积分签到和后台管理又分别有独立验收面。

推荐顺序：

1. MySQL 存储底座。
2. 用户、会话和 owner 权限。
3. 输出级公开状态和图片广场。
4. 积分扣费和每日签到。
5. 后台管理和生成审计。

当前代码大量直接导入 `db` 和 `schema`。MySQL 不能只替换 `better-sqlite3` 连接，因为当前 schema 使用 `sqlite-core`。需要在第一阶段建立清晰存储边界，再逐步迁移调用点。

## Storage Boundary

推荐增加持久化边界，而不是让业务层继续直接散落 Drizzle 查询：

- `projectStore`：项目快照、最近生成历史。
- `assetStore`：资产元数据、读取定位、预览和下载辅助。
- `generationStore`：生成记录、输出、参考资产、状态更新。
- `galleryStore`：我的图库、公开广场、导出、删除、公开状态更新。
- `authStore`：用户、会话、密码哈希、角色、状态。
- `creditStore`：积分余额、流水、扣费、退款、签到。
- `adminStore`：设置、用户管理、审计查询。

第一阶段可以保留 SQLite 实现作为兼容层，同时新增 MySQL 实现。后续一旦 MySQL 模式稳定，再决定是否删除 SQLite。

## MySQL Schema Shape

核心表：

- `users`：`id`、`name`、`email`、`password_salt`、`password_iterations`、`password_hash`、`role`、`status`、`credits`、时间戳。
- `sessions`：`token_hash`、`user_id`、`expires_at`、`created_at`。
- `projects`：补 `user_id`，保留 `snapshot_json`。
- `assets`：补 `user_id`，保留文件名、相对路径、mime、宽高、创建时间。
- `generation_records`：补 `user_id`，保留模式、prompt、尺寸、质量、格式、状态、错误。
- `generation_outputs`：补 `is_public`、`published_at`、可选 `public_title`，继续关联 `asset_id`。
- `generation_reference_assets`：保留生成到参考资产关系。
- `app_settings`：注册开关、是否需要审核、注册送积分、每张图扣费、签到奖励、单次生成上限。
- `credit_transactions`：用户、变动值、原因、关联生成/签到/管理员、创建时间。
- `user_checkins`：`user_id + checkin_date` 唯一，记录奖励积分。
- `generation_requests`：审计请求，记录用户、prompt、IP、User-Agent、公开状态、状态、错误摘要、关联输出。

Provider、Agent、提示词收藏等现有表也要迁移到 MySQL，并继续遵守密钥 mask 和不日志泄露规则。

## Runtime Config

新增环境变量：

```env
DATABASE_DRIVER=sqlite
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=gpt_image_canvas
MYSQL_CONNECTION_LIMIT=10
MYSQL_CREATE_DATABASE=true
```

默认驱动为 SQLite。只有 `.env` 显式设置 `DATABASE_DRIVER=mysql` 时才连接 MySQL。本机验证可在未提交的 `.env` 中填入用户提供的本地账号密码。代码默认值不能包含真实密码。

## Auth And Passwords

密码使用 Node crypto 的强哈希策略，至少包含 salt、iterations、hash。会话 token 只把 hash 存数据库，HTTP cookie 使用 `HttpOnly`、`SameSite=Lax`；生产 HTTPS 时启用 `Secure`。

注册逻辑读取 `app_settings.allow_registration` 和 `require_approval`。需要审核时，新用户状态为 `pending`，管理员启用后才可登录或生成。

## Authorization

读取资产文件前必须先判定访问权：

- 公开输出关联的资产可被广场读取。
- 私密输出和私密项目只允许 owner 或 admin。
- 下载、导出、删除、复用私密输出都必须走权限检查。
- 避免通过 `/api/assets/:id` 绕过 Gallery 权限。

为减少破坏，公开广场可新增专用资产读取策略：公开输出存在时允许读取关联资产；否则要求登录 owner/admin。

## Credits

生成请求先计算总成本：`generationCreditCost * count`。成本大于 0 时：

1. 事务内检查余额并预扣。
2. 创建 `credit_transactions` 扣费流水。
3. 生成成功后确认；部分失败按失败输出数退款。
4. 整体失败全额退款并记录退款流水。

签到使用 `user_checkins` 唯一约束防重复，成功后加积分并写流水。

## Public Gallery

公开状态放在 `generation_outputs`，原因是当前 Gallery 以输出为卡片，单次生成多图时用户可能只公开部分图片。

API 建议：

- `GET /api/gallery`：当前用户自己的 Gallery，需要登录。
- `PATCH /api/gallery/:outputId/visibility`：owner/admin 切换公开状态。
- `GET /api/gallery/public?limit=60`：公开图片广场，可匿名读取安全字段。
- `GET /api/assets/:id`：根据 owner/admin 或公开输出关系判权。

## Admin

后台先做最小运营面：

- 用户列表、搜索、角色、状态、积分调整。
- 系统设置：注册开关、审核开关、注册送积分、每张图消耗积分、签到奖励。
- 生成审计：用户、prompt、公开状态、状态、错误、IP、User-Agent、时间、输出链接。

不做支付、内容审核队列、社交功能。

## Migration

存储策略已拍板：

- 保留 SQLite 单机模式，且作为默认存储驱动。
- MySQL 通过 `.env` 显式启用。
- 不做 SQLite → MySQL 数据迁移。
- SQLite 数据和 MySQL 数据互相独立；切换驱动后看到的是对应存储中的数据。

这个决策保护当前 local-first 默认体验，也降低迁移风险。代价是实现期需要维护 SQLite 和 MySQL 两套持久化路径，或者先抽 store 边界再逐步补 MySQL 实现。

## Dependency Notes

`05-21-remove-cloud-storage` 如果先合入，本任务的 MySQL schema 不需要包含云存储字段和云配置表。若并行推进，MySQL 初始 schema 需要跟当前 main 对齐，随后再删除云字段，风险更高。

推荐把移除云存储作为前置依赖。
