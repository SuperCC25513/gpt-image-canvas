# 全局 provider 并发闸门验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-28
> 关联方案 doc：`.codestable/features/2026-05-28-provider-global-semaphore/provider-global-semaphore-design.md`

## 1. 接口契约核对

对照方案第 2.1 节名词层逐一核查：

**接口示例逐项核对**：

- [x] `ProviderSchedulerConfig`（`apps/api/src/domain/generation/provider-scheduler.ts`）：包含 `globalConcurrency` 与 `permitTtlMs`，默认值分别为 `2` 和 `1800000`。
- [x] `ProviderCallInput<T>`（`apps/api/src/domain/generation/provider-scheduler.ts`）：包含 `generationId`、`outputId`、`outputIndex`、`mode`、`signal` 与 `call`，并由 `runProviderCall()` 统一执行。
- [x] `readProviderSchedulerConfig()` / `getProviderSchedulerConfig()` / `runProviderCall()`：配置解析、运行期配置读取和 provider call 包装入口均已落地。

**名词层“现状 -> 变化”逐项核对**：

- [x] `provider.generate({ count: 1 })`：实际调用仍在 `generateSingleOutput()`，但已包进 `runProviderCall()`。
- [x] `provider.edit({ count: 1 })`：实际调用仍在 `editSingleOutput()`，但已包进 `runProviderCall()`。
- [x] `BATCH_CONCURRENCY=2`：保持原单任务 fan-out，不作为全局 provider 并发限制。
- [x] Redis key：`generation:provider:permits` 已在 scheduler 中定义；member 使用随机 permit id，不包含 prompt、API key、reference bytes、generation id、output id 或用户输入。

**流程图核对**：

- [x] `finishText/ReferenceImageGeneration -> mapWithConcurrency -> generateSingleOutput/editSingleOutput -> runProviderCall -> provider.generate/edit -> finally release` 在 `image-generation.ts` 与 `provider-scheduler.ts` 中均有实际落点。
- [x] Redis driver 使用 Lua 脚本完成清理过期 permit、计数、写入 permit 和 key TTL 设置；inline driver 使用进程内计数器。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 默认 2 且可配置：`readProviderSchedulerConfig({})` 与 smoke 覆盖默认值；Redis smoke 通过显式配置 `1` 验证运行期并发限制。
- [x] `GENERATION_QUEUE_DRIVER=redis`：provider call 先执行 Redis acquire，Redis 命令失败会转成 `ProviderSchedulerError`，不会绕过闸门。
- [x] `GENERATION_QUEUE_DRIVER=inline`：使用进程内 semaphore，可在无 Redis 的 smoke 中验证排队和释放。
- [x] 手动生成和 Agent 路径：Agent 仍通过 `generation-tasks.ts` 回到 `finishTextToImageGeneration()` / `finishReferenceImageGeneration()`，因此共享 `runProviderCall()`。
- [x] 完成、失败、取消释放：provider call 包在 `try/finally` 中，释放失败只记录 warning，不改变 provider 结果收敛。

**明确不做逐项核对**：

- [x] 未新增 `generation:queue:*` ready/delayed/job 队列实现。
- [x] 未新增 provider retry、指数退避、错误分类或 delayed retry key。
- [x] 未把 prompt、API key、reference image bytes、generation record、audit 或 credit transaction 写入 Redis permit。
- [x] 未新增前端 queue UI、admin monitor 或 provider 状态面板。

**关键决策落地**：

- [x] D1：scheduler 放在 `apps/api/src/domain/generation/provider-scheduler.ts`，Redis client 仍通过 `redis-runtime.ts` 取得。
- [x] D2：Redis semaphore 使用 sorted set + Lua 脚本，避免多进程竞态超发。
- [x] D3：permit TTL 默认 30 分钟，可由 `GENERATION_PROVIDER_PERMIT_TTL_MS` 配置。
- [x] D4：无 permit 时等待轮询，保持当前请求 / 后台任务模型下的最小排队语义。

**挂载点反向核对（可卸载性）**：

- [x] Provider scheduler 模块：新增 `apps/api/src/domain/generation/provider-scheduler.ts`。
- [x] Provider call 接入：`image-generation.ts` 只有两个 `provider.generate/edit` 命中，均在 `runProviderCall()` 的 `call` 闭包内。
- [x] 运行配置：`.env.example`、`docker-compose.yml`、`docs/RELIABILITY.md`、`docs/SECURITY.md` 已更新。
- [x] 测试入口：`apps/api/src/smoke/provider-scheduler-smoke.ts` 与 `smoke:provider-scheduler` 脚本已新增。
- [x] 拔除沙盘推演：移除 scheduler 文件、`image-generation.ts` import/包装调用、env/docs/smoke 挂载点即可回退本 feature；没有发现清单外代码入口。

