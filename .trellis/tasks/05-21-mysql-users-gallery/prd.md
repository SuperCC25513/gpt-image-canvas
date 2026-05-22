# MySQL 用户体系与图片广场

## Goal

把当前本地优先的单用户图片画布，扩展为可使用 MySQL 持久化的多用户图片创作产品。目标能力包含用户注册登录、用户级资产归属、图片是否公开、图片广场、积分扣费、每日签到、后台管理和生成审计。

目标不是一次性复制参考项目 `/Users/jesuscc/wcc/projects/github/image2creat` 的单体实现，而是吸收其中用户端功能和运营能力，并按当前仓库的 `apps/api`、`apps/web`、`packages/shared` 分层落地。

## Confirmed Facts

- 当前项目使用 `apps/api`、`apps/web`、`packages/shared` 工作区结构。
- 当前 API 使用 Hono、SQLite、Drizzle，数据库入口在 `apps/api/src/infrastructure/database.ts`，schema 在 `apps/api/src/infrastructure/schema.ts`。
- 当前 schema 使用 `drizzle-orm/sqlite-core`，不能直接切到 MySQL 连接；MySQL 需要新的 schema/dialect 或存储抽象。
- 当前 Gallery 已存在：`GET /api/gallery`、批量导出、删除、复用和下载能力。
- 当前 Gallery 按 `generation_outputs` 展示单张输出，因此公开状态更适合落在输出级别，而不是只落在生成记录级别。
- 当前资产二进制存储在 `DATA_DIR/assets`，数据库只保存资产元数据和路径；后续 MySQL 也应保持这种方式，不把图片 blob 存入 MySQL。
- 当前项目已有 Codex/OpenAI provider 配置和 Agent LLM 配置；这些是本地敏感数据，迁移到 MySQL 时仍必须隐藏密钥、避免日志泄露。
- 参考项目 `image2creat` 已实现 `users`、`sessions`、`user_checkins`、`generation_requests`、`is_public`、管理员用户管理和积分配置。
- 用户指定后续使用本机 MySQL：`127.0.0.1:3306`。本机验证凭据通过 `.env` 提供，不写死在代码中，不提交真实 `.env`。
- 用户已拍板存储策略：通过 `.env` 维护存储驱动，默认使用 SQLite；MySQL 为显式启用；SQLite 数据不迁移到 MySQL。
- 用户已拍板登录策略：SQLite 和 MySQL 都走统一登录流程，不保留免登录创作入口。
- 用户已拍板管理员初始化策略：首个管理员账号由 `.env` 中的 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 创建或激活。
- 用户已拍板管理员密码策略：`.env` 中 `ADMIN_PASSWORD` 变化时，不自动重置已有管理员密码；已有账号只确保 `role=admin`、`status=active`。
- 用户已拍板旧 SQLite 数据归属策略：统一登录启用后，旧 SQLite 中没有 `user_id` 的项目、资产、生成记录和输出归属给 `.env` 初始化的管理员账号。
- 用户已拍板注册默认策略：默认开放注册，默认不需要管理员审核。
- 现有任务 `05-21-remove-cloud-storage` 已完成并归档；本任务不需要携带云存储表、字段、按钮或回退逻辑。
- 规划已拆为 5 个可独立验证子任务：MySQL 存储底座、用户会话与权限归属、图片公开与图片广场、积分扣费与每日签到、后台管理与生成审计。

## Requirements

- MySQL 成为后续多用户部署的主存储目标。
- 存储驱动由 `.env` 控制，默认值为 SQLite；设置 `DATABASE_DRIVER=mysql` 后才启用 MySQL。
- 本地开发支持通过 `.env` 配置 MySQL 主机、端口、账号、密码、数据库名和连接池大小。
- 服务启动时必须能检测 MySQL 配置和连接状态；开发环境可自动建库/建表或给出清晰迁移提示。
- SQLite 和 MySQL 数据互相独立；本任务不迁移既有 SQLite 数据。
- 迁移当前核心数据模型到 MySQL：项目、资产、生成记录、生成输出、生成参考资产、provider 配置、Agent LLM 配置、Agent 会话、Agent 技能、提示词收藏。
- 新增用户体系：注册、登录、退出、会话续期/过期、用户角色、用户状态。
- 服务启动时支持从 `.env` 初始化管理员账号；不能把默认管理员密码写入代码或文档示例；不能因为 `.env` 密码变化自动覆盖已有管理员密码。
- SQLite 升级到统一登录后，旧数据中缺失 owner 的记录必须归属到管理员账号，不能归属到首个普通注册用户。
- 系统设置默认 `allow_registration=true`、`require_approval=false`；管理员后续可在后台修改。
- 新增用户级权限：项目、生成记录、生成输出、资产必须能归属到用户；普通用户只能访问自己的私有内容和所有公开内容，管理员可访问运营管理视图。
- SQLite 模式和 MySQL 模式都必须要求登录后才能进入创作、Gallery、资产下载、生成和管理能力。
- 新增图片公开能力：生成前可选择是否公开；生成后可在 Gallery 中切换单张输出的公开/私密状态；默认私密。
- 新增图片广场：展示用户公开的图片，包含安全的图片地址、提示词摘要、尺寸、模型/质量、发布时间和可复用入口。
- 新增积分体系：用户有积分余额；生成前按输出数量预扣；失败或部分失败退款；后台可设置注册送积分和每张图消耗积分。
- 新增每日签到：用户每天最多签到一次，成功后增加配置的积分奖励。
- 新增后台管理：管理员可查看用户、启停用户、设置角色、调整积分、配置注册/审核/积分规则、查看生成审计。
- 新增生成审计：记录用户、提示词、公开状态、状态、错误摘要、IP、User-Agent、生成输出关联。
- API 和 Web 必须保持密钥安全：任何读接口只返回 mask 或配置状态，不返回原始 API Key、OAuth token、云密钥或数据库密码。
- UI 必须保持当前产品“创作画布 + Gallery”的核心体验；用户体系和广场不能让本地创作路径变复杂。
- 文档必须更新 MySQL 配置、数据库表、迁移路径、安全边界和验证流程。

