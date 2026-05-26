# MySQL 模式使用 OSS 存储图片资产

## Goal

当应用以 `USE_MYSQL=true` 运行时，生成图片和参考图资产不再依赖 ECS 本地 `DATA_DIR/assets` 作为主存储，而是上传到阿里云 OSS。后端资产接口先执行应用侧鉴权，再生成 OSS GET 预签名临时 URL 返回给前端；前端使用该临时 URL 访问图片，降低 ECS 磁盘压力和图片字节流带来的公网出流量压力。

本任务同时引入项目级 OSS 配置读取能力。配置内容必须支持用户给出的字段形态，但真实凭据不得提交到仓库。

示例配置形态：

```env
OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
OSS_BUCKET_NAME=<bucket-name>
OSS_ACCESS_KEY_ID=<access-key-id>
OSS_ACCESS_KEY_SECRET=<access-key-secret>
OSS_EXPIRE=86400
OSS_UPLOAD_MAX=10485760
OSS_ROOT_PATH=marketing/image/gpt-image/
OSS_INTERNAL=false
```

## Requirements

- MySQL 模式启用时，图片资产主存储必须走 OSS；SQLite 模式保持当前本地文件存储行为。
- OSS 配置来自 `.env` 或运行时环境变量；仓库只允许提交模板或占位符。
- AK/SK 只能放在后端运行时私有配置中，由后端读取；前端不得接触 AK/SK，只接收后端生成的 OSS GET 预签名临时 URL。
- 后端代码可以包含 OSS 读取、上传和签名逻辑，但不能包含真实 AK/SK 字符串；AK/SK 必须来自 `.env`、运行时环境变量或未提交的后端配置文件。
- 用户提供的真实 AccessKey 信息不得写入任务文档、源码、示例配置、日志或提交信息；本次聊天中出现过的真实密钥应在实施前轮换。
- `root-path` 下保存生成图片，路径需包含稳定、可追踪的对象 key，避免文件名冲突。
- `upload-max` 限制上传到 OSS 的单个对象大小，默认按用户给定值 `10485760` 字节。
- `expire` 控制默认下载链接有效期，默认按用户给定值 `86400` 秒。
- 生成图片成功后，数据库资产记录必须能定位 OSS 对象；Gallery、Canvas、Agent 输出、下载和预览路径不能断。
- 资产读取仍必须经过现有用户/管理员/公开输出权限判断，不允许绕过应用鉴权直接公开私有图。
- MySQL + OSS 模式下，原图和下载接口应在鉴权后返回 OSS GET 预签名临时 URL，避免大图字节流经过 ECS。
- 预览图可按需生成并上传 OSS，再返回 OSS GET 预签名临时 URL；如果先保留 API 代理预览，需要在设计中明确它仍产生少量 ECS 出口流量。
- OSS 上传失败时，生成记录必须保留可诊断状态；不能把不可读取的资产记录成成功输出。
- Docker 部署文档需说明 MySQL + OSS 模式需要挂载配置文件或注入配置路径。

## Acceptance Criteria

- [ ] `USE_MYSQL=true` 且 OSS 配置完整时，手动文生图成功上传 OSS，并能在 Canvas 和 Gallery 中展示。
- [ ] `USE_MYSQL=true` 且 OSS 配置完整时，参考图生成和 Agent 执行能读取历史资产作为参考图。
- [ ] 私有资产接口仍要求登录且校验 owner/admin；公开 Gallery 资产只在输出公开时可匿名访问。
- [ ] 原图、下载链接按配置的 `expire` 生成 OSS GET 预签名临时 URL；私有资产在生成 URL 前完成鉴权，不在 API 响应或日志中泄露 AccessKeySecret。
- [ ] 单个上传对象超过 `upload-max` 时返回稳定错误，生成记录不写成成功资产。
- [ ] SQLite 模式继续使用本地 `DATA_DIR/assets`，现有测试和开发流程不受影响。
- [ ] 文档更新部署说明：MySQL 模式依赖 OSS，需准备配置文件、MySQL、反向代理和备份策略。
- [ ] `pnpm typecheck` 和 `pnpm build` 通过。

## Notes

- 现状证据：`docs/RELIABILITY.md` 当前写明 MySQL 模式仍把生成图片保存在 `DATA_DIR/assets`，MySQL 只保存元数据和相对路径。本任务将修改该契约。
- 现状证据：`apps/api/src/domain/generation/image-generation.ts` 生成资产时写本地文件；`apps/api/src/server/routes/assets.ts` 读取资产时走 API 鉴权后读本地文件。
- 现状证据：`apps/api/src/domain/storage/store.ts` 和 `apps/api/src/infrastructure/mysql-database.ts` 中 `assets.relative_path` 当前表示相对 `DATA_DIR` 的路径。

## Open Questions

- 配置入口已确认收敛到 `.env` / 运行时环境变量，避免额外运行时配置文件。
- 用户确认方向：AK/SK 放后端侧使用。安全解释：不是写进源码，而是后端进程从未提交的运行时配置读取。
- 用户补充：这是测试 AK/SK，期望后端后续直接用于 OSS 上传。规划约束保持：测试密钥也按 secret 处理，不硬编码到提交源码。
- 用户提出允许提交 AK/SK 到代码红区；项目安全规则仍禁止提交任何 AK/SK。可接受方案是后端运行时读取未提交配置或环境变量。
