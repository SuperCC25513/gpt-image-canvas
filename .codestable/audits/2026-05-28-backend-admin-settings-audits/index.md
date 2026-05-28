---
doc_type: audit-index
audit: 2026-05-28-backend-admin-settings-audits
scope: Backend admin users, admin settings, admin credit adjustment, and generation audit listing.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-admin-settings-audits 审计报告

## 范围

本次审计覆盖后台管理与审计查询：

- `apps/api/src/server/routes/admin.ts`
- `apps/api/src/domain/admin/admin-store.ts`
- `apps/api/src/domain/admin/audit-store.ts`
- `apps/api/src/server/http/validation.ts`
- `packages/shared/src/admin.ts`
- `docs/SECURITY.md`

## 总评

共发现 3 条问题：`bug` 2 条、`security` 1 条；严重度为 P1 1 条、P2 2 条。后台路由的权限入口清晰，`/api/admin/users`、用户更新、积分调整、系统设置和 generation audit 查询都先调用 `requireAdmin`。响应也没有返回密码 hash、provider key 或 OAuth token。主要风险在 audit 错误摘要脱敏规则不足、后台列表只有截断没有翻页、以及管理端数字字段使用 `parseInt` 导致宽松接受非法输入。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P1 | medium | generation audit 错误摘要只脱敏 Bearer/sk，后台会展示其他形态的上游敏感错误 | [finding-01.md](finding-01.md) |
| 2 | bug | P2 | high | 后台用户和 audit 列表只有 limit，没有 offset/cursor，超过上限的数据不可达 | [finding-02.md](finding-02.md) |
| 3 | bug | P2 | high | 后台积分和设置数字字段用 `parseInt`，会接受 `10abc` 这类部分非法值 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 0 | 2 | 2 |
| security | 0 | 1 | 0 | 1 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **1** | **2** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01 建议走 `cs-issue`，统一 provider/audit 错误脱敏策略，避免后台审计列表沉淀敏感上游 payload。
- **P2 有空再看**：Finding 02 建议走 `cs-refactor`，补 cursor/offset 和响应分页元数据；Finding 03 建议走 `cs-issue`，替换管理端数字解析为严格 safe integer 校验。
