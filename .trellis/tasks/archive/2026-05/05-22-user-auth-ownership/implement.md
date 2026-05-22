# 用户会话与权限归属实施计划

## Ordered Checklist

- [x] 启动子任务前确认 `.trellis/tasks/05-22-mysql-storage-foundation` 已完成。
- [x] 新增 shared auth/user 类型和稳定错误码。
- [x] 新增用户、会话、最小系统设置 schema。
- [x] 为项目、资产、生成记录、生成输出、Agent 会话、提示词收藏补 `user_id`。
- [x] 实现密码 hash、密码校验、session token hash。
- [x] 实现 `.env` 管理员初始化：创建或激活，不自动重置密码。
- [x] 实现 SQLite 旧数据 owner backfill 到管理员账号。
- [x] 实现注册、登录、登出、当前用户接口。
- [x] 实现 auth/admin 中间件。
- [x] 保护创作、Gallery、资产、生成、provider、Agent、提示词收藏相关 API。
- [x] 更新资产读取路径，确保 owner/admin 判权先于文件读取。
- [x] Web 增加登录/注册页面和当前用户状态。
- [x] Web 未登录时不加载 canvas 主工作台。
- [x] 更新文档：登录策略、管理员初始化、旧数据归属、安全边界。

## Validation

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] SQLite 模式：未登录访问创作 API 返回 401。
- [x] SQLite 模式：`.env` 管理员创建成功；旧数据归属管理员。
- [x] SQLite 模式：修改 `ADMIN_PASSWORD` 重启不改变已有管理员密码。
- [x] MySQL 模式：注册、登录、退出、当前用户接口正常。
- [x] 禁用用户无法登录和生成。
- [x] 普通用户无法读取其他用户私密资产。
- [x] 运行 `pnpm dev`，用内置浏览器验证登录、注册、退出、未登录拦截。

## 本轮验证记录

- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- SQLite 临时库 smoke 通过：未登录 `/api/project` 返回 401；注册后 `/api/project` 和 `/api/auth/me` 返回 200；`sessions` 表只保存 64 位 token hash。
- SQLite 管理员初始化 smoke 通过：首次启动创建 admin；修改 `ADMIN_PASSWORD` 后重启，旧密码仍可登录，新密码不能登录，证明未重置已有密码。
- SQLite 资产判权 smoke 通过：普通用户读取管理员资产 `/api/assets/admin-asset-smoke` 返回 404，管理员返回 200。
- SQLite 禁用用户 smoke 通过：禁用用户登录返回 403，旧会话访问 `/api/project` 返回 401，旧会话发起 `/api/images/generate` 返回 401。
- SQLite 提示词收藏 owner smoke 通过：两个不同用户可收藏同一条提示词池项目；旧全局唯一索引已迁移为 `prompt_favorites_user_source_idx(user_id, source_type, source_id)`。
- MySQL 临时容器 smoke 通过：未登录 `/api/project` 返回 401；注册、`/api/auth/me`、退出正常；`sessions` 表只保存 64 位 token hash；`prompt_favorites` 唯一索引为 `user_id, source_type, source_id`。
- `pnpm dev` 可启动 API 与 Vite，`http://127.0.0.1:5173/` 返回 200，Vite 代理 `/api/auth/me` 返回 200。
- 内置浏览器验证通过：未登录只显示认证页且不挂载工作台；390px 移动视口无横向溢出；注册后进入工作台并显示用户栏；退出后回到认证页。截图保存到 `.codex-temp/ui-smoke/browser-auth-final.png`，不提交。

## Risky Files

- `apps/api/src/server/app.ts`
- `apps/api/src/server/routes/assets.ts`
- `apps/api/src/server/routes/gallery.ts`
- `apps/api/src/server/routes/images.ts`
- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/domain/project/project-store.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/shared/i18n/index.tsx`

## Rollback

- 如果登录保护导致主流程不可用，优先回滚 auth middleware 接入点，不删除新增表。
- 不删除已创建用户或会话表，避免误删本地账号。
- 旧数据 owner backfill 应幂等，回滚代码不应尝试清空 owner。
