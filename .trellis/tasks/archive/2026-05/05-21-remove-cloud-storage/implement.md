# 移除云存储功能执行计划

## 执行原则

- 先删 shared 契约，再让类型错误暴露所有跨层使用点。
- 先移 UI 入口和 API route，避免半删状态继续调用云配置接口。
- 保留本地资产读写路径，任何时候都不把生成成功依赖外部存储。
- 旧数据库只做忽略兼容，不做破坏性 drop。
- 每一阶段完成后用 `rg` 查残留，不靠记忆判断。

## 实施顺序

### 1. Shared 契约收口

- [x] 修改 `packages/shared/src/generation.ts`，删除 `GeneratedAsset.cloud` 和 `GeneratedAssetCloudInfo`。
- [x] 修改 `packages/shared/src/image.ts`，删除云存储 provider/status 类型。
- [x] 删除 `packages/shared/src/storage.ts`。
- [x] 修改 `packages/shared/src/index.ts`，移除 storage 导出。
- [x] 修改 `apps/api/src/domain/contracts.ts`，移除 storage 类型 re-export。
- [x] 运行 `pnpm --filter @gpt-image-canvas/shared typecheck`，记录预期下游错误。

### 2. API 路由和配置删除

- [x] 修改 `apps/api/src/server/app.ts`，删除 `registerStorageRoutes` 导入和调用。
- [x] 删除 `apps/api/src/server/routes/storage.ts`。
- [x] 删除 `apps/api/src/domain/storage/storage-config.ts`。
- [x] 修改 `apps/api/src/server/http/validation.ts`，删除 storage config parser。
- [x] 用 `rg "StorageConfig|SaveStorage|parseStorage|/api/storage|storage-config"` 检查 API 残留。

### 3. 本地资产链路瘦身

- [x] 修改 `apps/api/src/infrastructure/storage/asset-storage.ts`，只保留本地读写删除适配器。
- [x] 修改 `apps/api/src/domain/generation/image-generation.ts`：
  - [x] 删除云适配器和 `getActiveCloudStorageConfig` 导入。
  - [x] 删除 cloud storage record 类型和 helper。
  - [x] 保存生成图片时只写本地文件。
  - [x] 插入 asset 时只写本地字段。
  - [x] 读取 asset 时只读本地文件。
  - [x] 返回 `GeneratedAsset` 时不含 cloud。
- [x] 修改 `apps/api/src/domain/project/project-store.ts`，`toGeneratedAsset()` 不再读 cloud 字段。
- [x] 修改 `apps/api/src/domain/agent/executor.ts` 和 smoke 中复制 asset 的位置，删除 cloud 拷贝。
- [x] 用 `rg "cloud|Cloud|cloudProvider|cloudStatus|getActiveCloudStorageConfig|saveAssetToConfiguredCloud|readCloudAsset"` 检查 API 残留。

### 4. 数据库 schema 和启动迁移

- [x] 修改 `apps/api/src/infrastructure/schema.ts`，删除 `assets.cloud*` 字段和 `storageConfigs` 表。
- [x] 修改 `apps/api/src/infrastructure/database.ts`：
  - [x] 新建 `assets` 表 SQL 不再含 `cloud_*` 字段。
  - [x] 不再创建 `storage_configs` 表。
  - [x] 删除 cloud/storage `ensureColumn`。
  - [x] 删除 `migrateStorageConfigRows()` 和关联类型。
- [x] 不写 DROP 语句，旧字段和旧表自然保留。
- [x] 更新 `docs/generated/db-schema.md`。

### 5. Web UI 删除

- [x] 修改 `apps/web/src/features/canvas/CanvasApp.tsx`：
  - [x] 删除 storage form 类型、默认值、state、effect、handler。
  - [x] 删除 `/api/storage/config` 和 `/api/storage/config/test` 请求。
  - [x] 删除云存储按钮和弹窗。
  - [x] 删除云失败计数和历史记录云状态。
  - [x] 调整生成 warning，只保留本地生成输出失败。
- [x] 修改 `apps/web/src/shared/i18n/index.tsx`，删除 storage 和 cloud failure 文案。
- [x] 修改 `apps/web/src/styles/dark.css`，删除 storage dialog 样式。
- [x] 用 `rg "storage|Storage|cloud|Cloud|COS|S3|R2|云存储|云端"` 检查 Web 残留；保留非云语义的 `localStorage`。

### 6. 依赖和文档

- [x] 从 `apps/api/package.json` 删除 `@aws-sdk/client-s3`、`cos-nodejs-sdk-v5`。
- [x] 运行 `pnpm install` 更新 `pnpm-lock.yaml`。
- [x] 更新产品、可靠性、安全、设计、Gallery/Provider 文档。
- [x] 更新 `.trellis/spec` 中云存储相关规范，记录移除后的本地资产规则。

### 7. 验证

- [x] `pnpm --filter @gpt-image-canvas/shared typecheck`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm dev`
- [x] 浏览器桌面视口检查：
  - [x] 生成面板不显示云存储按钮。
  - [x] 生成历史不显示云失败标记。
  - [x] Gallery 能加载，预览/下载/删除/复用等操作入口可见。
  - [x] Provider/Agent 配置仍可打开。
- [x] 浏览器移动视口检查：
  - [x] 面板布局无重叠。
  - [x] Gallery 卡片和操作按钮可读可点。
- [x] 新库启动检查：临时空 `DATA_DIR` 下启动，确认不创建 `storage_configs` 和 `cloud_*` 字段。
- [x] 旧库兼容检查：使用已有开发库启动，确认残留旧字段不导致失败。

浏览器备注：已按用户要求启动 `pnpm dev` 后使用内置 Browser 验证 `http://127.0.0.1:5173`。桌面和 390px 移动视口均确认无云存储入口、无云存储文案，Gallery 可加载，操作入口可见，移动端无页面级横向溢出。未实际执行删除/下载这类会改变本地状态或触发下载的操作。

## 关键残留检查命令

```sh
rg "api/storage|StorageConfig|SaveStorage|storage_configs|cloud_provider|cloud_status|getActiveCloudStorageConfig|CosAsset|S3Compatible|cos-nodejs|client-s3" apps packages docs .trellis/spec
rg "云存储|云端双写|腾讯云 COS|Cloudflare R2|S3-compatible|cloud upload|Cloud backup" apps packages docs .trellis/spec
```

允许残留：

- 用户请求记录或历史任务文档中的描述。
- `localStorage`，它是浏览器本地存储，不属于云存储。
- 外部依赖锁文件中与其他依赖无关的 `s3` 字符串，需逐条判断。

## 启动前检查门

实现开始前需要用户确认兼容策略：

- 推荐：不 drop 旧 SQLite 字段和旧 `storage_configs` 表，只让新代码不再创建、不再读写。
- 替代：物理清理旧库字段和表，代价是 SQLite 迁移复杂度更高，回滚和数据风险更大。

已确认：采用推荐的兼容删除策略。
