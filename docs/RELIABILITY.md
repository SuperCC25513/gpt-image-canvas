# Reliability Guide

Use this before changing API routes, provider selection, Agent execution, asset storage, SQLite behavior, Docker, or operational verification.

## Runtime Shape

- `apps/api`: Hono API, WebSocket upgrade handling, SQLite persistence, provider selection, image generation, Agent planning and execution, asset storage.
- `apps/web`: Vite React and tldraw client, served by Vite in development and by the built API app in production.
- `packages/shared`：共享契约、图片预设、验证工具、提供方类型和 Agent 事件类型。

## Persistence

`DATA_DIR` defaults to `./data` locally and `/app/data` in Docker. It contains SQLite state and generated assets. Treat it as private runtime data.

SQLite tables are defined in `apps/api/src/infrastructure/schema.ts`; keep `docs/generated/db-schema.md` updated when the schema changes.

MySQL 通过 `DATABASE_DRIVER=mysql` 显式启用。该模式下 API 只用 MySQL 保存用户、会话、项目、资产、生成记录和 Gallery 元数据，不读取 SQLite 数据，也不做 SQLite 到 MySQL 的迁移。生成图片文件仍保存在 `DATA_DIR/assets`，MySQL 只保存元数据和相对路径。`.env` 凭据必须保留在本机，`MYSQL_CREATE_DATABASE=true` 只用于本地初始化或受控部署。

Important persistence rules:

- Never write generated assets outside the configured data/assets path.
- Validate asset paths before reading from disk.
- Keep generation records, outputs, reference assets, and asset rows consistent.
- If changing snapshot format, preserve old project restore behavior or document migration behavior.
- SQLite 旧单用户数据只有在 `.env` 完整设置 `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 后才会回填给管理员；缺少管理员配置时，owner 为空的数据不能被普通注册用户继承。
- Do not run local `pnpm dev` and Docker against the same `data/` directory at the same time.

## Provider Reliability

Provider source order is:

1. Environment OpenAI-compatible config.
2. Local OpenAI-compatible config stored in SQLite.
3. Codex login fallback.

Agent planning uses separate Agent LLM configuration. Do not assume the image provider and planning model are the same provider.

Provider errors should become stable API errors where possible. Avoid exposing raw secrets, raw token values, or noisy upstream internals in responses or logs.

## Image Generation

- Text-to-image and reference-image generation both persist generation records.
- Reference image inputs are size and MIME checked.
- Batch generation uses bounded concurrency.
- Individual output failures should be represented in output status instead of erasing the whole record when partial results exist.
- 生成图片成功后必须能从本地资产目录读取；本地写入失败时不能记录成成功资产。

## Agent Execution

Agent plans are dependency-aware DAGs. Reliability-sensitive rules:

- Plans must be validated before execution.
- Dependency source jobs used downstream must have count `1`.
- Failed jobs can be retried without rerunning successful upstream jobs.
- Cancellation should stop in-flight work where possible and leave the plan in an inspectable state.
- WebSocket events should be stable, typed through `packages/shared`, and safe for reconnect behavior.

## 本地资产存储

图片资产只写入 `DATA_DIR/assets`，读取、预览和下载都以本地文件为唯一来源。旧 SQLite 中残留的已废弃远端备份字段或配置表只作为历史数据存在，新代码不应读取、写入或回退到远端对象。

`generation_outputs.is_public` 是唯一的公开读取开关。匿名资产读取只能在资产关联到成功且公开的输出时放行；输出删除或改回私密后，公开广场和匿名资产读取必须同步失效。

## Docker And Build Checks

For normal stories, run:

```sh
pnpm typecheck
pnpm build
```

For browser verification, run:

```sh
pnpm dev
```

Then open `http://localhost:5173`.

For Docker config validation with real `.env` credentials, use:

```sh
docker compose config --quiet --no-env-resolution
```

Do not run plain `docker compose config` when `.env` may contain real secrets.
