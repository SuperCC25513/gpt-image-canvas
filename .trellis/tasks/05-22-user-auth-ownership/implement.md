# 用户会话与权限归属实施计划

## Ordered Checklist

- [ ] 启动子任务前确认 `.trellis/tasks/05-22-mysql-storage-foundation` 已完成。
- [ ] 新增 shared auth/user 类型和稳定错误码。
- [ ] 新增用户、会话、最小系统设置 schema。
- [ ] 为项目、资产、生成记录、生成输出、Agent 会话、提示词收藏补 `user_id`。
- [ ] 实现密码 hash、密码校验、session token hash。
- [ ] 实现 `.env` 管理员初始化：创建或激活，不自动重置密码。
- [ ] 实现 SQLite 旧数据 owner backfill 到管理员账号。
- [ ] 实现注册、登录、登出、当前用户接口。
- [ ] 实现 auth/admin 中间件。
- [ ] 保护创作、Gallery、资产、生成、provider、Agent、提示词收藏相关 API。
- [ ] 更新资产读取路径，确保 owner/admin 判权先于文件读取。
- [ ] Web 增加登录/注册页面和当前用户状态。
- [ ] Web 未登录时不加载 canvas 主工作台。
- [ ] 更新文档：登录策略、管理员初始化、旧数据归属、安全边界。

## Validation

- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] SQLite 模式：未登录访问创作 API 返回 401。
- [ ] SQLite 模式：`.env` 管理员创建成功；旧数据归属管理员。
- [ ] SQLite 模式：修改 `ADMIN_PASSWORD` 重启不改变已有管理员密码。
- [ ] MySQL 模式：注册、登录、退出、当前用户接口正常。
- [ ] 禁用用户无法登录和生成。
- [ ] 普通用户无法读取其他用户私密资产。
- [ ] 运行 `pnpm dev`，用内置浏览器验证登录、注册、退出、未登录拦截。

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
