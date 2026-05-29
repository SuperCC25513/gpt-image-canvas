# Generation Queue Observability 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-29
> 关联方案 doc：.codestable/features/2026-05-29-generation-queue-observability/generation-queue-observability-design.md

## 1. 接口契约核对

对照方案第 2.1 节名词层逐一核查：

**接口示例逐项核对**：

- [x] `AdminGenerationQueueStatusResponse`（`packages/shared/src/admin.ts`）：包含 `updatedAt`、`redis`、`queue`、`provider`、`retry`、`database` 字段；API 与 Web 共用该契约并通过 typecheck。
- [x] Redis 正常示例：浏览器实测后台显示 `redis.status=ok`、`readyLength=0`、`provider.activePermits=0`、`provider.availablePermits=2`，与示例语义一致。

**名词层“现状 → 变化”逐项核对**：

- [x] shared admin contract：新增 queue status 响应类型和前端 guard。
- [x] generation queue runtime：`generation-queue.ts` 暴露 ready length、worker running、active worker 和 worker config 快照。
- [x] provider scheduler：`provider-scheduler.ts` 暴露 configured concurrency、active permits、available permits 和 TTL 快照。
- [x] retry summary：observability 模块读取 retry policy config，不改变 retry 决策。
- [x] database summary：observability 模块聚合 generation record 状态计数、output 成败数和 recent failure。

**流程图核对**：

- [x] `GET /api/admin/generation-queue`、`requireAdmin`、Redis health、queue snapshot、provider snapshot、retry config、DB summary 和前端 summary band 均有实际代码落点。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] 管理员可在生成审计页看到 Redis、Ready、Workers、Provider、Attempts、失败记录、输出计数和失败摘要。
- [x] API 只对 admin 开放；未登录 / 非 admin 访问在 smoke 中被拒绝。
- [x] Redis unavailable / inline driver 均有兼容路径；inline smoke 已覆盖 `redis.status=disabled`。

**明确不做逐项核对**：

- [x] 未新增公开监控大盘、Prometheus、WebSocket live monitor 或告警。
- [x] 未新增 delayed queue、per-output Redis job、processing list、用户排队位次、ETA 或 retry attempt 持久化。
- [x] 未改变 provider 并发、worker 并发、retry 配置解析或生成状态机。
- [x] 新 admin queue status 响应不返回 `REDIS_URL`、Redis host、raw Redis error、prompt、reference bytes、provider credential、Redis job key 或完整 Redis payload。

**关键决策落地**：

- [x] admin-only + sanitized：route 复用 `requireAdmin`，响应只包含枚举、数字、时间戳、generation id 和稳定失败摘要。
- [x] best-effort：Redis 指标读取失败时返回 `redis.status="unavailable"`，DB summary 仍可用。
- [x] dense admin surface：UI 挂在现有生成审计页顶部，不新增独立页面。

**编排层“现状 → 变化”逐项核对**：

- [x] Admin page 同时加载 audits 和 queue status；刷新按钮同步刷新两者。
- [x] observability 模块聚合 queue / provider / retry / DB，不把跨模块读逻辑塞进 route。
- [x] Redis snapshot 读取不启动 worker、不触发 provider call，不绕过 provider 闸门。

**流程级约束核对**：

- [x] 错误语义：鉴权错误走既有 admin 401/403；Redis 连接细节不外泄。
- [x] 幂等性：读接口不写 DB；provider snapshot 只做等价的过期 permit 清理。
- [x] 并发：未新增 worker 或 provider 调用。
- [x] 安全：响应只含稳定摘要和计数类字段。

**挂载点反向核对（可卸载性）**：

- [x] Shared admin contract：`packages/shared/src/admin.ts`。
- [x] API admin route：`apps/api/src/server/routes/admin.ts`。
- [x] Generation observability domain：`apps/api/src/domain/generation/generation-queue-observability.ts`。
- [x] Runtime snapshot：`generation-queue.ts`、`provider-scheduler.ts`。
- [x] Web admin audits tab：`apps/web/src/features/admin/AdminPage.tsx`。
- [x] Admin i18n / CSS：`apps/web/src/shared/i18n/index.tsx`、`apps/web/src/styles/admin.css`。
- [x] 反向 grep：`generation-queue` / `AdminGenerationQueueStatusResponse` / `adminQueueStatus*` 命中均落在上述挂载点或既有 audit 文案内。
- [x] 拔除沙盘推演：移除 shared type、route、observability domain、UI panel、i18n 和 CSS 后，本 feature 无残留运行路径；queue / provider snapshot helper 仅服务 admin observability。

## 3. 验收场景核对

