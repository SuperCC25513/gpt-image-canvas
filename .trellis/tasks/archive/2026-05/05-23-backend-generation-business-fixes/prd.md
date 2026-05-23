# 后端生成业务逻辑修复

## Goal

修复后端生成业务中的扣费、审计、状态一致性和 Agent 部分成功判定问题，让手动生成与 Agent 生成遵守同一套业务边界。

用户价值：

- 用户余额真实反映所有生成成本，不能通过 Agent 绕过扣费。
- 管理员审计能覆盖手动生成和 Agent 生成。
- 生成记录的终态、输出、资产和退款保持一致，不能出现“成功但无输出”或“失败未退款”。
- 多图 Agent 任务部分成功时保留可用资产，并把计划状态表达为部分成功，而不是整体失败。

## Confirmed Facts

- 手动生成入口在 `apps/api/src/domain/generation/generation-tasks.ts` 中先调用 `reserveGenerationCredits()`，再创建运行中记录并写生成审计。
- Agent 执行入口在 `apps/api/src/domain/agent/executor.ts` 中直接调用 `runTextToImageGeneration()` / `runReferenceImageGeneration()`，绕过手动生成任务封装。
- `completeGenerationRecord()` 当前先更新 `generation_records.status`，再替换 outputs，最后退款；这些写入不是同一事务。
- `reserveGenerationCredits()` 和 `refundGenerationCreditsForFailures()` 的幂等键只看 `related_generation_id + reason`，没有把当前用户纳入保护。
- Agent job 当前只有 `succeeded` / `failed` 等状态；多输出任务只要有失败输出，job 就标记为 `failed`。
- 用户已确认接受新增 `partial` job 状态，用于表达 Agent 多图任务部分成功。

## Requirements

- Agent 生成必须和手动生成一样预扣积分、失败退款、写入生成记录和更新生成审计。
- Agent 生成在用户余额不足时必须稳定失败，且不能调用图片 provider。
- 生成完成路径必须保证记录终态、outputs、asset metadata、退款流水一致；不能先把记录标成终态再尝试写 outputs。
- 同一个 `clientRequestId` / generation id 不能跨用户复用、读取、扣费或退款；跨用户冲突应返回稳定错误，不能影响原 owner 的余额。
- 退款幂等必须继续成立：重复失败、取消、重启中断不能重复退款。
- Agent 多输出任务部分成功时必须保留成功 output，并把 job/plan 状态表达为部分成功或至少让 plan 进入 `partial`，不能把已有成功资产当作整体失败隐藏。
- Agent job 状态契约允许新增 `partial`，并同步 shared、API planner/executor 和前端最小兼容。
- 兼容 SQLite 和 MySQL 两条后端路径。
- 保持现有 API 错误响应格式 `{ error: { code, message } }`。
- 不把 provider 原始 secret、token、本地路径或 SQL 细节暴露给客户端或日志。

## Out Of Scope

- 不调整积分价格、签到规则、注册赠送规则。
- 不改变 provider 选择顺序。
- 不重做前端 Agent 交互体验；只做修复所需的最小契约/UI 兼容。
- 不迁移旧数据库历史数据，除非修复需要新增兼容字段或索引。

## Acceptance Criteria

- [ ] 手动生成成功、全部失败、部分失败、取消、重启中断仍按现有规则扣费/退款。
- [ ] Agent 生成成功会扣除 `count * generation_credit_cost`，生成失败会按失败输出退款。
- [ ] Agent 生成会写入 `generation_audits`，管理员能在 `/api/admin/generation-requests` 看到状态和输出关联。
- [ ] 余额不足的 Agent 生成返回稳定错误事件，provider 调用次数为 0，余额和流水不变。
- [ ] 用户 B 使用用户 A 已存在的 generation id 发起生成时，不能读取 A 的记录，不能复用 A 的扣费流水，不能触发 A 的退款。
- [ ] outputs/asset 写入失败时，不会留下 `succeeded` / `partial` 的 generation record 指向缺失输出。
- [ ] Agent 多图 job 出现部分失败时，成功输出仍通过事件和记录返回，计划状态为 `partial`。
- [ ] SQLite 与 MySQL 路径均通过相关 smoke 或等效测试。
- [ ] `pnpm typecheck` 和 `pnpm build` 通过。

## Notes

- 本任务是复杂修复，必须有 `design.md` 和 `implement.md`，并在用户批准后才进入实现。
