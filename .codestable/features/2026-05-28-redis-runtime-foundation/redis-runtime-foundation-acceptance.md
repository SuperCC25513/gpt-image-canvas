# Redis Runtime Foundation 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-28
> 关联方案 doc：`.codestable/features/2026-05-28-redis-runtime-foundation/redis-runtime-foundation-design.md`

## 1. 接口契约核对

对照方案第 2.1 节名词层逐一核查：

**接口示例逐项核对**：

- [x] `RedisRuntimeConfig`（`apps/api/src/infrastructure/redis-runtime.ts`）：包含 `url`、`queueDriver`、`connectTimeoutMs`，与方案一致。
- [x] Redis runtime API（`apps/api/src/infrastructure/redis-runtime.ts`）：`readRedisRuntimeConfig`、`getRedisRuntimeConfig`、`redisRuntimeUsesRedis`、`getRedisClient`、`assertRedisReady`、`closeRedisClient` 已实现；实现额外提供 `checkRedisHealth` 支撑 health route，属于方案内挂载点。
- [x] `GET /api/health` 成功响应（`apps/api/src/server/routes/core.ts`）：返回 `status="ok"` 和 `checks.redis="ok"`，与方案一致。
- [x] `GET /api/health` 失败响应（`apps/api/src/server/routes/core.ts`）：Redis 不可用时返回 503、`status="unhealthy"` 和 `checks.redis="unavailable"`，与方案一致。

**名词层“现状 → 变化”逐项核对**：

- [x] API 运行时新增 Redis 基础设施：新增 `apps/api/src/infrastructure/redis-runtime.ts`，没有把 Redis env 解析散落到 generation 模块。
- [x] 外部依赖新增 Redis：`apps/api/package.json` 引入 `redis`，`pnpm-lock.yaml` 已更新。
- [x] `/api/health` 不再固定成功：改为异步 Redis 检查，并保留 `inline` 下 `checks.redis="disabled"` 的测试替身语义。
- [x] shutdown 新增 Redis 关闭：`apps/api/src/index.ts` 用 `Promise.allSettled([closeRedisClient(), closeDatabase()])` 释放 Redis socket 和数据库连接。
- [x] smoke 测试显式 inline：受影响 smoke 入口设置 `GENERATION_QUEUE_DRIVER=inline`，不强依赖本机 Redis。
- [x] `.env.example`、`docker-compose.yml` 和可靠性/安全文档新增 Redis 本地默认和安全边界。

**流程图核对**：

- [x] `API import runtime → readRedisRuntimeConfig → driver 分支 → assertRedisReady`：落点为 `redis-runtime.ts` 和 `server/app.ts`。
- [x] `GET /api/health → Redis check → 200/503`：落点为 `server/routes/core.ts` 和 `checkRedisHealth`。
- [x] `SIGINT/SIGTERM → closeRedisClient → closeDatabase`：落点为 `apps/api/src/index.ts`。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] 默认 `REDIS_URL=redis://127.0.0.1:6379`：`redis-runtime-smoke` 覆盖默认解析。
- [x] `GENERATION_QUEUE_DRIVER=redis` 且 Redis 不可用时不静默降级：手工 bad Redis 启动验证抛出已脱敏的 `RedisRuntimeError: Redis runtime is unavailable.`。
- [x] `GENERATION_QUEUE_DRIVER=inline` 不连接 Redis：`redis-runtime-smoke` 和 inline health 手工验证返回 `checks.redis="disabled"`。
- [x] shutdown 关闭 Redis：`closeRedisClient()` 被纳入进程 shutdown，smoke 覆盖重复关闭幂等。
- [x] 运行文档说明无密码 Redis 风险：`.env.example`、`docs/RELIABILITY.md`、`docs/SECURITY.md`、`docker-compose.yml` 已更新。

**明确不做逐项核对**：

- [x] 未实现 provider semaphore、queue worker、retry 或 Redis key 协议；grep 未发现新增 `generation:queue:*` 业务 key 实现。
- [x] 未把生成记录、输出、审计、积分或验证码迁移到 Redis；Redis runtime 只创建 client、PING、health 和 shutdown。
- [x] 未新增 Redis 管理 UI、监控大盘、ACL/TLS 配置生成或远程部署加固。
- [x] health 响应不包含 Redis URL、密码、主机拓扑或连接错误细节。

