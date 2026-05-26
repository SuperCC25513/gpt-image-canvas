# MySQL 模式使用 OSS 存储图片资产验收记录

## 已完成

- MySQL 模式下资产主存储切换为 OSS；SQLite 模式继续使用 `DATA_DIR/assets`。
- 新增运行时配置读取：OSS 配置统一来自 `.env` 或 `OSS_*` 运行时环境变量。
- 新增 `OssAssetStorageAdapter`，支持上传、读取、删除、存在性检查和 GET 预签名 URL。
- 生成图和参考图保存走统一资产存储 helper；MySQL 模式写入 OSS object key，SQLite 模式写入本地路径。
- 历史记录、Gallery、公开 Gallery 返回的 `asset.url` 在 MySQL 模式下为 OSS GET 预签名 URL。
- `/api/assets/:id`、`/download`、`/preview` 在 MySQL 模式下鉴权后 302 到预签名 URL。
- 新增 `/api/assets/:id/access-url` 和 `/api/assets/:id/preview-url` JSON 接口。
- Gallery ZIP 导出和 Canvas 历史资产复用参考图仍可由服务端从 OSS 读取 bytes。
- 更新 README、可靠性、安全和数据库 schema 文档。

## 未做真实 OSS 联调

- 本次没有把真实 AK/SK 写入仓库，也没有在日志或任务文档中记录真实密钥。
- 真实 OSS 上传、下载和 bucket CORS 需要在本机未提交配置或部署环境变量下验证。

## 验证

```sh
nvm use 24.15.0
pnpm typecheck
pnpm build
```

两条命令均通过。

## 真实联调

- `.env` 已写入本地 MySQL + OSS 联调配置，文件被 Git 忽略。
- OSS 直连烟测通过：上传小 PNG、SDK 读回、GET 预签名 URL 访问、清理测试对象。
- 应用链路烟测通过：假 provider 生成图片，资产写入 OSS，生成记录和资产元数据写入 MySQL，`asset.url` 为 OSS URL，`/api/assets/:id/access-url` 返回 200，`/api/assets/:id` 和 `/api/assets/:id/preview` 返回 302，测试行和测试对象已清理。
