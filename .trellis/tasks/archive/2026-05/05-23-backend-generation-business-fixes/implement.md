# 后端生成业务逻辑修复实施计划

## 执行顺序

1. 补测试基线
   - 扩展 `apps/api/src/smoke/agent-executor-smoke.ts` 或新增后端 smoke。
   - 覆盖 Agent 扣费、余额不足不调用 provider、审计写入、部分成功、跨用户 generation id。
   - 先让新增测试暴露当前 bug。

2. 收紧 generation id owner 边界
   - 在 storage/domain 增加 raw generation owner 查询能力。
   - 在生成启动前阻断跨用户 id 复用。
   - 在 `reserveGenerationCredits()` 校验已有 charge 的 owner。
   - 在退款函数中加入 expected user 保护，避免 catch 路径误退他人余额。

3. 抽取统一生成编排入口
   - 新增内部函数处理：预扣、running record、审计 start、provider 调用、完成提交、失败退款。
   - 手动后台任务和 Agent 执行都调用同一业务入口或共享同一核心 helper。
   - 保留手动生成 POST 立即返回 running record 的行为。

4. 原子化完成提交
   - 新增 SQLite/MySQL 双路径事务函数。
   - 事务内写 outputs、asset metadata、退款流水、record 终态。
   - record 终态最后写。
   - 审计更新放在事务成功后，失败只记录 warning，不阻断主流程。

5. 修复 Agent partial 语义
   - `GenerationJobStatus` 增加 `partial`。
   - Agent executor 按成功/失败输出数设置 job 状态。
   - plan 状态按 job partial 或成功输出计算。
   - 检查前端 switch/label 是否需要最小兼容。

6. 回归验证
   - 运行 API smoke。
   - 运行根 `pnpm typecheck` 和 `pnpm build`。
   - 检查无 secret、无本地数据、无 build 输出进入 git diff。

## 任务拆分判断

本任务暂不拆成 parent/child 子任务。四类修复都穿过同一条生成业务链路：generation id owner 边界、积分预扣/退款、完成事务提交、Agent job 状态必须在同一批改动中保持一致。拆开后每个子任务都需要依赖同一组中间接口和 smoke 基线，反而会让验收依赖隐式化。

实现阶段按本文件的 6 个顺序步骤推进，并用同一组后端 smoke 覆盖跨问题回归。

## 风险文件

- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/domain/generation/generation-tasks.ts`
- `apps/api/src/domain/credits/credit-store.ts`
- `apps/api/src/domain/storage/store.ts`
- `apps/api/src/domain/agent/executor.ts`
- `apps/api/src/domain/admin/audit-store.ts`
- `packages/shared/src/generation.ts`
- 可能涉及 `apps/web/src/features/canvas/CanvasApp.tsx` 的状态兼容

## 验证清单

- [x] 新增/更新 smoke 覆盖当前 4 个 bug。
- [x] `pnpm --filter @gpt-image-canvas/api typecheck`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:executor`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] 如改 UI 状态展示，运行 `pnpm dev` 并浏览器验证 Agent partial 状态显示。（本机 5173/8787 已有服务占用，直接打开既有 `http://127.0.0.1:5173`，确认页面可加载；Agent partial 语义由 executor smoke 覆盖。）

## 实现前检查

- 不运行 `task.py start`，直到用户批准本计划。
- 用户已确认接受新增 `partial` job 状态；实现阶段可以同步修改 shared、API planner/executor 和前端最小兼容。
- 实现时先读 `trellis-before-dev`，并按 API/backend、shared/contracts、必要时 web/frontend 规范加载对应指南。
- 保留用户已有未提交改动，不回滚与本任务无关的工作区变更。