**关键决策落地**：

- [x] 使用 node-redis：`apps/api/package.json` 新增 `redis` 依赖。
- [x] Redis runtime 归属基础设施层：代码集中在 `apps/api/src/infrastructure/redis-runtime.ts`。
- [x] 默认 driver 是 `redis`：`parseGenerationQueueDriver` 对非 `inline` 值保守解析为 `redis`。
- [x] `/api/health` 承载 Redis 状态且不泄露配置细节：只返回 `ok` / `disabled` / `unavailable`。

**编排层“现状 → 变化”逐项核对**：

- [x] app 创建阶段加入 readiness：`createApp()` 调用 `assertRedisReady()`。
- [x] health route 改为异步 Redis 检查：`registerCoreRoutes` 中 `/api/health` 调用 `checkRedisHealth()`。
- [x] shutdown 加入 Redis 关闭：`index.ts` 引入并调用 `closeRedisClient()`。
- [x] smoke 测试显式 inline：`agent-smoke.ts`、`agent-executor-smoke.ts`、`auth-registration-domain-smoke.ts` 已设置。

**流程级约束核对**：

- [x] 错误语义：Redis failure 统一转换为 `RedisRuntimeError`，不向 health 返回底层错误。
- [x] 配置语义：空 `REDIS_URL` 回退本地默认，非法 driver 按 `redis` 处理，非法 timeout 回退 5000ms。
- [x] 幂等性：`getRedisClient()` 复用 singleton promise/client，`closeRedisClient()` 可重复调用。
- [x] 安全边界：文档明确本地无密码 Redis 不得公网暴露。
- [x] 扩展点：后续调度模块可依赖 `redis-runtime.ts` 的公开 API，不需要重新解析 env。

**挂载点反向核对（可卸载性）**：

- [x] 挂载点清单均有代码或文档落点：dependency、runtime config、启动检查、health、shutdown、smoke inline、env/Docker/docs。
- [x] 反向核查：grep `redis|REDIS_|GENERATION_QUEUE_DRIVER|checks.redis` 命中均落在设计、实现、测试或文档清单内；roadmap 中的 queue/semaphore/retry key 是规划文档，不是本 feature 代码实现。
- [x] 拔除沙盘推演：删除 `redis-runtime.ts`、package 依赖、`app.ts`/`core.ts`/`index.ts` 引用、smoke env 和 env/Docker/docs 片段后无业务代码残留；roadmap/design/acceptance 为流程记录，按 CodeStable 生命周期保留。

## 3. 验收场景核对

- [x] **S1**：未设置 `REDIS_URL` 且 `GENERATION_QUEUE_DRIVER=redis`，本地 Redis 监听 `127.0.0.1:6379` → API 可启动，`GET /api/health` 返回 200 且 `checks.redis="ok"`。
  - 证据来源：`redis-cli ping` 返回 `PONG`；手工启动 API 后 health 返回 `{"status":"ok","checks":{"redis":"ok"}}`。
  - 结果：通过。
- [x] **S2**：Redis 未运行或指向坏端口且 driver=redis → API 启动失败或 health 不健康，且不泄露 URL/密码/堆栈。
  - 证据来源：`REDIS_URL=redis://127.0.0.1:6390 REDIS_CONNECT_TIMEOUT_MS=200` 手工启动失败，错误为 `RedisRuntimeError: Redis runtime is unavailable.`。
  - 结果：通过。
- [x] **S3**：`GENERATION_QUEUE_DRIVER=inline` 且 Redis 未运行 → API 可启动，health 返回 `checks.redis="disabled"`。
  - 证据来源：inline health 手工验证返回 `{"status":"ok","checks":{"redis":"disabled"}}`。
  - 结果：通过。
- [x] **S4**：`REDIS_CONNECT_TIMEOUT_MS` 非法值 → 回退默认 5000ms，不抛出含原始 env 的错误。
  - 证据来源：`pnpm --filter @gpt-image-canvas/api smoke:redis-runtime`。
  - 结果：通过。
- [x] **S5**：重复获取和关闭 Redis client → 连接复用，关闭幂等，不留下测试进程句柄。
  - 证据来源：`redis-runtime-smoke` 覆盖重复 `closeRedisClient()`；typecheck/build 无挂起。
  - 结果：通过。
