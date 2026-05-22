# 移除云存储功能技术设计

## 架构边界

本任务横跨 `packages/shared`、`apps/api`、`apps/web` 和文档。目标是删除云存储能力，同时保留本地资产链路作为唯一来源。

移除后的资产数据流：

```text
图片 provider 返回字节
→ API 写入 DATA_DIR/assets
→ SQLite assets 记录本地文件元数据
→ API /api/assets/:id、/preview、/download 从本地读取
→ Web 画布、Gallery、Agent 输出展示本地资产
```

不再存在：

```text
storage_configs
→ getActiveCloudStorageConfig()
→ COS / S3 putObject()
→ asset.cloud
→ Web 云上传失败状态
→ 云端回读 fallback
```

## Shared 契约设计

- 从 `packages/shared/src/image.ts` 删除 `CloudStorageProvider` 和 `AssetCloudUploadStatus`。
- 从 `packages/shared/src/generation.ts` 删除 `GeneratedAsset.cloud` 和 `GeneratedAssetCloudInfo`。
- 删除 `packages/shared/src/storage.ts`，并从 `packages/shared/src/index.ts` 移除导出。
- 从 `apps/api/src/domain/contracts.ts` 移除 storage contract re-export。
- Web 和 API 使用 `GeneratedAsset` 时必须只依赖 `id`、`url`、`fileName`、`mimeType`、`width`、`height`。

兼容策略：如果旧 Agent conversation 或旧快照中存在 `asset.cloud`，前端 runtime guard 可忽略该字段；新的类型不暴露 cloud。

## API 设计

### 路由

- 从 `apps/api/src/server/app.ts` 删除 `registerStorageRoutes()`。
- 删除 `apps/api/src/server/routes/storage.ts`。
- 从 `apps/api/src/server/http/validation.ts` 删除 `parseStorageConfigPayload()` 和相关 helper。

若旧客户端访问 `/api/storage/config`，按普通未注册路由处理即可，不新增兼容假接口。原因：这是移除产品能力，保留假接口会继续暗示云存储可用。

### 生成链路

`apps/api/src/domain/generation/image-generation.ts` 改为本地-only：

- 保留本地文件写入。
- 删除 `getActiveCloudStorageConfig()` 调用。
- 删除 `saveAssetToConfiguredCloud()`、`readCloudAsset()`、`toCloudAssetLocation()`、`toGeneratedAssetCloud()`。
- 删除 asset insert 中所有 `cloud*` 字段。
- `readStoredAsset()` 只读本地文件；本地不存在时返回不可用。
- `toGeneratedAsset()` 不返回 cloud。

鲁棒性重点：

- 本地写入失败仍应让生成失败或输出失败，不能插入指向不存在文件的成功资产。
- 旧库里有 cloud 字段也不读，避免缺本地文件时偷偷依赖远端。
- 删除云失败 warning 后，部分失败只代表 provider 或本地保存失败。

### 本地存储适配器

`apps/api/src/infrastructure/storage/asset-storage.ts` 可保留文件名，但只保留 `LocalAssetStorageAdapter` 和本地读写删除接口。删除 COS/S3 adapter、object key builder、storage error helper。

如果文件只剩薄包装且收益不大，实施时可改为更明确的 `local-asset-storage.ts`，但为减少跨文件重命名风险，优先保留现有文件名并瘦身。

### 数据库

新 schema：

- `assets` 表只保留本地资产字段：`id`、`file_name`、`relative_path`、`mime_type`、`width`、`height`、`created_at`。
- 不再定义 `storage_configs` 表。
- `database.ts` 的 `CREATE TABLE IF NOT EXISTS assets` 不再包含 `cloud_*` 字段。
- 删除 `CREATE TABLE IF NOT EXISTS storage_configs`。
- 删除 `ensureColumn("assets", "cloud_*", ...)`。
- 删除 `ensureColumn("storage_configs", ...)`。
- 删除 `migrateStorageConfigRows()` 和相关类型。

旧数据库兼容：

- 不执行 DROP COLUMN，不 DROP TABLE。
- Drizzle schema 不声明旧字段，正常查询不会读取旧字段。
- SQLite 允许表存在多余列，新 insert 不指定旧列时旧列保持 null。
- 旧 `storage_configs` 表孤立存在但代码不访问。

### 依赖

从 `apps/api/package.json` 删除：

- `@aws-sdk/client-s3`
- `cos-nodejs-sdk-v5`

通过 `pnpm install` 或等价 pnpm 操作更新 `pnpm-lock.yaml`。不手写锁文件。

## Web 设计

`apps/web/src/features/canvas/CanvasApp.tsx`：

- 删除 `Cloud` 图标导入，除非还有非云用途。
- 删除 `StorageConfigFormState`、`StorageSecretTouchedState`。
- 删除 `defaultStorageConfigForm`、`storageConfigToForm()`、`storageConfigRequestBody()`、`shouldPreserveStorageSecret()`。
- 删除 storage 相关 state、effect、open/close/update/test/save handlers。
- 删除生成面板里的云存储设置按钮。
- 删除云存储弹窗 JSX。
- 删除 `cloudFailureCount()`、`firstCloudFailureMessage()` 和历史记录中的云失败标记。
- 调整 `generationWarningMessage()`，只处理生成输出失败，不再拼接云失败信息。

`apps/web/src/shared/i18n/index.tsx`：

- 删除 storage 相关文案。
- 删除 generation cloud failure 文案。
- 删除 `storage_config_error` 映射。

样式：

- 删除 `apps/web/src/styles/dark.css` 中 `[data-testid="storage-dialog"]` 相关样式。
- 若其他 CSS 有 storage-dialog 或 cloud chip 选择器，也一并移除。

## 文档和规范

需要更新：

- `docs/PRODUCT_SENSE.md`：产品承诺和 Gallery 描述不再提云备份。
- `docs/RELIABILITY.md`：删除 Cloud Backup 章节，改成本地资产唯一来源。
- `docs/SECURITY.md`：删除云存储 secret 来源，保留本地资产敏感性。
- `docs/DESIGN.md`：Gallery 描述不再提 cloud upload status。
- `docs/product-specs/gallery-and-assets.md`：改为本地资产浏览和下载。
- `docs/product-specs/provider-configuration.md`：删除 Cloud Storage 小节。
- `docs/generated/db-schema.md`：删除 `assets.cloud_*` 和 `storage_configs`。
- `.trellis/spec/api/backend/*`、`.trellis/spec/shared/contracts/*`、`.trellis/spec/web/frontend/*` 中云存储相关描述需要同步，避免未来开发误读。

## 风险和回滚

主要风险：

- 删除 shared contract 后 Web/API 某处仍访问 `asset.cloud`，导致类型或运行错误。
- 删除 storage 路由后前端仍在启动时请求 `/api/storage/config`，导致控制台错误。
- 删除数据库字段定义后旧库插入/查询与 Drizzle schema 不一致。
- 删除云端回读后，只有云端存在、本地缺失的旧资产会无法读取。

回滚点：

- 如果生成链路出现本地资产保存失败，优先回滚 `image-generation.ts` 的本地保存相关改动，不恢复云逻辑。
- 如果 UI 还有入口残留，按 `rg "storage|cloud|COS|S3|R2|云存储"` 定位并清除。
- 如果旧库启动失败，检查 `database.ts` 是否仍引用已删除的 `storageConfigs` 或 `cloud*` schema 字段。

## 规划问题

推荐策略是兼容删除：代码不再用云存储，旧 SQLite 里的云字段和云配置表不主动物理删除。这样对现有用户风险最低。

用户已确认继续采用兼容删除策略。
