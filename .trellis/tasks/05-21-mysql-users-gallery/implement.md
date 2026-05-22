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

- [x] 开始子任务 `.trellis/tasks/05-22-mysql-storage-foundation`。
- [x] 新增存储驱动运行配置解析，默认 `sqlite`，凭据只从 `.env` 或运行环境读取。
- [x] 增加 MySQL 依赖和连接池。
- [x] 设计 MySQL schema 和建表/迁移入口。
- [x] 拆出 store 边界，先覆盖项目、资产、生成记录、Gallery。
- [x] 增加 MySQL 模式启动检查。
- [x] 明确 SQLite 和 MySQL 数据独立，不提供 SQLite → MySQL 迁移脚本。
- [x] 更新 `docs/generated/db-schema.md`。

## Phase 2: 用户、会话和权限

- [x] 开始子任务 `.trellis/tasks/05-22-user-auth-ownership`。
- [x] 新增 shared auth/admin/user 类型。
- [x] 新增用户表和会话表。
- [x] 新增注册、登录、退出、当前用户接口。
- [x] 新增 `.env` 管理员初始化流程，创建或激活管理员账号；已有账号不自动重置密码。
- [x] 给项目、资产、生成记录、输出补 owner 关系。
- [x] 给旧 SQLite 缺失 owner 的项目、资产、生成记录和输出补管理员 owner。
- [x] 收紧资产读取、Gallery、导出、删除、复用权限。
- [x] Web 增加登录注册入口和当前用户状态。
- [x] SQLite 和 MySQL 都接入登录保护，不保留免登录创作入口。

## Phase 3: 图片公开和广场

- [x] 开始子任务 `.trellis/tasks/05-22-public-gallery-visibility`。
- [x] `generation_outputs` 增加 `is_public`、`published_at`。
- [x] 生成请求支持默认公开选项，默认私密。
- [x] Gallery 卡片增加公开/私密切换。
- [x] 新增公开广场 API 和 Web 页面。
- [x] 公开资产读取只暴露公开输出关联的图片。

## Phase 4: 积分和签到

- [x] 开始子任务 `.trellis/tasks/05-22-credits-checkins`。
- [x] 新增 app settings、credit transactions、checkins。
- [x] 注册赠送积分。
- [x] 生成前事务预扣积分，失败退款。
- [x] 每日签到接口和 UI。
- [x] Web 显示积分余额和积分不足状态。

## Phase 5: 后台和审计

- [x] 开始子任务 `.trellis/tasks/05-22-admin-audit`。
- [x] 新增管理员鉴权中间件。
- [x] 新增用户管理接口和后台 UI。
- [x] 新增系统设置接口和后台 UI。
- [x] 新增生成请求审计写入和后台查询。
- [x] 确保后台接口不返回原始密钥、cookie、token 或数据库密码。

## Verification

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] 默认 SQLite 验证：不设置 `DATABASE_DRIVER` 或设置为 `sqlite`，旧本地路径继续可用。
- [x] MySQL 本机验证：设置 `DATABASE_DRIVER=mysql`，连接 `127.0.0.1:3306`，使用未提交 `.env` 中的本机凭据。
- [x] 浏览器验证：`pnpm dev`，打开 `http://localhost:5173`。
- [x] 验证注册、登录、退出、禁用用户登录失败。
- [x] 验证生成扣积分、失败退款、积分不足错误。
- [x] 验证每日签到只能成功一次。
- [x] 验证 Gallery 公开开关和图片广场。
- [x] 验证匿名访问公开图片成功、私密图片失败。
- [x] 验证管理员管理用户、积分、设置和审计记录。

## Final Integration Record

- 5 个子任务均已完成并归档：MySQL 存储底座、用户会话与权限归属、图片公开与图片广场、积分扣费与每日签到、后台管理与生成审计。
- 本轮最终检查已通过：`git diff --check`、`pnpm --filter @gpt-image-canvas/shared typecheck`、`pnpm typecheck`、`pnpm build`。
- MySQL 验证已覆盖存储底座、用户会话和后台审计；后台审计本轮使用本机 MySQL `127.0.0.1:3306` 临时库验证后已清理。
- 浏览器验证已覆盖登录/注册、图片广场、积分签到和后台管理；后台管理本轮额外验证了桌面和 `390x844` 移动视口无横向溢出。
- 交付文档已同步 `docs/generated/db-schema.md`、`docs/PRODUCT_SENSE.md`、`docs/RELIABILITY.md`、`docs/SECURITY.md` 和 Gallery 产品规格。

## Risk And Rollback

- 数据库切换风险高。每一阶段都应能单独回滚，不要把 schema、权限、UI 和积分混在一个提交里。
- 权限风险高。资产读取接口必须优先检查 owner/admin/公开状态。
- 积分扣费必须使用事务；失败退款要有流水，避免余额漂移。
- 若 MySQL 模式阻塞，可保留 SQLite 路径并只隐藏多用户入口。