- [x] **S6**：现有 smoke 测试在没有本地 Redis 的机器上运行 → 因显式 inline driver 不发生 Redis 连接失败。
  - 证据来源：`smoke:executor`、`smoke:planner`、`auth-registration-domain-smoke` 通过；`smoke:agent` 仍有既有 WebSocket 401 边界问题，失败点与 Redis 无关。
  - 结果：Redis 相关通过；保留既有 Agent smoke 风险。
- [x] **S7**：Docker Compose 配置包含 Redis 服务和 API Redis URL。
  - 证据来源：`docker compose config --quiet --no-env-resolution` 通过。
  - 结果：通过。

## 4. 术语一致性

- Redis runtime：代码命中集中在 `apps/api/src/infrastructure/redis-runtime.ts`、启动/health/shutdown 引用和 smoke 测试，命名一致。
- queue driver：实现名为 `GENERATION_QUEUE_DRIVER` / `GenerationQueueDriver`，取值 `redis` / `inline`，与方案一致。
- 全局 provider 并发数：本 feature 未实现 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY`，仅在 roadmap/design 中说明由后续 `provider-global-semaphore` 落地，未误用于当前 runtime。
- 本地 Redis：文档和 env 均使用 `redis://127.0.0.1:6379` 或 Docker 内部 `redis://redis:6379`，与本地/compose 场景一致。
- Redis 健康检查：代码命名 `checkRedisHealth`，响应仅使用 `ok` / `disabled` / `unavailable`，与方案一致。
- 防冲突：代码中未新增 provider semaphore、queue worker、retry key 或 `generation:queue:*` 业务 Redis key 实现。

## 5. 架构归并

- [x] 架构 doc `.codestable/architecture/ARCHITECTURE.md`：已写入 Redis runtime 作为 API 基础设施依赖。
- [x] 架构 doc `.codestable/architecture/ARCHITECTURE.md`：已写入 generation-provider-scheduler 下 Redis 保存运行态、数据库保存生成事实状态的边界。
- [x] 架构 doc `.codestable/architecture/ARCHITECTURE.md`：已写入本地无密码 Redis 只允许本机或受控网络的安全边界。
- [x] 架构 doc `.codestable/architecture/ARCHITECTURE.md`：已写入 `/api/health` 的 Redis 状态检查和不泄露连接配置约束。
- [x] `.codestable/attention.md`：已有 smoke 测试 `USE_MYSQL=false` 注意事项；本 feature 的 Redis inline 测试替身已记录在 docs 和 acceptance，无需追加全局注意事项。

## 6. requirement 回写

- [x] `requirement` 为空，且本 feature 是基础设施底座，不新增用户可感能力；无 requirement 回写。

## 7. roadmap 回写

- [x] 方案 frontmatter 指向 `roadmap: generation-provider-scheduler` / `roadmap_item: redis-runtime-foundation`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml` 中 `redis-runtime-foundation` 已由 `in-progress` 改为 `done`，feature 仍指向 `2026-05-28-redis-runtime-foundation`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md` 第 5 节子 feature 清单已同步为 `done` 和对应 feature。
- [x] YAML 校验通过。

## 8. attention.md 候选盘点

- [x] 无候选：本 feature 未暴露需要补入 `.codestable/attention.md` 的新全局注意事项。Redis 本地默认、安全边界和 inline driver 语义已分别写入 `.env.example`、Docker、可靠性/安全文档和本 feature 验收记录。

## 9. 遗留

- 后续优化点：
  - `provider-global-semaphore` 仍需实现真正的全局 provider 并发闸门，限制的是整个应用同时打到唯一 provider 的请求总数。
  - `generation-queue-worker`、`provider-retry-policy`、Agent 接入、取消恢复和可观测性仍按 roadmap 推进。
- 已知限制：
  - 当前 feature 只提供 Redis runtime，不限制 provider 并发，不提供队列、重试或 worker。
  - `GENERATION_QUEUE_DRIVER=inline` 只适合测试或显式本地调试，不是生产默认。
  - 远程 Redis 的 ACL/TLS/网络隔离不在本 feature 范围内。
  - `smoke:agent` 仍出现既有 WebSocket 401 问题，非 Redis runtime 引入。
- 实现阶段“顺手发现”：
  - `apps/api/src/infrastructure` 后续如果继续增加多个 Redis 相关文件，可另起 refactor 评估是否收敛到 `infrastructure/redis/`。