## 3. 验收场景核对

- [x] **S1**：未设置 provider scheduler 并发 env，`GENERATION_QUEUE_DRIVER=inline` -> `runProviderCall` 默认最多 2 个并发，5 个任务排队完成。
  - 证据来源：`smoke:provider-scheduler` 默认运行期并发场景。
  - 结果：通过。
- [x] **S2**：设置 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY=1` -> 同时触发多个 provider call 时只有 1 个进入 fake provider。
  - 证据来源：Redis 模式 smoke 显式配置并发 1。
  - 结果：通过。
- [x] **S3**：provider call 抛错 -> permit 在 `finally` 中释放，后续 call 能继续获得 permit。
  - 证据来源：provider scheduler smoke 的 failure release 场景。
  - 结果：通过。
- [x] **S4**：等待 permit 时 `AbortSignal` 取消 -> 抛 `AbortError`，不进入 provider。
  - 证据来源：provider scheduler smoke 的 abort waiting 场景。
  - 结果：通过。
- [x] **S5**：`GENERATION_QUEUE_DRIVER=redis` 且 Redis 可用 -> 并发不超过配置值，完成后 Redis permit key 无残留。
  - 证据来源：Redis 模式 provider scheduler smoke + `redis-cli zcard generation:provider:permits`。
  - 结果：通过。
- [x] **S6**：手动文生图、参考图编辑和 Agent 生成路径都通过同一个 scheduler。
  - 证据来源：`rg -n "provider\\.(generate|edit)\\(" apps/api/src` 仅命中 `image-generation.ts` 两个已包装调用点；Agent executor 经 generation tasks 回到 finish 流程。
  - 结果：通过。
- [x] **S7**：100 个任务每个 16 张时仍会创建 1600 个 output call，但同时进入 provider API 的 call 数由 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 限制。
  - 证据来源：scheduler 包住每个单图 provider call，所有路径共用 Redis permit key；smoke 验证并发上限语义。
  - 结果：通过。

无前端改动，不需要浏览器验证。

## 4. 术语一致性

- `provider call`：代码中落到 `runProviderCall()`，语义为一次 `provider.generate/edit count=1`。
- `全局 provider 并发闸门`：配置名使用 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY`，文档明确它不是单任务、单用户或 worker 并发。
- `provider permit`：Redis member 为随机 permit id，TTL 分数保存在 sorted set score。
- `inline scheduler`：仅在 `GENERATION_QUEUE_DRIVER=inline` 下使用进程内 semaphore，文档明确不提供跨进程保证。
- 防冲突：`BATCH_CONCURRENCY` 未被改造成全局闸门；未新增 `generation:queue:*` 队列或 retry key。

## 5. 架构归并

- [x] `.codestable/architecture/ARCHITECTURE.md`：已把 Redis runtime 从“只支撑后续调度”更新为支撑当前 provider permit 和后续队列 / 重试运行态。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已新增 Provider scheduler 模块入口，说明 `runProviderCall()`、Redis Lua acquire、inline semaphore 和配置字段。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 限制整个应用 / API 运行集群打到当前 provider 的总并发，不是单任务、单用户或 worker 并发。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录 Redis permit 只保存短期随机 id 和 expiry score，数据库仍是生成记录、输出、审计、资产和积分流水的事实来源。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录当前未完成的 generation queue worker、retry policy、取消恢复和可观测性边界。

## 6. requirement 回写

- [x] 本 feature 的 design frontmatter `requirement` 为空，且本次是生成调度内部可靠性能力，不新增用户可见产品能力或用户故事。
- [x] 结论：无 requirement 回写。

## 7. roadmap 回写

- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml`：`provider-global-semaphore` 已从 `in-progress` 改为 `done`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md`：第 5 节对应子 feature 已同步为 `done`，对应 feature 为 `2026-05-28-provider-global-semaphore`。
- [x] YAML 校验通过。

## 8. attention.md 候选盘点

- [x] 候选 1：node-redis client 复用应以 `isReady` 为准，不能只看 `isOpen`；并发 Redis acquire 下，未 ready 的 client 可能触发 `ClientOfflineError`。
- [x] 结论：本报告只登记候选，不擅自写入 `.codestable/attention.md`。

## 9. 遗留

- 后续优化点：继续推进 `generation-queue-worker`，让手动生成进入 Redis 队列并由 worker 消费。
- 后续优化点：继续推进 `provider-retry-policy`，补 provider 可恢复错误分类、退避重试和最终失败记录。
- 后续优化点：继续推进取消恢复、失败收敛、退款幂等和队列可观测性。
- 已知限制：当前最小排队是 provider call 前等待 permit；还不是持久化 Redis job 队列。
- 已知限制：`GENERATION_QUEUE_DRIVER=inline` 只限制当前进程，不提供跨进程全局保证。
