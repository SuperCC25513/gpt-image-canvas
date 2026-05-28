---
doc_type: roadmap
slug: generation-provider-scheduler
status: active
created: 2026-05-28
last_reviewed: 2026-05-28
tags: [generation, provider, redis, queue, retry]
related_requirements: []
related_architecture: [ARCHITECTURE]
---

# 生成 Provider 调度与队列

## 1. 背景

当前图片生成没有全局 provider 并发闸门。手动生成时，每个生成任务内部最多 2 个 provider 调用并发；如果同时有 100 个任务、每个任务 16 张图，当前代码会让唯一 provider 面对最多 200 个并发调用和总计 1600 次单图调用。只有 1 个 provider 时，这会把上游限流、超时和失败风险直接放大给用户。

本 roadmap 规划一层 Redis 驱动的生成调度能力：所有图片 provider 调用统一进入全局并发闸门，生成请求进入队列，provider 可恢复错误按统一策略重试，手动生成和 Agent 生成共享同一套运行时约束。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- Redis runtime 基础设施、配置解析和健康检查。
- 全局 provider 并发闸门，覆盖手动文生图、参考图编辑和 Agent 执行。
- Redis 队列和 worker，避免 HTTP 请求直接启动大量进程内后台任务。
- provider 调用错误分类、退避重试和最终失败记录。
- DB 事实状态与 Redis 运行态的边界：数据库保存生成记录、输出、审计和积分流水；Redis 保存队列、锁、attempt 和短期运行状态。
- 取消、重启恢复、退款幂等和基础可观测性。

### 明确不做

- 不做多 provider 负载均衡、权重路由或自动 provider failover；只有一个 provider 也必须稳定工作。
- 不改积分定价、单次最大图片数和注册赠送规则。
- 不把生成记录、输出资产、审计或积分事实迁移到 Redis。
- 不做完整后台监控大盘；只规划最小可用的队列状态和错误摘要。
- 不处理注册邮箱验证码存储；邮箱验证码属于 `registration-email-verification` feature。
- 不做公开互联网部署加固。远程 Redis、TLS、ACL 和网络隔离属于部署安全工作。

## 3. 模块拆分（概设）

```text
generation-provider-scheduler
├── redis-runtime：Redis client、配置、健康检查和本地默认连接
├── provider-scheduler：所有 provider.generate/edit 的全局并发入口
├── generation-queue：生成输出任务排队、worker 消费和运行态维护
├── retry-policy：provider 错误分类、退避、最大重试和失败收敛
├── generation-state-bridge：DB 事实状态与 Redis 运行态同步
└── agent-adapter：Agent 执行接入同一调度层
```

### redis-runtime · Redis 运行时

- **职责**：创建 Redis client，解析连接配置，提供健康检查和测试替身入口。
- **承载的子 feature**：`redis-runtime-foundation`
- **触碰的现有代码 / 模块**：API 启动配置、Docker/env 文档、测试环境配置。

### provider-scheduler · 全局 provider 并发闸门

- **职责**：把 provider call 包装成可限流执行单元，保证所有进程共享同一组 Redis permit。
- **承载的子 feature**：`provider-global-semaphore`
- **触碰的现有代码 / 模块**：`apps/api/src/domain/generation/image-generation.ts`、provider 调用点、Agent 执行调用点。

### generation-queue · 生成队列与 worker

- **职责**：接收 generation record 拆出的 output job，按队列顺序交给 worker 执行，避免请求入口直接启动大量后台任务。
- **承载的子 feature**：`generation-queue-worker`
- **触碰的现有代码 / 模块**：`apps/api/src/domain/generation/generation-tasks.ts`、图片 API route、生成记录读取/取消路径。

### retry-policy · 重试策略

- **职责**：把 provider 错误分类为可重试和不可重试，执行指数退避，最终失败时写入稳定错误摘要。
- **承载的子 feature**：`provider-retry-policy`
- **触碰的现有代码 / 模块**：provider error 转换、生成输出失败处理、审计错误摘要。

### generation-state-bridge · 状态桥

- **职责**：维护 `generation_records`、`generation_outputs`、`generation_audits`、积分退款与 Redis 运行态之间的一致性边界。
- **承载的子 feature**：`generation-cancel-and-recovery`
- **触碰的现有代码 / 模块**：storage store、credit store、audit store、启动恢复逻辑。

### agent-adapter · Agent 接入

- **职责**：让 Agent job 不再绕过队列和全局闸门，保持 plan DAG 语义和重试/取消事件可理解。
- **承载的子 feature**：`agent-generation-scheduler-adapter`
- **触碰的现有代码 / 模块**：`apps/api/src/domain/agent/executor.ts`、Agent WebSocket events、Agent smoke tests。

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 Redis runtime 配置

**方向**：API 启动配置 → redis-runtime

**形式**：环境变量 + runtime helper

**契约**：

