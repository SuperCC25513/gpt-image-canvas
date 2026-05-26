# MySQL 模式使用 OSS 存储图片资产实施计划

## 准备

- 读取 `docs/RELIABILITY.md`、`docs/SECURITY.md`、`.trellis/spec/api/backend/*`、`.trellis/spec/shared/contracts/*`。
- 配置入口已收敛为 `.env` / 运行时环境变量。
- 已确认方案：API 鉴权后生成 OSS GET 预签名临时 URL，前端使用该 URL 渲染/下载图片，原图/下载/预览字节流不走 ECS。

## 实施步骤

1. 配置层
   - [x] 新增 `.env` 配置读取模块。
   - [x] 在 `.env.example` 中补充 OSS 占位字段。
   - [x] 移除额外运行时 YAML 配置文件，避免配置入口分散。
   - [x] 后端读取真实 AK/SK；源码、示例和测试 fixture 只保留占位符。
   - [x] 在 `USE_MYSQL=true` 时校验 OSS 必填字段。

2. OSS 适配器
   - [x] 增加 `OssAssetStorageAdapter`。
   - [x] 支持 `putObject`、`getObject`、`deleteObject`、`signedUrl`。
   - [x] 校验 object key 只落在 `root-path` 下。

3. 存储选择
   - [x] 增加资产存储工厂：SQLite 选本地，MySQL 选 OSS。
   - [x] 替换 `image-generation.ts` 中直接写本地文件的路径。
   - [x] 保持本地参考图和 provider 返回图都走统一适配器。

4. 资产读取
   - [x] 改造 `readStoredAsset` / `getStoredAssetFile` 类逻辑，支持 MySQL + OSS object key。
   - [x] MySQL + OSS 下 `/api/assets/:id`、`/download`、`/preview` 鉴权后 302 到 OSS GET 预签名临时 URL。
   - [x] 新增 `/api/assets/:id/access-url` 和 `/api/assets/:id/preview-url` JSON 接口，显式返回预签名 URL。
   - [x] Gallery、Canvas、Simple Generation、Agent preview 通过历史响应中的 `asset.url` 或资产路由获得签名 URL。
   - [x] Canvas 复用历史资产作为参考图时使用 `?proxy=1`，避免浏览器直接 fetch OSS 被 CORS 阻断。
   - [x] `/preview` 按需生成 OSS 预览对象并返回签名 URL。
   - [x] Gallery export 这类服务端打包场景仍从 OSS 读取 bytes。

5. 数据和文档
   - [x] 更新 MySQL `assets.relative_path` 注释。
   - [x] 更新 `docs/generated/db-schema.md`、`docs/RELIABILITY.md`、`docs/SECURITY.md`、README Docker/MySQL 部署说明。
   - [x] 明确 MySQL 模式不再要求备份 `DATA_DIR/assets` 作为主资产源。

6. 测试
   - [ ] 为配置解析加单元或 smoke 覆盖。
   - [ ] 为 OSS adapter 使用 fake client 覆盖上传、读取、超限、缺失配置。
   - [ ] 扩展现有 smoke，覆盖 MySQL + OSS 路径的成功生成和资产读取。
   - [x] 保持 SQLite 路径现有行为通过类型检查和构建验证。

## 验证命令

```sh
nvm use 24.15.0
pnpm typecheck
pnpm build
pnpm --filter @gpt-image-canvas/api smoke:executor
pnpm --filter @gpt-image-canvas/api smoke:agent
```

涉及真实 OSS 的验证使用本机私有配置文件，不提交凭据，不在日志打印 secret。

本次已执行：

```sh
nvm use 24.15.0
pnpm typecheck
pnpm build
```

## 风险点

- 真实或测试 AK/SK 都不能提交到 Git；即使用户临时允许，也与项目安全规则冲突。实现只能读取未提交运行时配置或环境变量。
- 私有图若直接暴露长期 OSS URL，会绕过现有 owner/admin 权限；MVP 只能暴露 OSS GET 预签名临时 URL，且必须先鉴权。
- 302 签名 URL 可降低 ECS 图片字节流，但 OSS 外网流出和请求费用仍存在。
- `upload-max=10MB` 可能低于部分生成图或参考图大小；超限行为必须清晰。
- MySQL + OSS 与 SQLite 本地文件路径语义不同，`assets.relative_path` 注释和 helper 命名需避免误导。

## 回滚

- SQLite 模式不受影响。
- MySQL 模式如 OSS 配置不可用，应启动失败而不是静默回退本地，避免线上资产落到不可备份路径。
- 回滚代码前保留 OSS bucket 数据和 MySQL 元数据；必要时根据 object key 批量下载回 `DATA_DIR/assets`。
