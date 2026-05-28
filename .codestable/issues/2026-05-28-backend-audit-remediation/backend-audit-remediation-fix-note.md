---
doc_type: issue-fix-note
issue: 2026-05-28-backend-audit-remediation
status: fixed
severity: P1
path: standard
fixed: 2026-05-28
tags:
  - backend
  - audit
  - remediation
---

# 后端审计修复记录

## 1. 修复范围

本次闭环修复 8 个后端审计模块的 24 条 finding，涉及资产/Gallery、生成审计、Provider/Agent 配置、认证、Agent runtime、后台管理、积分兑换和 SQLite/MySQL 持久化。

## 2. 关键改动

- 统一敏感错误脱敏，provider 对外错误改为稳定安全文案，generation record 与 admin audit 共用清洗策略。
- Provider/Agent 全局配置接口改为 admin-only，masked secret 原样回传时保留真实密钥。
- Codex token refresh 增加 single-flight 和条件清空，普通用户 auth status 不再返回 Codex 邮箱/accountId/token 时间，session touch 增加 10 分钟节流。
- Gallery ZIP 导出增加数量和总字节上限；OSS metadata/access-url 返回前确认对象存在；预览生成增加进程内 single-flight。
- generation audit final update 缺行时用当前 record/user 尽力补建；取消时清理已写入但未落库的生成资产 bytes。
- Agent 恢复客户端 plan 时做完整图校验；执行器增加全局 job 并发上限；skill import 在 `Content-Length` 和 `File.size` 阶段提前拒绝超限。
- 后台用户、后台 generation audit、积分流水、兑换码列表补 cursor/nextCursor；后台数字 payload 改为严格 safe integer。
- 兑换码失败对普通用户统一为不可用/已失效；MySQL 每日签到 duplicate key 转为幂等已签到响应。
- SQLite/MySQL 旧 `generation_audits.generation_id` 迁移先回填再建唯一索引；MySQL 不再初始化未启用的 provider/Agent config 表；刷新 `docs/generated/db-schema.md`。

## 3. 归档状态

- 8 个 backend audit index 已标记为 `status: remediated`。
- 24 个 backend finding 已标记为 `status: fixed`。
- 修复方案见 `backend-audit-remediation-plan.md`。

## 4. 验证

- `pnpm typecheck`：通过。
- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:executor`：通过。
- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:planner`：通过。
- `pnpm build`：通过。Vite 仍提示既有大 chunk warning，不影响构建完成。