- [x] **S1**：Admin 请求 `/api/admin/generation-queue` -> 返回 queue / provider / retry / database / redis 字段，且不含敏感字段。
  - 证据来源：`smoke:generation-queue-observability`、typecheck、代码核对。
  - 结果：通过。
- [x] **S2**：Redis driver 且 Redis 可用 -> 返回 Redis ok、ready length、worker config、provider permit 计数。
  - 证据来源：`smoke:generation-queue-observability`、内置 Browser 实测后台显示 Redis 正常、Ready 0、Workers 0/2、Provider 0/2。
  - 结果：通过。
- [x] **S3**：`GENERATION_QUEUE_DRIVER=inline` -> 返回 disabled 且不读 ready list。
  - 证据来源：`smoke:generation-queue-observability:inline`。
  - 结果：通过。
- [x] **S4**：DB status / output / recent failure summary 正确。
  - 证据来源：`smoke:generation-queue-observability`。
  - 结果：通过。
- [x] **S5**：非 admin 或未登录用户访问 admin route 被拒绝。
  - 证据来源：`smoke:generation-queue-observability`。
  - 结果：通过。
- [x] **S6**：生成审计页顶部能看到队列、provider、retry、失败摘要；刷新按钮同步刷新。
  - 证据来源：内置 Browser 桌面 1440x1000 验证，后台生成审计页可见 queue status panel；无内部 overflow。
  - 结果：通过。
- [x] **S7**：移动视口可读。
  - 证据来源：内置 Browser 390x844 验证，queue status panel 纵向堆叠，Redis / Ready / Workers / Provider / Attempts / 失败记录 / 输出计数可读，`.admin-queue-status` 内部 overflow 检测为空。
  - 结果：通过。备注：390px 下顶部全站导航已有部分链接横向溢出，非本 feature 新增面板造成，后续可单独走 UI refactor。
- [x] **S8**：Redis 指标读取失败 -> 返回 unavailable 和 DB summary。
  - 证据来源：`smoke:generation-queue-observability`。
  - 结果：通过。
- [x] **S9**：范围守护。
  - 证据来源：代码 grep / review。
  - 结果：未新增 delayed queue、per-output job、processing list、用户排队位次、ETA 或 retry attempt 持久化。

**已执行验证**：

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-queue-observability`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-queue-observability:inline`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-queue`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:generation-recovery`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:agent-generation-queue`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:provider-retry`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:provider-scheduler`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:executor`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:planner`
- [x] `docker compose config --quiet --no-env-resolution`
- [x] Redis residual check：`generation:provider:permits` zcard = 0；`generation:queue:ready` llen = 0。
- [x] 内置 Browser：desktop 1440x1000、mobile 390x844。

## 4. 术语一致性

- `AdminGenerationQueueStatusResponse`：shared / API / Web 命名一致。
- `generation queue observability`：design、architecture、observability domain 命名一致。
- `provider active permits` / `available permits`：provider scheduler snapshot、API response 和 UI 表示一致。
- 防冲突：未引入用户侧 queue position / ETA / public monitor 命名。

## 5. 架构归并

- [x] `.codestable/architecture/ARCHITECTURE.md`：已加入 generation queue observability 术语、模块索引、后台审计页读取流程和安全边界。
- [x] `docs/RELIABILITY.md`：已记录 admin queue status 的运行态可见字段和“只读、不改变调度语义”的边界。
- [x] `docs/SECURITY.md`：已记录 `/api/admin/generation-queue` 的脱敏边界和禁止暴露字段。
- [x] `.codestable/attention.md`：无需更新。本 feature 未新增每个后续 feature 都会撞到的命令或环境坑。

## 6. requirement 回写

- [x] 方案 frontmatter `requirement: null`，本次属于 roadmap 内部运行可观测性补齐，不新增独立用户能力愿景；无需 requirement 回写。

## 7. roadmap 回写

- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-items.yaml`：`generation-queue-observability` 已从 `in-progress` 改为 `done`。
- [x] `.codestable/roadmap/generation-provider-scheduler/generation-provider-scheduler-roadmap.md`：第 5 节子 feature 清单已同步为 done，并补充对应 feature 与备注。

## 8. attention.md 候选盘点

- [x] 无候选：本 feature 未暴露需要补入 `.codestable/attention.md` 的长期环境 / 工具 / 工作流注意事项。

## 9. 遗留

- 后续优化点：390px 下顶部全站导航存在既有横向溢出，可另起 UI refactor；AdminPage 文件偏大，也可另走 tab 拆分 refactor。
- 已知限制：本 feature 是 admin-only snapshot，不提供 live monitor、告警、用户排队位次、ETA、delayed retry queue 或 per-output Redis job。
- 实现阶段顺手发现：无会阻塞本 feature 的问题。
