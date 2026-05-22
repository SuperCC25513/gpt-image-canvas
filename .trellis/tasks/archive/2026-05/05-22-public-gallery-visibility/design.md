# 图片公开与图片广场设计

## Architecture

本任务建立输出级公开能力。它依赖用户和 owner 权限已经完成。

边界：

- `galleryStore`：我的 Gallery、公开广场、公开状态切换、删除后广场剔除。
- `assetAccessPolicy`：owner/admin/公开输出三态判权。
- Web Gallery：在现有 Gallery 卡片中加入公开状态和切换按钮。
- Web Public Gallery：新增公开图片广场页面或视图，复用 Gallery 卡片结构。

## Data Model

`generation_outputs` 新增：

- `is_public`：默认 `false`。
- `published_at`：公开时写入时间，改回私密时清空。
- `public_title`：可选，首版可不暴露编辑入口。

公开状态放在输出表而非生成记录表。原因：当前 Gallery 以单张输出为卡片，一次生成多图时用户可能只公开部分图片。

## API

- `GET /api/gallery`：当前用户自己的 Gallery，需要登录。
- `PATCH /api/gallery/:outputId/visibility`：owner/admin 修改公开状态。
- `GET /api/gallery/public?limit=60`：公开广场，可匿名访问。
- `GET /api/assets/:id`、`/preview`、`/download`：owner/admin 可读私密；公开输出关联的资产可匿名读取 inline/preview。下载是否允许匿名首版应保持和公开资产读取一致。

响应字段只返回安全数据：

- 输出 ID、资产 URL、预览 URL。
- 提示词摘要或完整 prompt，按产品要求可复用。
- 尺寸、模式、质量、发布时间。
- 作者展示名，不返回邮箱。

## Web UX

- 生成面板增加公开开关，默认关闭。
- Gallery 卡片显示“私密/公开”状态。
- owner/admin 可在卡片或详情中切换公开状态。
- 图片广场使用工作台风格，不做营销首页。
- 匿名访问广场只展示公开内容，不显示私有操作：删除、批量导出私有、切换状态。
- 登录用户可从公开图复用 prompt 到创作流。

## Security

- 公开广场不能返回用户邮箱、内部路径、错误堆栈、密钥状态。
- 资产读取必须以输出公开关系为依据，不能只看 asset id。
- 私密输出改为公开或公开改私密必须检查 owner/admin。
- 删除输出后公开广场查询自然消失。

## Compatibility

- 旧输出默认私密。
- MySQL 和 SQLite schema 都要增加同样字段。
- 没有 owner 的旧输出已在前置任务归属管理员，本任务不再处理归属。
