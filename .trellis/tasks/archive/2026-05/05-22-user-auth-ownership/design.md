# 用户会话与权限归属设计

## Architecture

本任务在 MySQL/SQLite 存储底座完成后执行。目标是让两个数据库驱动共享同一套身份和权限语义。

主要边界：

- `authStore`：用户、会话、管理员初始化、注册设置读取。
- `ownershipStore`：项目、资产、生成记录、生成输出、Agent 会话、提示词收藏 owner 补齐和判权辅助。
- `authMiddleware`：解析 cookie、加载当前用户、拒绝未登录请求。
- `adminMiddleware`：要求当前用户为 `admin` 且 `active`。
- Web `auth` 状态：启动时读取 `/api/auth/me`，未登录显示登录/注册界面，登录后进入创作工作台。

## Data Model

新增表：

- `users`：`id`、`name`、`email`、`password_salt`、`password_iterations`、`password_hash`、`role`、`status`、`credits`、时间戳。
- `sessions`：`token_hash`、`user_id`、`expires_at`、`created_at`、可选 `last_seen_at`。
- `app_settings`：若存储底座尚未创建，则本任务创建最小设置行，包含 `allow_registration`、`require_approval`、`default_credits`。

新增 owner 字段：

- `projects.user_id`
- `assets.user_id`
- `generation_records.user_id`
- `generation_outputs.user_id`
- `agent_conversations.user_id`
- `prompt_favorite_groups.user_id`
- `prompt_favorites.user_id`

`generation_outputs.user_id` 可从记录继承，但仍建议冗余保存，原因是 Gallery 和资产判权以输出为主要入口。

## Admin Bootstrap

启动时读取：

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

行为：

- 三项都存在：若邮箱不存在，创建 `admin/active` 用户；若已存在，只确保 `role=admin`、`status=active`。
- 账号已存在时，不使用 `.env` 中的 `ADMIN_PASSWORD` 重置密码。
- 部分存在：启动失败并提示必须同时设置，避免创建半初始化账号。
- 全部缺失：服务可启动，但后台不可用；日志只提示缺少管理员初始化配置，不输出敏感值。

## Password And Session

- 密码使用 Node `crypto.pbkdf2` 或等价强哈希，保存 salt、iterations、hash。
- 会话 token 使用高熵随机值，数据库只保存 SHA-256 hash。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`、`Path=/`；生产 HTTPS 时加 `Secure`。
- 登出删除当前 token hash。
- 禁用或待审核用户已有会话不可继续访问。

## Authorization

默认所有创作、私有 Gallery、资产读取、下载、导出、删除、生成、provider 配置、Agent 配置、Agent 会话、提示词收藏都要求登录。

允许匿名的接口只包括：

- 登录、注册、退出。
- 当前用户探测 `/api/auth/me`。
- 后续公开广场任务中的公开 Gallery 和公开资产读取。
- 健康检查和静态资源。

资产读取必须经过判权：

- owner 或 admin 可读私有资产。
- 后续公开广场任务会追加公开输出关联资产可读规则。

## SQLite Legacy Ownership

统一登录启用后，旧 SQLite 缺失 `user_id` 的项目、资产、生成记录和输出归属到 `.env` 初始化管理员。

前置条件：

- 管理员初始化先于 owner backfill。
- 如果缺少管理员配置，旧数据保持不可被普通用户继承；服务给出安全提示。

## Web Flow

- App 启动先请求 `/api/auth/me`。
- 未登录时只显示登录/注册入口，不进入 canvas。
- 登录成功后加载创作工作台和当前用户摘要。
- 注册默认开放，默认不需要审核，注册后可直接登录。
- 禁用或待审核返回稳定错误，并显示可理解的提示。

## Trade-Offs

- 统一登录会增加本地首次使用成本，但换来一致权限模型。
- 旧 SQLite 数据归属管理员保护隐私，但普通账号无法直接看到旧数据。
- `.env` 不自动重置管理员密码可避免意外覆盖，但忘记密码需要后续重置机制。
