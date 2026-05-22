# MySQL 存储底座实施计划

## Ordered Checklist

- [x] 读取 `.nvmrc`，使用 Node `24.15.0` 和 `pnpm@9.14.2`。
- [x] 新增 `mysql2` 依赖到 `apps/api`。
- [x] 新增数据库驱动配置解析，默认 `sqlite`。
- [x] 拆分现有 SQLite 初始化到独立文件，保持行为不变。
- [x] 新增 MySQL 连接池、建库和第一阶段建表逻辑。
- [x] 增加数据库关闭逻辑，SQLite 和 MySQL 都能正确释放资源。
- [x] 抽出 store facade，先覆盖项目、资产、生成记录和 Gallery。
- [x] 把 `project-store.ts`、`image-generation.ts`、`gallery.ts` 的高频直接 Drizzle 查询迁到 store facade。
- [x] 保留 provider config、Agent config、Agent conversations、Agent skills、prompt favorites 当前 SQLite 路径；MySQL 模式避免读取 SQLite，并对未接入写路径返回显式不支持。
- [x] 更新 `.env.example` 和数据库文档，不写真实密码。
- [x] 用空 `DATA_DIR` 验证 SQLite 新库仍无云存储表或字段。
- [x] 用本机未提交 `.env` 验证 MySQL 连接和建表。

## Validation Commands

```sh
nvm use 24.15.0
pnpm install
pnpm typecheck
pnpm build
pnpm dev
```

MySQL 本机验证使用未提交 `.env`：

```env
DATABASE_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<local-user>
MYSQL_PASSWORD=<local-password>
MYSQL_DATABASE=gpt_image_canvas
MYSQL_CREATE_DATABASE=true
```

浏览器验证：

- 打开 `http://localhost:5173`。
- 生成一张测试图片或使用现有可用 provider 流程。
- 检查 Gallery 能读取 MySQL 中的输出记录。
- 检查下载、预览、删除、复用仍可用。

## Risky Files

- `apps/api/src/infrastructure/database.ts`
- `apps/api/src/infrastructure/schema.ts`
- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/domain/project/project-store.ts`
- `apps/api/src/server/routes/gallery.ts`
- `apps/api/src/server/routes/assets.ts`
- `apps/api/package.json`
- `docs/generated/db-schema.md`

## Done When

- SQLite 默认路径和 MySQL 显式路径都通过核心验证。
- 没有真实数据库密码进入 Git diff。
- 没有恢复云存储表、字段、按钮或文档。
- 父任务可进入下一个子任务：用户会话与权限归属。

## 执行记录

- `pnpm install`：通过，更新 `mysql2` 依赖锁文件。
- `pnpm typecheck`：通过。
- `pnpm --filter @gpt-image-canvas/api smoke:executor`：SQLite 默认路径通过。
- `DATABASE_DRIVER=mysql` + 临时 MySQL 测试库运行 `pnpm --filter @gpt-image-canvas/api smoke:executor`：通过，测试库已清理。
- 空 `DATA_DIR` SQLite schema 检查：通过，`assets` 和表清单无 cloud/COS/S3/R2/remote/backup 项。
- `pnpm build`：通过；Vite 保留大 chunk 提示。
