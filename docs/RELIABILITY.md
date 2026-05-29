# Reliability Guide

Use this before changing API routes, provider selection, Agent execution, asset storage, SQLite behavior, Docker, or operational verification.

## Runtime Shape

- `apps/api`: Hono API, WebSocket upgrade handling, SQLite persistence, provider selection, image generation, Agent planning and execution, asset storage.
- `apps/web`: Vite React and tldraw client, served by Vite in development and by the built API app in production.
- `packages/shared`：共享契约、图片预设、验证工具、提供方类型和 Agent 事件类型。

## Redis Runtime

Generation scheduling uses Redis as a required runtime dependency. Local development defaults to `REDIS_URL=redis://127.0.0.1:6379` with no password. Docker Compose runs an internal `redis` service and points the API at `redis://redis:6379`.

`GENERATION_QUEUE_DRIVER=redis` is the normal mode. If Redis is unavailable in this mode, the API must fail readiness instead of silently falling back to unbounded provider concurrency. `GENERATION_QUEUE_DRIVER=inline` is only for tests or explicit local debugging.

Redis stores runtime coordination state such as future queues, locks, attempts, and provider permits. Database tables remain the source of truth for generation records, outputs, audits, assets, and credit transactions.

`GENERATION_PROVIDER_GLOBAL_CONCURRENCY` controls the total number of in-flight image provider API calls across the app, not per generation task, user, or worker. The default is `2`. `GENERATION_PROVIDER_PERMIT_TTL_MS` controls how long a crashed provider call can hold a Redis permit before it expires; the default is `1800000` ms.

All `provider.generate` and `provider.edit` calls must go through the provider scheduler. `GENERATION_QUEUE_DRIVER=inline` uses an in-process semaphore for tests/debugging only; it does not provide cross-process global concurrency.

`GENERATION_QUEUE_WORKER_CONCURRENCY` controls how many manual generation jobs each API process consumes from Redis at once. The default is `2`. `GENERATION_QUEUE_POLL_INTERVAL_MS` controls the ready-queue polling interval; the default is `250` ms. These worker settings are not provider API concurrency limits; provider calls are still capped by `GENERATION_PROVIDER_GLOBAL_CONCURRENCY`.

Provider calls retry recoverable upstream failures before an output is marked failed. `GENERATION_PROVIDER_MAX_RETRIES` defaults to `2`, so a single output can make up to 3 provider attempts. `GENERATION_PROVIDER_RETRY_BASE_MS` defaults to `1000` ms and `GENERATION_PROVIDER_RETRY_MAX_MS` defaults to `30000` ms. Retryable failures are 429, 408, 5xx, connection timeouts, and temporary network interruptions. Missing provider/configuration, 400-level parameter/reference-image errors, and user cancellation do not retry. Each retry attempt re-enters the provider scheduler; backoff sleep does not hold a provider permit.

Agent generation jobs use the same generation queue in Redis mode when no test provider override is supplied. The Agent executor creates a pending generation record, enqueues the existing `generation:job:{generationId}` payload, waits for the database record to become terminal, and then copies outputs/status back to the Agent plan job. `AGENT_JOB_CONCURRENCY` only limits how many Agent plan jobs a single run submits or waits on at once; it is not a provider API concurrency limit.

`GENERATION_QUEUE_DRIVER=inline` and explicit provider override execution remain direct synchronous paths for tests and local debugging. Those paths still go through the provider scheduler and retry wrapper before calling the provider, but they do not provide Redis queue semantics or cross-process coordination.

## Persistence

`DATA_DIR` defaults to `./data` locally and `/app/data` in Docker. In SQLite mode it contains SQLite state, generated assets, and previews. In MySQL + OSS mode, MySQL stores metadata and OSS stores generated asset bytes; `DATA_DIR` may still hold local runtime files. Treat all of it as private runtime data.

