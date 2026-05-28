---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "05"
slug: backend-admin-settings-audits
status: completed
priority: P1
recommended_dimensions:
  - security
  - bug
  - maintainability
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-admin-settings-audits/
---

# Task 05：后台管理 + 系统设置 + 审计查询

## 目标产物

`.codestable/audits/2026-05-28-backend-admin-settings-audits/`

## 路径

- `apps/api/src/server/routes/admin.ts`
- `apps/api/src/domain/admin/admin-store.ts`
- `apps/api/src/domain/admin/audit-store.ts`
- `packages/shared/src/admin.ts`
- `apps/api/src/domain/auth/auth-store.ts`
- `apps/api/src/domain/credits/credit-store.ts`

## 业务含义

负责用户列表、用户状态、管理员积分调整、系统注册设置、邮箱后缀支持列表和 generation audit 查询。

## 风险理由

后台接口可以改变用户状态、积分余额和注册策略，也能读取审计数据。需要重点确认 admin 权限、响应脱敏、设置规范化、分页和审计数据隐私。

## 推荐审计维度

- `security`：`/api/admin/*` 权限、敏感字段响应、audit prompt/IP/UA 暴露边界。
- `bug`：设置保存、空邮箱域名列表语义、积分调整事务、分页。
- `maintainability`：admin-store 代码量大，检查重复转换和复杂分支。

## 重点检查

- 所有 admin 路由是否走 `requireAdmin`。
- 后台响应是否不包含 raw provider key、OAuth token、cookie 或 DB 密码。
- 空 `allowedRegistrationEmailDomains` 是否表示不限制，缺失/坏 JSON 是否回退默认。
- 管理员积分调整是否同步写 `credit_transactions`。
- generation audit 列表是否有分页和最小必要字段。

## 不做

不审计 Web 后台页面；不调整后台交互。
