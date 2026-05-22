# 数据库规范

## 运行时形态

SQLite 使用 `better-sqlite3` + Drizzle：

- 连接和启动迁移在 `apps/api/src/infrastructure/database.ts`。
- schema 定义在 `apps/api/src/infrastructure/schema.ts`。
- 数据文件路径来自 `runtimePaths.databaseFile`，默认 `./data/gpt-image-canvas.sqlite`。
- 启动时 `ensureRuntimeStorage()` 创建 `data/`、`data/assets/`、`data/asset-previews/`。

## 表结构和迁移

当前项目不用独立 migration 文件；`database.ts` 在启动时：

- `CREATE TABLE IF NOT EXISTS` 创建基础表。
- `ensureColumn(table, column, definition)` 做兼容性加列。
- `backfillGenerationReferenceAssets()` 做历史数据回填。
- `ensureProviderConfigRow()`、`ensureAgentLlmConfigRow()`、`ensurePromptFavoriteDefaultGroup()` 保证单例配置行存在。

改表时必须同步：

- `schema.ts` 的 Drizzle 表定义。
- `database.ts` 的创建 SQL 和 `ensureColumn`。
- 读写该表的 domain 函数。
- `packages/shared` 中暴露给 Web 的 request/response 类型。
- 如涉及 schema 文档，更新 `docs/generated/db-schema.md`。

## 查询和写入模式

- 使用 Drizzle query builder 做正常读写：`db.select().from(assets).where(eq(assets.id, assetId)).get()`。
- 用 `onConflictDoUpdate` 保存单例配置，例：`domain/providers/provider-config.ts`。
- 对 JSON 字段在 domain 层解析并提供 fallback，例：provider source order 解析失败时回到 `DEFAULT_PROVIDER_SOURCE_ORDER`。
- 日期统一存 ISO 字符串：`new Date().toISOString()`。
- 布尔值落 SQLite 时用 `0/1`，response 再转 boolean。

## 资产一致性

图片生成要保持四类数据一致：

- `generation_records`：总状态、参数、主参考资产。
- `generation_outputs`：每个输出成功/失败和 asset。
- `generation_reference_assets`：多参考图位置。
- `assets`：本地文件、尺寸、MIME。

参考实现：`domain/generation/image-generation.ts` 的 `createRunningGenerationRecord`、`completeGenerationRecord`、`insertGenerationOutputs`、`readGenerationRecord`。

## 文件路径安全

- 写资产只能写 `runtimePaths.dataDir/assets` 下的 `assets/<uuid>.<ext>`。
- 读资产必须走 `getStoredAssetFile()`，并用 `isInsideDirectory(filePath, runtimePaths.assetsDir)` 防目录逃逸。
- 预览缓存必须走 `domain/assets/preview.ts` 的 `safeFileSegment` 和 `isInsideDirectory`。
- 不要把绝对文件路径返回给客户端。

## 避免

- 只改 `schema.ts` 不改启动 SQL。
- 只更新 generation record，不写 outputs/reference 表。
- 在错误响应或日志中打印 SQLite 文件路径、SQL 细节、secret 字段。
- 本地 `pnpm dev` 和 Docker 共用同一个 `data/` 目录。

## 场景：本地资产为唯一存储来源

### 1. 范围 / 触发

- 触发：修改资产保存、读取、Gallery、生成记录或数据库 schema。
- 范围：`assets` 表、`generation_outputs.asset_id`、资产预览/下载路由、Web 消费的 `GeneratedAsset`。

### 2. 签名

- DB：`assets(id, file_name, relative_path, mime_type, width, height, created_at)`。
- 运行时目录：`runtimePaths.assetsDir = DATA_DIR/assets`。
- 返回契约：`GeneratedAsset` 只包含 `id`、`url`、`fileName`、`mimeType`、`width`、`height`。

### 3. 契约

- 写入：provider 返回字节后，先写入 `DATA_DIR/assets` 下的文件，再插入 `assets` 和 `generation_outputs`。
- 读取：预览、下载、原图读取只允许从 `getStoredAssetFile()` 解析出的本地路径读取。
- 兼容：旧 SQLite 中可能残留已废弃远端备份字段或配置表；新代码不得创建、读取、写入或回退使用这些旧数据。

### 4. 验证与错误矩阵

- 本地文件写入失败 -> 对应 output 失败，不插入成功 asset。
- `relative_path` 逃出 `runtimePaths.assetsDir` -> 资产不可用或 404。
- 本地文件缺失 -> 资产不可用或 404，不尝试远端兜底。
- 旧库存在额外列/表 -> 启动成功，业务忽略额外数据。

### 5. 良好 / 基线 / 错误

- 良好：新空库的 `assets` 表只有本地字段，生成成功后 Gallery 可下载本地文件。
- 基线：旧库带额外废弃字段，insert 不指定这些列，查询只读 Drizzle schema 声明字段。
- 错误：新增已废弃的远端备份字段或配置表、远端读取 fallback，或把外部对象 URL 当作资产可用性来源。

### 6. 必跑测试

- `pnpm typecheck`：确认 shared/API/Web 不再引用废弃字段。
- `pnpm build`：确认生成物不含废弃 UI 入口。
- 空 `DATA_DIR` 启动并检查 `PRAGMA table_info(assets)`：断言无废弃远端字段。
- 旧开发库启动：断言额外旧字段不阻塞 API 启动。

### 7. 错误写法 vs 正确写法

错误：

```ts
await db.insert(assets).values({ id, relativePath, cloudStatus: "failed" });
```

正确：

```ts
await db.insert(assets).values({ id, fileName, relativePath, mimeType, width, height, createdAt });
```
