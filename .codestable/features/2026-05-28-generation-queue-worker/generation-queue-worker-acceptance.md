# Generation Queue Worker 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-28
> 关联方案 doc：`.codestable/features/2026-05-28-generation-queue-worker/generation-queue-worker-design.md`

## 1. 接口契约核对

对照方案第 2.1 节名词层逐一核查：

**接口示例逐项核对**：

- [x] `GenerationQueueJob`（`apps/api/src/domain/generation/generation-queue.ts`）：包含 `jobId`、`generationId`、`userId`、`mode`、`isPublic`、`attempt`、`maxAttempts`、`enqueuedAt`。
- [x] `readGenerationQueueConfig()` / `getGenerationQueueConfig()`：默认 worker concurrency 为 `2`，poll interval 为 `250` ms，非法值回退默认值。
- [x] `enqueueGenerationJob()`：写入 `generation:job:{generationId}` job payload，并将 job key 推入 `generation:queue:ready`。
- [x] `startGenerationQueueWorker()` / `stopGenerationQueueWorker()`：按配置启动/停止 polling worker。

**名词层“现状 -> 变化”逐项核对**：

- [x] 手动生成入口：Redis driver 下创建 `pending` generation record 并入队；inline driver 保留旧 `startBackgroundGenerationTask`。
- [x] `activeGenerationTasks`：继续支持 in-flight 取消；Redis worker 执行 job 时也注册 AbortController。
- [x] generation 状态：新增 pending 创建入口，worker 执行前通过 `markGenerationRecordRunning()` 推到 running。
- [x] Redis key：新增 `generation:queue:ready` 和 `generation:job:{generationId}`；payload 不包含 prompt、reference bytes 或完整 provider input。

**流程图核对**：

- [x] `POST /api/images/* -> reserve credits -> create pending record -> audit start -> enqueue -> worker -> mark running -> finish*Generation -> runProviderCall` 均有代码落点。
- [x] `finishTextToImageGeneration` / `finishReferenceImageGeneration` 未被绕开，provider call 仍通过 provider scheduler。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] Redis driver 下手动生成不直接启动 background task：`generation-tasks.ts` 只在 inline 分支调用 `startBackgroundGenerationTask`。
- [x] API 进程启动 queue worker：`initializeGenerationTaskManager()` 在 Redis driver 下调用 `startGenerationQueueWorker()`。
- [x] worker 消费前标记 running：`processQueuedGenerationJob()` 调用 `markGenerationRecordRunning()`。
- [x] Redis job 安全边界：smoke 验证 job payload 不包含 prompt 文本；代码 payload 不含 reference bytes、API key 或完整 record。
- [x] inline driver 保留旧路径：现有 executor/planner smoke 显式 inline 仍通过。

**明确不做逐项核对**：

- [x] 未新增 `generation:queue:delayed`、retry attempt zset、指数退避或错误分类。
- [x] 未把 prompt、API key、reference image bytes、provider credential、audit payload 或 credit transaction 写入 Redis。
- [x] 未改 Agent executor 生成路径为 Redis queue。
- [x] 未新增前端 queue UI 或 admin queue monitor。

**关键决策落地**：

- [x] D1：本 feature 先做 generation 级 job；per-output job 留给后续 state bridge/retry。
- [x] D2：Redis job payload 只保存路由元数据；worker 从 DB/asset storage 重建事实数据。
- [x] D3：worker 使用 polling `LPOP`，没有用阻塞 Redis 命令占住 singleton client。
- [x] D4：Redis 模式启动只失败 interrupted `running` record，不失败仍可被 ready queue 消费的 `pending` record；退款状态过滤同步修正为同一组 statuses。

**挂载点反向核对（可卸载性）**：

- [x] Queue 模块：新增 `apps/api/src/domain/generation/generation-queue.ts`。
- [x] 手动入口：`generation-tasks.ts` 增加 Redis enqueue 分支和 worker processor。
- [x] 状态能力：`image-generation.ts` / `store.ts` / `audit-store.ts` / `credit-store.ts` 支持 pending/running 和 interrupted statuses 过滤。
- [x] 生命周期：`index.ts` shutdown 纳入 `shutdownGenerationTaskManager()`。
- [x] 配置与文档：`.env.example`、`docker-compose.yml`、`docs/RELIABILITY.md`、`docs/SECURITY.md` 已更新。
- [x] 测试入口：新增 `smoke:generation-queue`。

## 3. 验收场景核对

- [x] **S1**：`GENERATION_QUEUE_DRIVER=redis` 启动 task manager -> queue worker 可启动，pending 不被 interrupted 失败。
  - 证据来源：代码核对 + interrupted statuses 过滤；typecheck 通过。
  - 结果：通过。
