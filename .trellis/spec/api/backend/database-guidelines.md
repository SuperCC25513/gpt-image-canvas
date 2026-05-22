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

## 场景：SQLite / MySQL 双驱动存储底座

### 1. 范围 / 触发

- 触发：修改数据库驱动选择、连接配置、建表逻辑、项目/资产/生成/Gallery 持久化。
- 范围：`apps/api/src/infrastructure/database-config.ts`、`sqlite-database.ts`、`mysql-database.ts`、`database.ts`，以及 `domain/storage/store.ts` 暴露的异步 store facade。

### 2. 签名

- 环境：`USE_MYSQL=true` 启用 MySQL；空值、缺失或非 true 值使用 SQLite。
- MySQL 环境：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_CONNECTION_LIMIT`、`MYSQL_CREATE_DATABASE`。
- SQLite 入口：`db` 只在 `USE_MYSQL` 未启用时可用。
- MySQL 入口：`getMySqlPool()` 只在 `USE_MYSQL=true` 时可用。
- 业务入口：项目、资产、生成记录和 Gallery 通过 `domain/storage/store.ts` 的异步函数访问。

### 3. 契约

- 默认不设置 `USE_MYSQL` 时必须保持 SQLite 行为和现有数据路径不变。
- 设置 `USE_MYSQL=true` 时不得打开或读取 SQLite 数据库；未迁到 MySQL 的旧 Drizzle store 必须返回显式不支持或空状态，不能偷偷 fallback 到 SQLite。
- MySQL 建库只在 `MYSQL_CREATE_DATABASE=true` 时执行，库名必须通过内部白名单校验后再拼接为 identifier。
- `MYSQL_CREATE_DATABASE=false` 时不自动创建数据库本身，但目标数据库已存在时必须自动创建缺失表。
- MySQL 初始化 SQL 必须维护数据库层表注释和字段注释；已有表和字段也要通过启动兼容迁移补齐注释。
- MySQL 只存元数据和 `assets/<file>` 相对路径，图片二进制仍在 `DATA_DIR/assets`。
- 两种驱动都不创建云存储表、云资产字段或远端 fallback 字段。

### 4. 验证与错误矩阵

- `USE_MYSQL=true` 且缺少 `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_DATABASE` -> 启动失败，指出缺失变量。
- `MYSQL_DATABASE` 包含非白名单字符 -> 启动失败，禁止拼接不可信 identifier。
- MySQL 连接失败 -> 启动失败，不降级读取 SQLite。
- 未迁移的 SQLite-only 写路径在 MySQL 模式被调用 -> 返回稳定错误，不访问 SQLite。

### 5. 良好 / 基线 / 错误

- 良好：`USE_MYSQL=true` 下 `smoke:executor` 能创建表、写资产元数据、写 generation records/outputs/reference assets，并读取 Gallery/history。
- 基线：空 `USE_MYSQL` 下 `pnpm typecheck`、`pnpm build` 和 SQLite smoke 行为不变。
- 错误：在 MySQL store 中直接拼用户输入 SQL、把真实 MySQL 密码写入 `.env.example`、或让 MySQL 模式打开旧 SQLite 读配置。

### 6. 必跑测试

- `pnpm typecheck`
- `pnpm build`
- SQLite：空 `DATA_DIR` 启动后检查新库无 cloud/COS/S3/R2/remote/backup 表或字段。
- MySQL：用未提交 `.env` 或 `.codex-temp` 临时 env 跑核心 smoke，断言项目/资产/生成/Gallery 写读成功。

### 7. 错误写法 vs 正确写法

错误：

```ts
// MySQL 模式下继续让 domain 直接访问 SQLite Drizzle。
const row = db.select().from(generationRecords).where(eq(generationRecords.id, id)).get();
```

正确：

```ts
// 业务层走异步 store facade，由 facade 按当前 driver 分发。
const record = await readGenerationRecord(id);
```

## 场景：用户会话与私有 owner 归属

### 1. 范围 / 触发

- 触发：修改注册登录、会话、管理员初始化、私有数据表、资产读取、生成、Gallery、Agent 会话或提示词收藏。
- 范围：`users`、`sessions`、`app_settings`，以及带 `user_id` 的项目、资产、生成记录、生成输出、Agent 会话、提示词收藏表。

### 2. 签名

- 环境：`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 必须三项同时设置或同时留空。
- Cookie：`gic_session`，`HttpOnly`、`SameSite=Lax`、`Path=/`，生产或 `COOKIE_SECURE=true` 时加 `Secure`。
- API：`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- DB：`sessions.token_hash` 只保存 SHA-256 hex；私有表用 `user_id` 表示 owner。

### 3. 契约

- 注册默认读取 `app_settings.allow_registration`、`require_approval`、`default_credits`。
- 已存在管理员邮箱时，启动只确保 `role=admin`、`status=active`，不得用 `.env` 重置密码。
- 普通用户只能读取自己的 `user_id` 数据；管理员可读取运营所需私有数据。
- 资产路由必须先判定 owner/admin，再解析和读取本地文件。
- SQLite 旧 owner 为空的数据只在管理员初始化成功后回填给管理员。
- 提示词收藏按用户去重，唯一索引必须覆盖 `user_id, source_type, source_id`。

### 4. 验证与错误矩阵

- 缺少 session 或 token 无效 -> `401 unauthorized`。
- 用户 `status=pending|disabled` -> 登录返回 `403 account_inactive`，旧 session 访问私有 API 返回 `401`。
- 管理员环境变量部分存在 -> 启动失败。
- 普通用户读取他人资产、Gallery 输出或生成记录 -> `404 not_found`。
- 不同用户收藏同一提示词池项目 -> 应各自成功，不发生唯一索引冲突。

### 5. 良好 / 基线 / 错误

- 良好：SQLite 和 MySQL 都要求登录；注册后项目、资产、生成记录和输出写入当前用户 owner。
- 基线：旧 SQLite 单用户数据在管理员存在时回填给管理员，普通新用户不可继承旧数据。
- 错误：在 MySQL 查询中遗漏 `user_id AS userId`，导致 owner 判权拿不到真实 owner；或让提示词收藏继续使用全局 `(source_type, source_id)` 唯一索引。

### 6. 必跑测试

- `pnpm typecheck`
- `pnpm build`
- SQLite smoke：未登录私有 API 为 401；注册/登录/me/退出；禁用用户旧 session 被拒绝；普通用户不可读管理员资产。
- MySQL smoke：注册/登录/me/退出；`sessions.token_hash` 为 64 位 hash；提示词收藏唯一索引为 `user_id, source_type, source_id`。
- UI smoke：`pnpm dev` 后浏览器验证未登录认证页、注册进入工作台、退出回认证页、移动视口无横向溢出。

### 7. 错误写法 vs 正确写法

错误：

```ts
const asset = await findAssetById(assetId);
const file = await getStoredAssetFile(assetId);
return new Response(file.bytes);
```

正确：

```ts
if (!(await userCanReadAsset(assetId, user))) {
  return c.json(errorResponse("not_found", "Asset not found."), 404);
}
const file = await getStoredAssetFile(assetId);
```

## 场景：积分扣费与每日签到

### 1. 范围 / 触发

- 触发：修改注册、签到、生成入口、生成完成/失败路径、应用设置或用户余额。
- 范围：`users.credits`、`app_settings` 的积分字段、`credit_transactions`、`user_checkins`、`generation_records`。

### 2. 签名

- 设置字段：`app_settings.default_credits`、`generation_credit_cost`、`checkin_credit`、`max_images_per_request`。
- 流水表：`credit_transactions(id, user_id, delta, reason, related_generation_id, related_output_id, related_checkin_date, admin_note, created_at)`。
- 签到表：`user_checkins(user_id, checkin_date, credits_awarded, created_at)`，唯一键为 `user_id + checkin_date`。
- API：`GET /api/auth/me` 返回 `settings` 和可选 `checkin`；`POST /api/checkin` 返回更新后的 `user`、`checkin` 和可选 `transaction`。
- 生成入口：`startTextToImageGenerationTask(input, user)` / `startReferenceImageGenerationTask(input, user)` 在创建 provider 前调用 `reserveGenerationCredits()`。

### 3. 契约

- 注册默认积分、每张图消耗、签到奖励和单次生成上限都从 `app_settings` 读取，缺失或非法值回退到 shared 默认值。
- 所有余额变化必须在数据库事务内同时写 `credit_transactions`，不能只更新 `users.credits`。
- 每日签到用 `user_id + checkin_date` 唯一约束保证幂等；重复签到返回当前状态，不重复加积分。
- 生成前按 `count * generation_credit_cost` 预扣。余额不足返回 `402 insufficient_credits`，不能进入 provider 调用。
- 生成全部失败、取消或服务重启中断时按本次请求全额退款；部分失败只按失败输出数退款。
- 退款流水用 `related_generation_id + reason` 保持幂等，避免重复调用失败处理导致余额重复增加。

### 4. 验证与错误矩阵

- 新注册用户获得默认积分，并有 `registration_bonus` 流水。
- 首次签到增加余额并写 `daily_checkin` 流水；重复签到余额不变。
- 积分不足时生成入口返回稳定错误码，余额和流水不变。
- 成功生成后只保留 `generation_charge` 负向流水。
- 部分失败后同时存在 `generation_charge` 和 `generation_refund`，最终余额只扣成功输出对应积分。
- SQLite 和 MySQL 两条路径都必须保持同一错误码、同一事务语义和同一幂等行为。

### 5. 良好 / 基线 / 错误

- 良好：先事务预扣，再创建运行中 generation，再调用 provider；完成后按失败输出数退款。
- 基线：`generation_credit_cost=0` 时生成不扣费也不写扣费流水，可作为运营临时关闭扣费的降级开关。
- 错误：provider 调用失败后直接把 generation 标记为 failed，但没有调用退款逻辑，导致余额永久少扣。

### 6. 必跑测试

- `pnpm typecheck`
- `pnpm build`
- MySQL smoke：注册赠送、首次/重复签到、余额不足不进入 provider、无 provider 失败全额退款。
- 域层 fake provider smoke：成功生成只扣成功数量；部分失败按失败数量退款，并检查 `credit_transactions` 流水。
- UI smoke：浏览器验证余额、签到按钮、预计消耗、积分不足提示和移动端抽屉布局。

### 7. 错误写法 vs 正确写法

错误：

```ts
await updateUserCredits(user.id, user.credits - cost);
const provider = await createConfiguredImageProvider(signal);
```

正确：

```ts
await reserveGenerationCredits(user, generationId, input.count);
const provider = await createConfiguredImageProvider(signal);
```