## Out Of Scope

- 不在本任务中实现真实支付、充值、订单或第三方登录。
- 不把图片二进制写入 MySQL。
- 不把本机 MySQL 凭据提交到仓库。
- 不做 SQLite 到 MySQL 的数据迁移脚本。
- 不要求 MySQL 自动读取或复用既有 SQLite 数据。
- 不要求公开广场支持社交互动、点赞、评论、关注或审核流。
- 不要求首次版本支持复杂多租户组织、团队空间或企业权限。
- 不要求从参考项目直接复制前端视觉设计；只迁移产品能力和关键数据流。

## Subtasks

- `.trellis/tasks/05-22-mysql-storage-foundation`：先让当前核心能力在 MySQL 显式驱动下可启动、建表和读写。
- `.trellis/tasks/05-22-user-auth-ownership`：增加注册登录、会话、角色状态和 owner 权限。
- `.trellis/tasks/05-22-public-gallery-visibility`：增加输出级公开状态、Gallery 开关和图片广场。
- `.trellis/tasks/05-22-credits-checkins`：增加积分余额、流水、生成扣费退款和每日签到。
- `.trellis/tasks/05-22-admin-audit`：增加用户管理、系统设置、积分调整和生成审计后台。

## Acceptance Criteria

- [ ] MySQL 模式下服务能连接本机 MySQL，并创建/迁移所需表。
- [ ] 默认不配置 `DATABASE_DRIVER` 时继续使用 SQLite。
- [ ] 设置 `DATABASE_DRIVER=mysql` 后使用 MySQL，且不尝试迁移 SQLite 数据。
- [ ] SQLite 和 MySQL 模式下，新用户都可注册、登录、退出；未登录用户不能进入创作和私有资源；禁用用户无法登录和生成。
- [ ] 默认设置允许用户注册，且注册后直接为 active，无需管理员审核。
- [ ] 配置 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 后，服务启动会创建或激活管理员账号，且不会打印密码。
- [ ] SQLite 旧项目、资产、生成记录和输出在补 owner 后归属管理员账号。
- [ ] 管理员可登录后台并管理用户角色、状态、积分和系统积分规则。
- [ ] 生成图片时按配置积分扣费；积分不足返回稳定错误；生成失败会退款。
- [ ] 用户可每日签到一次，并看到积分余额更新。
- [ ] 生成时可选择是否公开；Gallery 内可切换单张输出公开状态。
- [ ] 图片广场只展示公开输出；匿名或未登录用户不能访问私密图片。
- [ ] 普通用户不能删除、导出、下载或复用其他用户的私密输出。
- [ ] 管理员审计页可查看生成请求、用户、IP/User-Agent、状态、错误摘要和关联输出。
- [ ] `packages/shared` 暴露的 API 契约覆盖 auth、admin、credits、checkin、public gallery 和 visibility 状态。
- [ ] `docs/generated/db-schema.md`、`docs/PRODUCT_SENSE.md`、`docs/RELIABILITY.md`、`docs/SECURITY.md` 和必要产品规格更新。
- [ ] 通过 `pnpm typecheck`。
- [ ] 通过 `pnpm build`。
- [ ] UI 验证：运行 `pnpm dev`，打开 `http://localhost:5173`，检查注册/登录、生成、Gallery 公开开关、图片广场、积分签到、后台管理。

## Notes

- 推荐拆成多阶段实施：存储驱动配置 + MySQL 底座 → 用户/会话/权限 → 公开开关/图片广场 → 积分/签到 → 后台/审计。
- `root/root` 这类本机凭据只用于本地 `.env` 验证，不写入代码默认值，不写入生产文档示例。