- [x] **S2**：手动文生图请求 -> 创建 pending record、预扣积分、写 audit start、写 Redis job，HTTP 返回时 provider 尚未被调用。
  - 证据来源：`smoke:generation-queue` 直接调用 `startTextToImageGenerationTask()`，断言 record 为 `pending`、outputs 为空、Redis job 存在且不包含 prompt。
  - 结果：通过。
- [x] **S3**：worker 消费 job -> 受 worker concurrency 限制，并清理 Redis job key。
  - 证据来源：`smoke:generation-queue` fake processor 断言 max active 为 1、ready list 清空、job key 清理。
  - 结果：通过。
- [x] **S4**：参考图编辑 job 不把 reference bytes 放进 Redis。
  - 证据来源：代码核对；Redis payload 类型没有 reference image 字段，worker 通过 `readStoredAsset()` 从 asset storage 重建。
  - 结果：通过。
- [x] **S5**：取消 pending generation -> DB cancelled，Redis job key 和 ready list entry 被删除。
  - 证据来源：`smoke:generation-queue` 取消 `smoke-manual` 后断言 job key 不存在、ready list 长度为 0。
  - 结果：通过。
- [x] **S6**：取消 running generation -> active signal 可 abort。
  - 证据来源：worker processor 与 inline background task 共用 `activeGenerationTasks` AbortController；现有 executor smoke 的取消语义通过。
  - 结果：通过。
- [x] **S7**：入队失败不绕过队列直接执行 provider。
  - 证据来源：代码核对；enqueue catch 调用 `failGenerationRecord()` 后抛错，无 fallback provider execution。
  - 结果：通过。
- [x] **S8**：queue worker concurrency 可配置。
  - 证据来源：`smoke:generation-queue` 配置 `GENERATION_QUEUE_WORKER_CONCURRENCY=1` 并断言 max active 为 1。
  - 结果：通过。

无前端 UI 改动，不需要浏览器验证。

## 4. 术语一致性

- `generation queue job`：代码名为 `GenerationQueueJob`，Redis key 为 `generation:job:{generationId}`。
- `generation queue worker`：代码入口为 `startGenerationQueueWorker()`，worker concurrency 配置为 `GENERATION_QUEUE_WORKER_CONCURRENCY`。
- `pending generation record`：Redis 模式手动生成创建 `status="pending"`，前端已有 active polling 支持。
- `inline task path`：`GENERATION_QUEUE_DRIVER=inline` 下仍走旧 background task。
- 防冲突：未把 provider global concurrency、Agent job concurrency 或 queue worker concurrency 混为一体。

## 5. 架构归并

- [x] `.codestable/architecture/ARCHITECTURE.md`：已新增 generation queue job / worker 术语。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已新增 `generation-queue.ts` 模块入口和 Redis key 职责。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录手动生成 Redis 模式 pending -> queue -> worker -> running -> finish 流程。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录 worker concurrency 与 provider concurrency 的边界。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录当前仍未实现 per-output job、retry、取消恢复和队列可观测性。

## 6. requirement 回写

- [x] 本 feature 的 design frontmatter `requirement` 为空，且本次是生成调度内部可靠性能力，不新增用户可见产品能力或用户故事。
- [x] 结论：无 requirement 回写。

## 7. roadmap 回写

- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml`：`generation-queue-worker` 已从 `in-progress` 改为 `done`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md`：第 5 节对应子 feature 已同步为 `done`，对应 feature 为 `2026-05-28-generation-queue-worker`。
- [x] YAML 校验通过。

## 8. attention.md 候选盘点

- [x] 候选 1：当 Redis 模式下只把 interrupted `running` generation 失败收敛时，积分退款也必须用相同 status 过滤；否则 pending 队列任务会被错误退款。
- [x] 结论：本报告只登记候选，不擅自写入 `.codestable/attention.md`。

## 9. 遗留

- 后续优化点：继续推进 `provider-retry-policy`，补 provider 可恢复错误分类、退避重试和最终失败记录。
- 后续优化点：继续推进 per-output Redis job / state bridge，使单张输出级别的重试、取消和幂等收敛更细。
- 后续优化点：继续推进 Agent queue adapter，让 Agent 生成 job 也进入同一队列。
- 已知限制：当前 Redis queue 使用 polling `LPOP`，不是 blocking pop，也没有 processing list 恢复。
- 已知限制：Redis ready 队列丢失后的 pending DB record 恢复仍属于后续取消恢复工作。