```ts
interface RedisRuntimeConfig {
  url: string;
  queueDriver: "redis" | "inline";
  connectTimeoutMs: number;
}

function readRedisRuntimeConfig(env: NodeJS.ProcessEnv): RedisRuntimeConfig;
function getRedisClient(): RedisClient;
async function assertRedisReady(): Promise<void>;
```

**配置字段**：

```text
REDIS_URL=redis://127.0.0.1:6379
GENERATION_QUEUE_DRIVER=redis
REDIS_CONNECT_TIMEOUT_MS=5000
```

**约束**：

- 本地默认 Redis 使用 `redis://127.0.0.1:6379`，无密码。
- `REDIS_URL` 未设置时，本地开发默认使用 `redis://127.0.0.1:6379`。
- `GENERATION_QUEUE_DRIVER=redis` 时 Redis 不可用必须让 API 启动失败或健康检查失败，不能静默退回无限并发。
- `GENERATION_QUEUE_DRIVER=inline` 只允许测试和显式本地调试使用；生产和 Docker 默认不应使用 inline。
- 文档必须明确：无密码 Redis 只能绑定本机或受控内网，不得暴露到公网。

### 4.2 provider 调度入口

**方向**：generation / Agent → provider-scheduler → image provider

**形式**：函数调用

**契约**：

```ts
type ProviderCallMode = "generate" | "edit";

interface ProviderCallInput<T> {
  generationId: string;
  outputId: string;
  outputIndex: number;
  mode: ProviderCallMode;
  signal?: AbortSignal;
  call: (signal?: AbortSignal) => Promise<T>;
}

interface ProviderScheduler {
  runProviderCall<T>(input: ProviderCallInput<T>): Promise<T>;
}
```

**配置字段**：

```text
GENERATION_PROVIDER_GLOBAL_CONCURRENCY=2
GENERATION_PROVIDER_PERMIT_TTL_MS=1800000
```

**约束**：

- 所有 `provider.generate` 和 `provider.edit` 必须通过 `ProviderScheduler.runProviderCall`。
- `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 限制的是整个 API 运行集群同一时刻打到当前图片 provider 的总请求数，不是单个任务、单个用户或单个 worker 的并发数。
- 并发闸门按 provider call 计数，不按 generation record 计数；只有 1 个 provider 时，所有手动生成和 Agent 生成共享同一组全局 permit。
- 一个 `count=16` 的任务会拆成 16 个 output call；即使同时有 100 个任务，全局同时发往 provider 的 output call 也不得超过 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY`。
- 本 roadmap 不做多 provider 负载均衡；未来如果有多个 provider，默认仍先按全局总量限制，除非另起设计明确 provider 级别限额。
- permit 必须有 TTL，worker 崩溃后不能永久占用并发槽。
- provider call 完成、失败或取消后必须释放 permit；释放动作要幂等。

### 4.3 generation queue job

**方向**：generation-task API → generation-queue → worker

**形式**：Redis 队列任务

**契约**：

```ts
interface GenerationQueueJob {
  generationId: string;
  userId: string;
  mode: "generate" | "edit";
  outputId: string;
  outputIndex: number;
  attempt: number;
  maxAttempts: number;
  enqueuedAt: string;
}
```

**Redis key 前缀**：

```text
generation:queue:ready
generation:queue:delayed
generation:job:{generationId}:{outputIndex}
generation:lock:provider:{permitId}
generation:attempt:{generationId}:{outputIndex}
generation:cancelled:{generationId}
```

**约束**：

- Redis job 不保存完整 prompt、API key、reference image bytes 或 provider credential。
- worker 执行前必须从 DB 重新读取 generation record、owner 和 reference asset 信息。
- DB 是事实来源；Redis 丢失时可以把非终态 generation 标记为 failed/interrupted，不能凭 Redis 恢复事实数据。
- output job 的 `outputId` 必须稳定，便于失败退款、审计输出摘要和幂等写入。

### 4.4 生成状态协议

**方向**：generation-state-bridge ↔ storage / API / Web

**形式**：共享状态语义

**契约**：

```text
pending   = 已创建 generation record，输出任务已入队或等待入队
running   = 至少一个输出任务正在执行 provider call 或保存资产
succeeded = 全部输出成功
partial   = 至少一个输出成功且至少一个输出失败/取消
failed    = 无成功输出且已无可重试任务
cancelled = 用户取消，未开始输出不再执行，已开始输出尽力 abort
```

**约束**：

- `generation_records` 继续保存整体状态；`generation_outputs` 保存单张输出结果。
- 失败退款仍以失败输出数为准，退款流水必须按 generation id 幂等。
- audit start 不应阻断入队；audit success/failure/cancel 要尽力更新。
- 用户读取 `/api/generations/:id` 时必须能看到稳定状态，不需要读取 Redis 才能理解终态。

### 4.5 provider 重试策略

**方向**：provider-scheduler → retry-policy

**形式**：错误分类函数 + 退避配置

**契约**：

```ts
type ProviderRetryDecision =
  | { retry: true; delayMs: number; reason: string }
  | { retry: false; reason: string };

function classifyProviderRetry(error: unknown, attempt: number, maxAttempts: number): ProviderRetryDecision;
```

