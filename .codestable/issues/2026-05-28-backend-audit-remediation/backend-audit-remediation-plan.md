---
doc_type: issue-analysis
issue: 2026-05-28-backend-audit-remediation
status: confirmed
severity: P1
root_cause_type: audit-remediation
path: standard
created: 2026-05-28
tags:
  - backend
  - audit
  - remediation
---

# 后端审计修复方案

## 1. 输入范围

本次修复以 8 个后端审计模块为输入：

- `2026-05-28-backend-assets-gallery`
- `2026-05-28-backend-generation-credits`
- `2026-05-28-backend-agent-runtime`
- `2026-05-28-backend-auth-oauth`
- `2026-05-28-backend-admin-settings-audits`
- `2026-05-28-backend-provider-agent-config`
- `2026-05-28-backend-redemption-credit-ledger`
- `2026-05-28-backend-persistence-sqlite-mysql`

目标是把 24 条 finding 收敛为代码修复、文档刷新和审计归档闭环。

## 2. 合并后的修复批次

| 批次 | 覆盖 finding | 修复动作 |
|---|---|---|
| 安全错误净化 | generation-credits 02, admin-settings-audits 01 | 新增共享敏感信息脱敏 helper；provider 对外返回稳定错误文案；generation record 与 audit 持久化复用同一清洗策略。 |
| 全局配置权限与 secret 保留 | provider-agent-config 01, 02 | Provider/Agent 配置 GET/PUT 改为 admin-only；后端识别当前 masked secret 回传并按 preserve 处理。 |
| OAuth/session 边界 | auth-oauth 01, 02, 03 | Codex refresh 增加进程内 single-flight，普通用户 auth status 隐藏 Codex 身份字段，session touch 增加节流。 |
| Gallery/asset 可靠性 | assets-gallery 01, 02, 03 | Gallery export 增加上限和总字节控制；OSS metadata/access-url 前确认对象存在；预览生成加 single-flight。 |
| Generation lifecycle | generation-credits 01, 03 | audit final update 缺行时 backfill；取消后清理未落库成功输出的资产 bytes。 |
| Agent runtime | agent-runtime 01, 02, 03 | 客户端恢复 plan 执行前做完整图校验；执行器限制全局 job 并发；skill import 在 `Content-Length`/`File.size` 阶段提前拒绝超限。 |
| 管理端与账本分页/校验 | admin-settings-audits 02, 03, redemption-credit-ledger 02 | 后台用户、后台 audit、积分流水、兑换码列表补 cursor/nextCursor；管理端数字字段改严格 safe integer。 |
| 兑换/签到幂等 | redemption-credit-ledger 01, 03 | 用户兑换失败统一对外错误；MySQL 签到 duplicate key 转为幂等已签到响应。 |
| 持久化漂移与文档 | provider-agent-config 03, persistence-sqlite-mysql 01, 02, 03 | 修复旧 audit migration 回填；移除 MySQL provider/Agent config 假能力初始化；刷新 `docs/generated/db-schema.md`。 |

## 3. 验证计划

- 运行相关 smoke 或新增轻量验证覆盖 Agent executor / planner 边界。
- 最终执行 `pnpm typecheck` 和 `pnpm build`。
- 审计文档更新每个 finding 的修复状态，并在本目录写 fix-note 作为闭环归档。
