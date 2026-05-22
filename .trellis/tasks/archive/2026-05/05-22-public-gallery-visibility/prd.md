# 图片公开与图片广场

## Goal

新增输出级公开状态和用户端图片广场。用户生成前可选择是否公开，生成后可在 Gallery 中切换单张输出公开或私密；广场只展示公开输出。

## Parent And Dependency

- 父任务：`.trellis/tasks/05-21-mysql-users-gallery`
- 前置依赖：`.trellis/tasks/05-22-user-auth-ownership` 已完成 owner 权限和资产读取鉴权。

## Confirmed Facts

- 当前 Gallery 展示粒度是 `generation_outputs` 单张输出，不是整个生成记录。
- 因此公开状态应落在输出级别，支持一次生成多张图时只公开其中部分图片。
- 当前 Gallery Web 已有搜索、详情、下载、复用、删除和批量导出。

## Requirements

- `generation_outputs` 增加 `is_public`、`published_at` 和可选展示标题字段。
- 生成请求支持 `isPublic` 或等价字段，默认私密。
- Gallery 卡片和详情页显示公开/私密状态，并提供 owner/admin 可用的切换动作。
- 新增 `PATCH /api/gallery/:outputId/visibility`，只允许 owner/admin 修改。
- 新增 `GET /api/gallery/public?limit=60`，返回公开广场安全字段。
- 公开广场字段包含图片 URL、预览 URL、提示词摘要、尺寸、模式、质量、模型或 provider 摘要、发布时间、作者展示名。
- 匿名用户可以浏览公开广场和公开图片资源；匿名用户不能访问私密资源。
- 复用公开图片时，只能复用安全提示词和公开资产 URL，不暴露 owner 私密数据。
- UI 保持当前创作工作台风格，不做营销首页。

## Acceptance Criteria

- [x] 生成前公开开关默认关闭。
- [x] 生成后 Gallery 单张输出可切换公开/私密。
- [x] 一次生成多张图时，可以只公开其中一张。
- [x] 公开广场只展示公开输出，并按发布时间倒序。
- [x] 匿名访问公开图片成功，访问私密图片失败。
- [x] 普通用户不能切换其他用户输出的公开状态。
- [x] 删除或设为私密后，广场不再展示该输出。
- [x] shared 契约覆盖公开状态、广场条目和 visibility 更新请求。
- [x] 通过 `pnpm typecheck`。
- [x] 通过 `pnpm build`。
- [x] 运行 `pnpm dev` 后，用内置浏览器验证 Gallery 公开开关和图片广场桌面/移动视图。

## Out Of Scope

- 不做点赞、评论、关注、收藏广场图。
- 不做内容审核队列。
- 不做 SEO 或独立公开落地页。
- 不做 CDN 或对象存储。

## Notes

- 图片广场应优先复用现有 Gallery 卡片视觉语言，避免做成独立营销页。
- 资产路由必须使用 owner/admin/公开输出三态鉴权。
