# 图片公开与图片广场实施计划

## Ordered Checklist

- [x] 确认 `.trellis/tasks/05-22-user-auth-ownership` 已完成。
- [x] shared 增加 `GalleryVisibility`、公开广场条目、visibility 更新请求/响应类型。
- [x] `generation_outputs` 增加 `is_public`、`published_at`、可选 `public_title`。
- [x] 生成请求类型增加 `isPublic`，默认 `false`。
- [x] 生成输出写入时继承请求公开状态。
- [x] 增加 `PATCH /api/gallery/:outputId/visibility`。
- [x] 增加 `GET /api/gallery/public?limit=60`。
- [x] 修改资产读取判权，支持公开输出关联资产匿名读取。
- [x] Gallery UI 增加公开状态和切换动作。
- [x] 生成 UI 增加公开开关，默认关闭。
- [x] 新增图片广场视图和导航入口。
- [x] i18n 增加中英文文案。
- [x] 更新 Gallery/资产产品文档和安全说明。

## Validation

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] 未登录可以访问公开广场。
- [x] 未登录不能访问私密资产。
- [x] owner 可公开/私密切换自己的输出。
- [x] 普通用户不能切换他人输出。
- [x] 一次生成多张图时可只公开部分输出。
- [x] 删除或设私密后公开广场不再展示。
- [x] 运行 `pnpm dev`，用内置浏览器验证桌面和移动视图。

## Risky Files

- `apps/api/src/server/routes/gallery.ts`
- `apps/api/src/server/routes/assets.ts`
- `apps/api/src/domain/project/project-store.ts`
- `apps/api/src/domain/generation/image-generation.ts`
- `apps/web/src/features/gallery/GalleryPage.tsx`
- `apps/web/src/shared/i18n/index.tsx`
- `apps/web/src/styles/gallery-cards.css`

## Rollback

- 回滚 UI 入口时保留数据库字段。
- 若公开资产判权有风险，先关闭公开广场路由和公开读取，只保留私密 Gallery。
