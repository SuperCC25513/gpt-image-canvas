# 移除云存储功能

## Goal

从当前产品中完整移除云存储能力，让生成图片只依赖本地运行时资产目录保存和读取。移除范围包含腾讯云 COS、Cloudflare R2 / S3-compatible、云端双写开关、云存储配置接口、云上传状态、相关依赖和文档描述。

目标不是改变图片生成、画布、Gallery 或下载体验，而是降低后续 MySQL、多用户、公开广场和权限体系的复杂度。移除后，本地文件仍是唯一资产来源，生成成功后的图片必须继续能在画布、Gallery、下载、预览、Agent 输出中稳定使用。

## Confirmed Facts

- 当前 API 使用 SQLite + Drizzle，资产表由 `apps/api/src/infrastructure/schema.ts` 和 `apps/api/src/infrastructure/database.ts` 共同维护。
- 当前资产表包含 `cloud_*` 字段，并且存在 `storage_configs` 表保存 COS / S3 配置。
- 当前生成链路在本地保存图片后，会尝试读取已启用云存储配置并上传；云失败只记录在 asset 元数据中。
- 当前 Web 端在 `apps/web/src/features/canvas/CanvasApp.tsx` 中包含云存储设置按钮、弹窗、表单、测试和保存逻辑。
- 当前共享契约从 `packages/shared/src/storage.ts`、`packages/shared/src/image.ts`、`packages/shared/src/generation.ts` 暴露云存储 provider、配置 request/response 和 `GeneratedAsset.cloud`。
- 当前文档和 Trellis 规范仍把云备份描述为产品能力。

## Requirements

- 删除用户可见的云存储入口。画布侧边栏不再显示云存储按钮，也不能打开云存储设置弹窗。
- 删除云存储 API。`/api/storage/config` 和 `/api/storage/config/test` 不再作为产品接口存在。
- 删除生成后的云端双写逻辑。图片生成只写入本地 `DATA_DIR/assets`，云上传失败相关 warning 不再出现。
- 删除云端回读逻辑。读取资产只从本地安全路径读取；本地文件缺失时按现有不可用/404 流程处理，不再尝试云端兜底。
- 删除共享契约中的云存储配置类型和 `GeneratedAsset.cloud` 暴露，Web 和 API 不再依赖云字段。
- 删除 COS / S3 SDK 依赖和只服务于云存储的适配器代码。
- 更新数据库 schema、启动 SQL 和 schema 文档，使新数据库不再创建云存储字段和配置表。
- 对旧数据库保持启动鲁棒性：旧库中残留的 `cloud_*` 字段或 `storage_configs` 表不应导致启动失败；实现不再读写这些旧字段。
- 更新产品、可靠性、安全、设计和 Trellis 规范文档，避免后续开发继续按云存储能力设计。
- 保持现有 Gallery、本地资产预览、下载、删除、画布复用、Agent 输出可用。

## Out Of Scope

- 不做 MySQL 存储迁移。
- 不做用户体系、后台管理、积分、签到、公开广场。
- 不删除用户本地 `data/assets` 中已有图片文件。
- 不做旧云端对象清理工具；已经上传到云端的对象由用户自行管理。
- 不做 SQLite 物理列删除迁移；旧库中的遗留列和表可保留但不再被代码使用。

## Acceptance Criteria

- [ ] Web 页面中不再出现云存储设置按钮、云存储设置弹窗、COS、R2、S3、云端双写、云上传失败等用户可见文案。
- [ ] API 不再注册云存储配置路由，相关 route、domain storage config、云存储 parser 被移除。
- [ ] 生成图片只写入本地资产目录；生成记录、输出记录、资产记录仍能完整保存。
- [ ] 资产读取、预览、下载只使用本地路径，并继续防止目录逃逸。
- [ ] Gallery 能继续加载、搜索、预览、下载、导出、删除和复用图片。
- [ ] Agent 执行生成图片后仍能在画布上插入预览，并且事件契约不再包含云字段。
- [ ] 新建 SQLite 数据库时不再创建 `storage_configs` 表和 `assets.cloud_*` 字段。
- [ ] 旧 SQLite 数据库中残留云字段或云配置表时，应用启动不报错，业务忽略旧云数据。
- [ ] `apps/api/package.json` 不再依赖 `@aws-sdk/client-s3` 和 `cos-nodejs-sdk-v5`。
- [ ] `docs/generated/db-schema.md` 和相关产品/可靠性/安全文档不再描述云存储能力。
- [ ] 通过 `pnpm typecheck`。
- [ ] 通过 `pnpm build`。
- [ ] UI 验证：运行 `pnpm dev`，打开 `http://localhost:5173`，确认桌面和移动视口中生成面板、历史记录、Gallery、设置入口无云存储残留且布局不重叠。

## Notes

- 推荐采用“兼容删除”策略：新代码不创建、不读取、不写入云存储字段；旧数据库物理字段保留，避免复杂 SQLite drop-column 迁移和用户数据风险。
- 用户已确认继续采用兼容删除策略。