SQLite tables are defined in `apps/api/src/infrastructure/schema.ts`; keep `docs/generated/db-schema.md` updated when the schema changes.

MySQL 通过 `USE_MYSQL=true` 显式启用。未设置或设为其他值时使用 SQLite。该模式下 API 只用 MySQL 保存用户、会话、项目、资产、生成记录和 Gallery 元数据，不读取 SQLite 数据，也不做 SQLite 到 MySQL 的迁移。MySQL 模式下图片资产主存储为 OSS，`assets.relative_path` 保存 OSS object key；SQLite 模式下该字段仍保存相对 `DATA_DIR` 的本地路径。`.env` 凭据必须保留在本机，`MYSQL_CREATE_DATABASE=true` 只用于本地初始化或受控部署；`MYSQL_CREATE_DATABASE=false` 时只自动创建缺失表，不自动创建数据库本身。MySQL 初始化会维护数据库层表注释和字段注释。

Important persistence rules:

- Never write generated assets outside the configured `DATA_DIR/assets` path or the configured OSS `root-path`.
- Validate local asset paths before reading from disk, and validate OSS object keys before signing or reading.
- Keep generation records, outputs, reference assets, and asset rows consistent.
- 积分余额变更必须在数据库事务内同时写入 `credit_transactions`。生成预扣、失败退款、注册赠送和每日签到都不能只改 `users.credits`。
- 生成请求会写入 `generation_audits`，记录请求用户、prompt、公开状态、状态、错误摘要、IP/User-Agent 摘要和输出关联。审计写入失败不应阻断 provider 调用，但成功、失败、取消和重启中断路径应尽力更新审计状态。
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
- Provider API calls are additionally guarded by the global provider scheduler, so multiple concurrent generation tasks cannot multiply the upstream provider concurrency beyond `GENERATION_PROVIDER_GLOBAL_CONCURRENCY`.
- Provider API calls use exponential backoff retry for recoverable upstream failures, and each retry attempt is still capped by the global provider scheduler.
- In Redis mode, manual image generation enters the generation queue first; the HTTP route returns after creating a pending generation record and enqueueing a Redis job.
- In Redis mode, Agent image generation also enters the generation queue unless a test provider override is supplied; the Agent plan job stays `queued` until the database generation record becomes `running` or terminal.
- Individual output failures should be represented in output status instead of erasing the whole record when partial results exist.
- 生成图片成功后必须能从当前资产存储读取；本地或 OSS 写入失败时不能记录成成功资产。
- 生成前先按 `count * generation_credit_cost` 预扣积分。全部失败按本次输出数退款，部分失败只退失败输出对应积分；退款流水按 generation id 保持幂等。

## Agent Execution

Agent plans are dependency-aware DAGs. Reliability-sensitive rules:

- Plans must be validated before execution.
- Dependency source jobs used downstream must have count `1`.
- Failed jobs can be retried without rerunning successful upstream jobs.
- Cancellation should stop in-flight work where possible and leave the plan in an inspectable state.
- WebSocket events should be stable, typed through `packages/shared`, and safe for reconnect behavior.
- Redis-mode Agent execution maps plan-layer `queued` / `running` to database-layer `pending` / `running` through `generation-scheduler-adapter.ts`. Agent cancellation should call the generation cancellation path so pending Redis jobs are removed and the database record becomes `cancelled`.

## 资产存储

SQLite 模式下，图片资产写入 `DATA_DIR/assets`，读取、预览和下载都以本地文件为来源。MySQL 模式下，图片资产写入 OSS；API 先执行 owner/admin/公开输出权限判断，再返回或重定向到 OSS GET 预签名临时 URL。服务端需要 bytes 的场景，例如参考图复用和 Gallery ZIP 导出，可以通过 API 从 OSS 读取对象。

旧 SQLite 中残留的已废弃远端备份字段或配置表只作为历史数据存在，新代码不应读取、写入或回退到旧远端备份对象。

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
