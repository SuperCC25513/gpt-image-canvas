---
doc_type: audit-index
audit: 2026-05-28-web-auth-admin-access
scope: apps/web auth shell and admin management UI
created: 2026-05-28
status: active
total_findings: 4
---

# web-auth-admin-access 审计报告

## 范围

扫描 `apps/web/src/App.tsx`、`apps/web/src/features/admin/AdminPage.tsx`，并交叉查看 `CanvasApp.tsx` 内 admin route 挂载逻辑。重点看登录/登出、admin 入口、用户/积分/系统设置/兑换码管理和后台审计列表。

## 总评

共发现 4 条：2 条 `bug`、1 条 `security`、1 条 `maintainability`。最高优先级是 admin API 响应在前端被泛型强转，除兑换码列表等少数路径外缺少运行时 guard。另一个需要注意的是直接访问 `/admin/*` 时前端会加载后台页面，导航只隐藏入口，没有做 route guard。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P2 | medium | 非管理员直接访问 /admin 仍会加载后台页面外壳 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | medium | 多个后台响应被泛型强转后直接写入高权限状态 | [finding-02.md](finding-02.md) |
| 3 | bug | P2 | medium | 登出请求失败时前端仍会先清空当前用户 | [finding-03.md](finding-03.md) |
| 4 | maintainability | P2 | high | AdminPage 单文件承载五类后台子系统 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 1 | 2 |
| security | 0 | 0 | 1 | 1 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **1** | **3** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-02 建议开 `cs-issue`，先补后台关键响应 guard。
- **P2 有空再看**：finding-01、finding-03 可跟后台访问体验一起修；finding-04 建议走 `cs-refactor` 拆分后台页面。
