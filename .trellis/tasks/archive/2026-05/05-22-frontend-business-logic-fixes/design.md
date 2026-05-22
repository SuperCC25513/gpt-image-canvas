# 修复前端业务逻辑风险设计

## 边界

- 修改范围集中在 `apps/web`：
  - `src/App.tsx`
  - `src/features/canvas/CanvasApp.tsx`
  - `src/features/gallery/GalleryPage.tsx`
  - `src/features/admin/AdminPage.tsx`
  - 如需新增文案，更新 `src/shared/i18n` 对应中英文消息。
- 不修改 API 路由、数据库 schema 或 shared 契约字段。
- 后端鉴权仍是安全边界；前端修复目标是避免错误流程、崩溃和假操作。

## 认证刷新

`App.loadMe` 增加轻量选项，用于区分初次加载、登出刷新和登录后补充刷新：

- 初次加载和登出后刷新：保持现状，失败时清空 `currentUser`。
- 登录/注册成功后的补充刷新：如果 `/api/auth/me` 失败，保留登录接口返回的 `body.user`，展示错误但不回登录页。

这样可以保留会话建立的事实，同时不把设置刷新失败伪装成登录失败。

## Canvas 账号状态

`CanvasApp` 的生成和签到依赖 `accountStatus`：

- 增加账号不可用校验：`isAccountLoading || accountError || !accountUser` 时生成不可用。
- 签到按钮在相同条件下禁用。
- 若账号接口明确返回未认证或失败，UI 显示现有 `accountError` 或新增本地化提示。

可选增强：给 `CanvasApp` 暴露 `onSessionExpired` 回调让顶层 `App` 同步登录态。但为避免扩大改动，本任务优先在 Canvas 内阻止错误操作；如果实现中发现顶层状态必须同步，再补最小回调。

## Gallery 数据守卫

在 `GalleryPage` 内新增局部 runtime guard：

- 先检查响应是对象且 `items` 是数组。
- 对每个 item 校验渲染和操作必需字段：`outputId`、`generationId`、`prompt`、`effectivePrompt`、`presetId`、`size.width/height`、`quality`、`outputFormat`、`createdAt`、`asset.id/url/width/height`、`isPublic`。
- 公开 Gallery 的额外字段不作为私有页面渲染的必需条件，但 `publishedAt` 和 `authorName` 存在时需为字符串。

非法数据直接抛出 `galleryServiceInvalidData`，不进入 React 渲染树。

## Admin 交互

- 当前管理员自己的角色和状态下拉设置为 disabled。
- 保留 `adminSelfGuard` 提示，后端 `admin_self_demotion` / `admin_self_disable` 仍兜底。
- 审计输出渲染时分支处理：
  - 有 `output.asset`：渲染外链。
  - 无 `output.asset`：渲染不可点击元素，保留 output id 和状态。

## 兼容和回滚

- 所有改动都是前端运行时行为收紧，不涉及持久数据迁移。
- 如果 guard 误杀合法响应，应优先对照 `packages/shared/src/generation.ts` 修正 guard，而不是放宽到 `as` 断言。
- 回滚可以按文件独立进行：认证、Canvas、Gallery、Admin 四块互不依赖。
