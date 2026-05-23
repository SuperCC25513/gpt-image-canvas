# 后端生成业务逻辑修复设计

## 范围

修复范围集中在 API 后端：

- `apps/api/src/domain/generation/`
- `apps/api/src/domain/credits/`
- `apps/api/src/domain/storage/`
- `apps/api/src/domain/admin/audit-store.ts`
- `apps/api/src/domain/agent/executor.ts`
- 需要契约调整时同步 `packages/shared/src/generation.ts`

## 问题一：Agent 绕过扣费和审计

### 当前路径

手动生成：

1. route 解析请求。
2. `startTextToImageGenerationTask()` / `startReferenceImageGenerationTask()`。
3. `reserveGenerationCredits()`。
4. 创建 running generation record。
5. `recordGenerationAuditStart()`。
6. 后台调用 provider。
7. finish/fail/cancel 更新记录、outputs、退款、审计。

Agent 生成：

1. WebSocket 执行已保存 plan。
2. `executeGenerationJob()` 解析 references。
3. 直接调用 `runTextToImageGeneration()` / `runReferenceImageGeneration()`。
4. 直接保存完成记录。

### 修复设计

新增一个后端内部生成编排入口，供手动后台任务和 Agent 前台执行复用：

- 输入：provider input、mode、user、provider、signal、可选 generation id、可选审计上下文。
- 行为：
  - 先校验 generation id owner 边界。
  - 预扣积分。
  - 创建 running generation record。
  - 尽力写审计 start。
  - 调用 provider 生成单张/多张。
  - 以事务提交 outputs、record 终态、退款。
  - 异常时标记 failed/cancelled 并按规则退款。

Agent 使用该入口，而不是直接调用只负责 provider+持久化的低层函数。这样 Agent 与手动生成共享扣费、审计、取消和重启中断语义。

## 问题二：生成完成写库不一致

### 当前风险

`completeGenerationRecord()` 先写 `generation_records.status`，再 `replaceGenerationOutputs()`，最后 `refundGenerationCreditsForFailures()`。

如果 outputs 或退款中途失败，记录已经是终态。后台 catch 再调用 `failGenerationRecord()` 时会因为记录已终态直接返回，不能纠正状态，也不能保证退款。

### 修复设计

把完成提交改成单个业务事务：

1. 在 provider 调用和文件保存完成后，得到内存中的 output 结果。
2. 事务内完成：
   - 删除旧 outputs。
   - 插入新 asset metadata。
   - 插入 generation outputs。
   - 按失败输出数写退款流水并更新用户余额。
   - 最后更新 generation record 的 `status`、`error`、`reference_asset_id`。
3. 事务成功后更新审计。
4. 事务失败时记录保持非成功终态；外层失败处理可安全标记 failed 并退款。

SQLite 用 `db.transaction()`；MySQL 用单连接 `beginTransaction()` / `commit()` / `rollback()`。不要把文件写入放进数据库事务；文件可先写，数据库失败时至多留下不可达孤儿文件，不能留下错误的成功记录。

## 问题三：跨用户 generation id 幂等边界

### 当前风险

`clientRequestId` 由客户端传入，后端把它作为 generation id。积分流水幂等只按 `related_generation_id + reason` 查。若用户 B 使用用户 A 的 generation id：

- 扣费可能看到 A 的 charge 后直接返回。
- 建 generation record 因主键冲突失败。
- catch 路径按 generation id 退款，可能退到 A。

### 修复设计

增加 owner 保护：

- 开始生成前读取 raw generation record：
  - 不存在：允许创建。
  - owner 是当前用户：按幂等请求处理，返回已有记录或继续已有 running。
  - owner 不是当前用户且当前用户不是 admin：返回稳定错误，不扣费、不退款、不调用 provider。
- `reserveGenerationCredits()` 读取已有 charge 时必须校验 `charge.user_id === user.id`，不匹配时报错。
- `refundGenerationCreditsForFailures()` 接收可选 `expectedUserId` 或 reservation token；退款只允许作用于本次用户的 charge。
- 唯一索引仍可保留 `related_generation_id + reason`，但业务层必须先阻断跨用户 id 冲突。

建议错误码：

- `generation_id_conflict`：同一 generation id 已属于其他用户。

## 问题四：Agent 部分成功状态

用户已确认采用 job 级 `partial` 状态。

### 当前风险

Agent job 多输出时，只要存在失败输出，job 标记为 `failed`。如果计划只有一个 job，`resolvePlanStatus()` 会返回 `failed`，成功资产虽然存在但状态表达错误。

### 修复设计

新增 `partial` job 状态：

- `packages/shared/src/generation.ts` 的 `GenerationJobStatus` 增加 `"partial"`。
- Agent executor 中：
  - 全部成功：job `succeeded`。
  - 成功数 > 0 且失败数 > 0：job `partial`。
  - 全部失败：job `failed`。
- `resolvePlanStatus()`：
  - 所有 job succeeded：`succeeded`。
  - 任一 job succeeded/partial：`partial`。
  - 任一 job cancelled 且无成功：`cancelled`。
  - 否则 `failed`。
- 事件仍发送 `job_completed` 时可带 partial outputs，或新增/复用 `job_failed` 需确保前端不会丢失成功 previews。优先保持事件兼容：成功输出继续发送 `asset_preview`，job partial 后发送 `job_completed`，`plan_updated` 中状态为 partial。

已放弃只改 plan 层 `partial` 的方案，因为它会保留 job failed 与 plan partial 的语义不一致。

## 测试策略

新增或扩展 API smoke，使用 fake provider：

- Agent 成功扣费：用户积分从 N 减少到 N-cost，存在 `generation_charge`。
- Agent 全失败退款：存在 charge 和 refund，最终余额不变。
- Agent 余额不足：返回错误，fake provider 调用次数为 0。
- Agent 审计：生成后 `generation_audits` 有对应记录和 outputs。
- 跨用户 id：用户 B 复用用户 A 的 generation id，不影响 A 的余额和流水。
- 完成事务失败：模拟 outputs 写入失败后，record 不得是 `succeeded` / `partial`。
- Agent 部分成功：job partial，plan partial，成功 output 仍可读。

验证命令：

```sh
pnpm --filter @gpt-image-canvas/api typecheck
pnpm --filter @gpt-image-canvas/api smoke:executor
pnpm typecheck
pnpm build
```

如新增 MySQL 覆盖，使用未提交 `.env` 或 `.codex-temp` 临时环境，避免输出真实凭据。

## 回滚

- 若 Agent 扣费入口出现问题，可先回滚 Agent 改造，保留手动生成修复。
- 若 shared 增加 `partial` 影响前端，可临时改为 plan 级 partial，不新增 job 状态，再单独补 UI 兼容。
- 任何数据库事务封装改动必须保持 SQLite 默认路径不变。
