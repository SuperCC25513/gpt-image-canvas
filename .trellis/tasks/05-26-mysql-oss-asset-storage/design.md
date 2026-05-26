# MySQL 模式使用 OSS 存储图片资产设计

## 架构边界

当前应用在 API 层统一处理资产权限，前端只使用 `/api/assets/:id`、`/api/assets/:id/preview`、`/api/assets/:id/download`。本任务应保持这个接口形态，避免前端直接依赖 OSS 鉴权细节。

后端新增资产存储抽象：

- SQLite 驱动：继续使用 `LocalAssetStorageAdapter` 和 `DATA_DIR/assets`。
- MySQL 驱动：使用 `OssAssetStorageAdapter` 作为主存储。

数据库仍由 MySQL 保存资产元数据、生成记录和 Gallery 状态。OSS 保存图片二进制对象。

## 配置设计

推荐使用 `.env` / 运行时环境变量：

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

配置读取规则：

- 默认通过现有 dotenv 机制读取 `.env`。
- Docker Compose 已使用 `env_file: .env`，不需要额外挂载运行时 YAML。
- 仓库只提交 `.env.example` 中的占位字段，真实 `.env` 必须 Git 忽略。
- AK/SK 只在后端 Node 进程内读取和使用，用于 OSS 上传、读取和生成 GET 预签名 URL；前端永远不接收 AK/SK。
- 后端源码只包含配置读取和 OSS client 构造逻辑；真实 AK/SK 不作为常量、默认值或测试 fixture 提交。
- 真实 AccessKey 不写入 `.env.example`、文档示例、日志、测试快照或提交内容。
- 缺失 OSS 配置且 `USE_MYSQL=true` 时启动失败，错误信息只说明缺失字段名。

字段规范：

- `endpoint`：OSS endpoint，不包含协议时 SDK 按官方格式处理。
- `bucketName`：目标 bucket。
- `accessKeyId` / `accessKeySecret`：只用于服务端上传和签名。
- `expire`：签名下载 URL 默认过期秒数。
- `upload-max`：单对象上传大小上限。
- `root-path`：对象 key 前缀，规范化为单个尾部 `/`。

## 数据模型

当前 `assets.relative_path` 语义是相对 `DATA_DIR`。MySQL + OSS 模式需要改为可识别的存储定位。

推荐兼容方案：

- 保留 `assets.relative_path` 字段名，MySQL + OSS 中写入 OSS object key，例如 `marketing/image/gpt-image/YYYY/MM/<assetId>.<ext>`。
- 更新字段注释和 `docs/generated/db-schema.md`：MySQL + OSS 下该字段表示对象 key，SQLite 下表示本地相对路径。
- 避免本阶段新增跨驱动复杂 schema；后续若支持多云，可再引入 `storage_driver`、`bucket`、`object_key` 等字段。

## 写入流程

生成图流程：

1. Provider 返回图片 bytes。
2. 读取图片尺寸并检查 MIME/大小。
3. 根据数据库驱动选择存储适配器。
4. SQLite：写入 `DATA_DIR/assets/<assetId>.<ext>`。
5. MySQL：上传 OSS object key。
6. 上传成功后写 `assets` 和 `generation_outputs`。
7. 上传失败时记录失败输出和稳定错误，不写成功资产。

参考图持久化流程同样使用存储适配器，保证 Agent 选中本地画布图片后可在 MySQL + OSS 模式复用。

## 读取流程

资产读取仍从 API 进入：

1. `userCanReadAsset` 判断 owner/admin/公开输出权限。
2. SQLite：读本地文件。
3. MySQL：使用 OSS object key 生成 OSS GET 预签名临时 URL。

落地 MVP：

- `/api/assets/:id`、`/download`、`/preview` 先执行现有权限判断，通过后 302 到 OSS GET 预签名临时 URL，保持既有 `<img src>` 和下载链接可用。
- `/api/assets/:id/access-url`、`/api/assets/:id/preview-url` 返回 JSON，包含 OSS GET 预签名临时 URL 和过期时间，供后续需要显式 URL 的前端调用。
- Canvas、Gallery、Simple Generation、Agent preview 使用历史响应中的 `asset.url` 或现有资产路由，浏览器直接从 OSS 拉取字节，减少 ECS 出口流量。
- Canvas 需要把历史资产作为参考图再上传给 provider 时，使用 `/api/assets/:id?proxy=1` 走 API 读取一次 bytes，避免浏览器直接 fetch OSS 受到 bucket CORS 配置影响。
- 公开 Gallery 仍先走 API 权限判断；后续可优化为直接返回 CDN URL 或公开读 URL。

签名 URL 需求：

- 提供内部 helper 生成临时签名 URL。
- 本阶段不把私有资产的长期 OSS URL 直接暴露给前端；所有私有 URL 必须短期过期。
- API 响应只返回临时 URL、过期时间、MIME、文件名等非密钥信息；不返回 AK/SK。

## 预览策略

当前预览由 `readStoredAssetPreview` 读原图 bytes 后用 `sharp` 生成 WebP，并写入 `DATA_DIR/asset-previews`。

推荐 MySQL + OSS 预览策略：

- MySQL + OSS 下原图从 OSS 读取。
- 预览图按需生成 WebP 后上传到 OSS 的预览对象路径，例如 `root-path/previews/<assetId>-<width>.webp`。
- `/api/assets/:id/preview` 鉴权后返回预览对象的 OSS GET 预签名临时 URL。
- 预览生成失败时返回稳定错误；不得回退到公开未鉴权 URL。

## 依赖和兼容

需要引入阿里云 OSS SDK，或使用 S3 兼容 SDK 仅在确认 endpoint 兼容后采用。推荐使用官方 `ali-oss`，减少签名和 endpoint 差异风险。

SQLite 行为必须不变，已有本地开发和 Docker 单机模式继续可用。

## 安全和运维

- 用户在聊天里贴过真实形态 AccessKey；实施前应轮换。
- 日志只能输出 OSS bucket、endpoint 和 object key 摘要，不输出 secret。
- Caddy 不应直接暴露 `DATA_DIR` 或 OSS 原始私有 URL。
- 备份策略从 “MySQL + DATA_DIR/assets” 变为 “MySQL + OSS bucket 生命周期/版本/备份”。

## 取舍

MVP 选择 “API 鉴权后返回 OSS GET 预签名临时 URL” 而不是 “API 代理 OSS bytes” 或 “302 跳转”，因为用户主要担心 ECS 文件存储和公网出流量，同时希望前端显式使用该 URL。这样权限入口保持一致，图片字节流由 OSS 承担。代价是前端要处理临时 URL 获取、缓存和过期刷新。
