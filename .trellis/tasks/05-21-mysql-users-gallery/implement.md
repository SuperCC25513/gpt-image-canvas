# MySQL 用户体系与图片广场实施计划

## Phase 0: 前置整理

- [x] 确认 `05-21-remove-cloud-storage` 已完成并归档。
- [x] 更新或读取最新 `docs/PRODUCT_SENSE.md`、`docs/RELIABILITY.md`、`docs/SECURITY.md`、`docs/product-specs/gallery-and-assets.md`。
- [x] 存储策略拍板：默认 SQLite；`.env` 显式设置 `DATABASE_DRIVER=mysql` 时使用 MySQL；不做 SQLite 数据迁移。
- [x] 登录策略拍板：SQLite 和 MySQL 都要求登录，统一用户流程。
- [x] 管理员初始化策略拍板：通过 `.env` 的 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 创建或激活管理员。
- [x] 管理员密码策略拍板：`.env` 密码变化不自动重置已有管理员密码。
- [x] 旧 SQLite 数据归属策略拍板：缺失 owner 的旧项目、资产、生成记录和输出归属管理员。
- [x] 注册默认策略拍板：开放注册，不需要管理员审核。
- [x] 拆出 5 个可独立验证子任务，并写入每个子任务的前置依赖。
- [x] 用户已确认规划可进入下一步；等待从 planning 切换到首个子任务实施。

## Phase 1: MySQL 存储底座

- [ ] 开始子任务 `.trellis/tasks/05-22-mysql-storage-foundation`。
- [ ] 新增存储驱动运行配置解析，默认 `sqlite`，凭据只从 `.env` 或运行环境读取。
- [ ] 增加 MySQL 依赖和连接池。
- [ ] 设计 MySQL schema 和建表/迁移入口。
- [ ] 拆出 store 边界，先覆盖项目、资产、生成记录、Gallery。
- [ ] 增加 MySQL 模式启动检查。
- [ ] 明确 SQLite 和 MySQL 数据独立，不提供 SQLite → MySQL 迁移脚本。
- [ ] 更新 `docs/generated/db-schema.md`。

## Phase 2: 用户、会话和权限

- [ ] 开始子任务 `.trellis/tasks/05-22-user-auth-ownership`。
- [ ] 新增 shared auth/admin/user 类型。
- [ ] 新增用户表和会话表。
- [ ] 新增注册、登录、退出、当前用户接口。
- [ ] 新增 `.env` 管理员初始化流程，创建或激活管理员账号；已有账号不自动重置密码。
- [ ] 给项目、资产、生成记录、输出补 owner 关系。
- [ ] 给旧 SQLite 缺失 owner 的项目、资产、生成记录和输出补管理员 owner。
- [ ] 收紧资产读取、Gallery、导出、删除、复用权限。
- [ ] Web 增加登录注册入口和当前用户状态。
- [ ] SQLite 和 MySQL 都接入登录保护，不保留免登录创作入口。

## Phase 3: 图片公开和广场

- [ ] 开始子任务 `.trellis/tasks/05-22-public-gallery-visibility`。
- [ ] `generation_outputs` 增加 `is_public`、`published_at`。
- [ ] 生成请求支持默认公开选项，默认私密。
- [ ] Gallery 卡片增加公开/私密切换。
- [ ] 新增公开广场 API 和 Web 页面。
- [ ] 公开资产读取只暴露公开输出关联的图片。

## Phase 4: 积分和签到

- [ ] 开始子任务 `.trellis/tasks/05-22-credits-checkins`。
- [ ] 新增 app settings、credit transactions、checkins。
- [ ] 注册赠送积分。
- [ ] 生成前事务预扣积分，失败退款。
- [ ] 每日签到接口和 UI。
- [ ] Web 显示积分余额和积分不足状态。

## Phase 5: 后台和审计

- [ ] 开始子任务 `.trellis/tasks/05-22-admin-audit`。
- [ ] 新增管理员鉴权中间件。
- [ ] 新增用户管理接口和后台 UI。
- [ ] 新增系统设置接口和后台 UI。
- [ ] 新增生成请求审计写入和后台查询。
- [ ] 确保后台接口不返回原始密钥、cookie、token 或数据库密码。

## Verification

- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] 默认 SQLite 验证：不设置 `DATABASE_DRIVER` 或设置为 `sqlite`，旧本地路径继续可用。
- [ ] MySQL 本机验证：设置 `DATABASE_DRIVER=mysql`，连接 `127.0.0.1:3306`，使用未提交 `.env` 中的本机凭据。
- [ ] 浏览器验证：`pnpm dev`，打开 `http://localhost:5173`。
- [ ] 验证注册、登录、退出、禁用用户登录失败。
- [ ] 验证生成扣积分、失败退款、积分不足错误。
- [ ] 验证每日签到只能成功一次。
- [ ] 验证 Gallery 公开开关和图片广场。
- [ ] 验证匿名访问公开图片成功、私密图片失败。
- [ ] 验证管理员管理用户、积分、设置和审计记录。

## Risk And Rollback

- 数据库切换风险高。每一阶段都应能单独回滚，不要把 schema、权限、UI 和积分混在一个提交里。
- 权限风险高。资产读取接口必须优先检查 owner/admin/公开状态。
- 积分扣费必须使用事务；失败退款要有流水，避免余额漂移。
- 若 MySQL 模式阻塞，可保留 SQLite 路径并只隐藏多用户入口。