**配置字段**：

```text
GENERATION_PROVIDER_MAX_RETRIES=2
GENERATION_PROVIDER_RETRY_BASE_MS=1000
GENERATION_PROVIDER_RETRY_MAX_MS=30000
```

**约束**：

- 可重试：429、408、5xx、连接超时、临时网络中断。
- 不可重试：缺少 provider、缺少 API key、400 参数错误、参考图非法、用户取消。
- 重试使用指数退避和 jitter。
- 达到最大次数后写 output failed，并把错误摘要稳定化，不把上游原始敏感错误透给客户端。

### 4.6 Agent 接入协议

**方向**：agent-adapter → generation-queue / provider-scheduler

**形式**：函数调用 + Agent event

**契约**：

```ts
interface ScheduledAgentGenerationInput {
  runId: string;
  jobId: string;
  generationId: string;
  userId: string;
  signal?: AbortSignal;
}
```

**约束**：

- Agent 的 DAG 依赖规则不变；依赖满足后才能入队对应 generation。
- Agent 不再通过自身 job 并发叠加 provider 并发；provider 并发只由全局闸门决定。
- Agent UI 至少能区分 `queued`、`running`、`retrying`、`failed`、`cancelled` 语义；如果共享契约暂不加 `retrying` 状态，则用事件 message/metadata 表达重试中。
- retry_failed 只重跑失败 job，不重跑已成功上游 job。

## 5. 子 feature 清单

1. **redis-runtime-foundation** — 接入 Redis runtime、配置、健康检查和部署文档。
   - 所属模块：redis-runtime
   - 依赖：无
   - 状态：done
   - 对应 feature：`2026-05-28-redis-runtime-foundation`
   - 备注：本地默认 `redis://127.0.0.1:6379`，无密码；Redis 已成为生成调度的运行依赖。
2. **provider-global-semaphore** — 所有图片 provider 调用共用 Redis 全局并发闸门。
   - 所属模块：provider-scheduler
   - 依赖：`redis-runtime-foundation`
   - 状态：done
   - 对应 feature：`2026-05-28-provider-global-semaphore`
   - 备注：所有 `provider.generate` / `provider.edit` 单图调用已通过 `runProviderCall` 进入全局闸门；并发值由 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 配置。
3. **generation-queue-worker** — 手动生成任务进入 Redis 队列，由 worker 消费输出任务。
   - 所属模块：generation-queue、generation-state-bridge
   - 依赖：`provider-global-semaphore`
   - 状态：planned
   - 对应 feature：未启动
4. **provider-retry-policy** — 增加 provider 可恢复错误分类、退避重试和最终失败记录。
   - 所属模块：retry-policy、generation-state-bridge
   - 依赖：`generation-queue-worker`
   - 状态：planned
   - 对应 feature：未启动
5. **agent-generation-scheduler-adapter** — Agent 生成 job 接入同一队列、闸门和重试机制。
   - 所属模块：agent-adapter、generation-queue、provider-scheduler
   - 依赖：`provider-retry-policy`
   - 状态：planned
   - 对应 feature：未启动
6. **generation-cancel-and-recovery** — 完善队列取消、重启恢复、失败收敛和退款幂等。
   - 所属模块：generation-state-bridge、generation-queue
   - 依赖：`generation-queue-worker`、`provider-retry-policy`
   - 状态：planned
   - 对应 feature：未启动
7. **generation-queue-observability** — 暴露排队、运行、重试、失败摘要给 API、前端和审计。
   - 所属模块：generation-state-bridge、agent-adapter
   - 依赖：`generation-cancel-and-recovery`、`agent-generation-scheduler-adapter`
   - 状态：planned
   - 对应 feature：未启动

**最小闭环**：第 2 条 `provider-global-semaphore` 做完后，现有手动生成仍能端到端完成，同时 100 个任务也只能按 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 设定的总并发数向唯一 provider 发请求。

## 6. 排期思路

先做 Redis runtime，因为后续所有调度能力都依赖同一连接、配置和健康检查。第二步做全局 semaphore，形成最小闭环：不重写队列也能先把唯一 provider 的并发打到配置值以内。第三步再把手动生成改成 queue worker，解决 HTTP 请求直接启动大量后台任务的问题。重试策略要在队列后落地，因为 delayed retry 需要队列承载。Agent 接入放在手动生成稳定之后，避免两条执行路径同时重构。取消、恢复和可观测性最后补齐运行体验和一致性。

## 7. 观察项

- 当前 `.codestable/architecture/ARCHITECTURE.md` 主要记录注册相关架构，缺少 generation / provider / Agent runtime 的结构化 backfill；本 roadmap 不顺手修改 architecture。
- 当前探索文档 `.codestable/compound/2026-05-28-explore-image-generation-concurrency.md` 已确认没有全局 provider 闸门，是本 roadmap 的主要证据输入。
- 本地无密码 Redis 只能作为本机开发默认值；如果未来支持远程部署，应单独补安全部署约束。
