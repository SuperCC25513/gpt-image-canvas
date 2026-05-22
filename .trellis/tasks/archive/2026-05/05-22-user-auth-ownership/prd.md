# 用户会话与权限归属

## Goal

新增注册、登录、退出、会话续期、用户角色和用户状态，并让项目、资产、生成记录和输出具备 owner 归属。完成后，多用户模式下普通用户只能访问自己的私密内容，管理员具备运营管理权限。

## Parent And Dependency

- 父任务：`.trellis/tasks/05-21-mysql-users-gallery`
- 前置依赖：`.trellis/tasks/05-22-mysql-storage-foundation` 已完成并验证 MySQL 模式可启动。

## Product Rule

- 已拍板：SQLite 和 MySQL 都要求登录，统一注册、登录、退出、当前用户和权限流程。
- 原因：后续图片公开、积分签到、后台审计都依赖稳定用户身份；两种存储模式行为一致更利于验证和维护。
- 已拍板：首个管理员账号通过 `.env` 创建或激活，使用 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME`。
- 已拍板：`.env` 中 `ADMIN_PASSWORD` 变化时，不自动重置已有管理员账号的密码；账号已存在时只确保 `role=admin`、`status=active`。
- 已拍板：SQLite 旧单用户数据中没有 `user_id` 的项目、资产、生成记录和输出归属给 `.env` 初始化的管理员账号。
- 已拍板：默认开放注册，默认不需要管理员审核；注册用户直接为 `active`。
- 首个注册用户不会自动成为管理员，避免公开部署时账号被抢占。

## Requirements

- 新增 shared 契约：当前用户、注册请求、登录请求、会话状态、用户角色、用户状态和 auth 错误码。
- 新增用户表和会话表，密码使用 salt、iterations、hash，不保存明文密码。
- 服务启动时读取管理员初始化环境变量，三项都存在时创建或激活 admin 用户。
- 管理员账号已存在时不得用 `.env` 中的 `ADMIN_PASSWORD` 覆盖现有密码。
- 管理员初始化不得打印明文密码、密码 hash、完整环境变量或数据库连接串。
- 会话 token 只保存 hash；浏览器使用 `HttpOnly`、`SameSite=Lax` cookie。
- 注册逻辑读取系统设置：是否允许注册、是否需要审核、注册送积分；初始默认 `allow_registration=true`、`require_approval=false`。
- 禁用或待审核用户不能登录，已有会话应失效或被拒绝使用。
- 新增 `/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`。
- 项目、资产、生成记录、生成输出、Agent 会话、提示词收藏需要能归属到用户。
- 普通用户只能访问自己的私密项目、私密资产、私密输出和私密历史。
- 管理员可以读取运营所需数据，但接口不得返回原始密钥、cookie、token 或数据库密码。
- SQLite 旧单用户数据需要兼容归属策略：缺失 owner 的项目、资产、生成记录和输出统一归属到管理员账号。

## Acceptance Criteria

- [ ] 用户可注册、登录、退出，并通过 `/api/auth/me` 获取当前用户和积分摘要。
- [ ] 默认开放注册，默认注册用户状态为 `active`。
- [ ] 配置 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 后，服务启动会创建 admin 用户。
- [ ] 已存在同邮箱用户时，启动会确保其角色为 `admin`、状态为 `active`。
- [ ] 已存在同邮箱管理员时，修改 `.env` 中的 `ADMIN_PASSWORD` 并重启不会改变其密码。
- [ ] 未配置管理员环境变量时，服务仍能启动，但后台不可用并给出安全提示。
- [ ] 禁用用户和待审核用户无法登录，也无法发起生成。
- [ ] Cookie 中有会话 token，但数据库只保存 token hash。
- [ ] 新生成的项目、资产、生成记录和输出都写入 owner。
- [ ] 旧 SQLite 中缺失 owner 的项目、资产、生成记录和输出会补为管理员 owner。
- [ ] 普通用户无法读取、删除、下载、导出或复用其他用户私密输出。
- [ ] 管理员可通过后续后台接口识别为 admin；本任务至少提供 admin 鉴权基础。
- [ ] SQLite 和 MySQL 模式都要求登录后才能访问创作、私有 Gallery、资产下载、生成和管理能力。
- [ ] shared 类型覆盖 auth 请求、响应和错误码。
- [ ] 通过 `pnpm typecheck`。
- [ ] 通过 `pnpm build`。

## Out Of Scope

- 不做第三方登录、邮箱验证、找回密码。
- 不做完整后台 UI。
- 不做图片公开广场。
- 不做积分扣费和签到，只保留用户积分字段给后续任务使用。

## Notes

- 资产读取接口是最高风险点，不能让 `/api/assets/:id` 绕过 owner 判断。
- 忘记管理员密码时，不能只改 `.env` 重启恢复；后续需要后台改密或专门重置命令。
