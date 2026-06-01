---
doc_type: issue-fix
issue: 2026-06-01-admin-mysql-redemption-500
path: fast-track
fix_date: 2026-06-01
tags: [admin, mysql, redemption-codes, deployment]
---

# Admin MySQL 兑换码列表 500 修复记录

## 1. 问题描述

部署使用 `USE_MYSQL=true` 后，后台管理页面显示“服务器内部错误（HTTP 500）”。截图停留在“用户管理”，但 Admin 页面首屏会并发请求用户、设置、生成审计、队列状态和兑换码列表。

## 2. 根因

MySQL 模式下 `/api/admin/redemption-codes?limit=200` 使用 prepared statement 参数绑定 `LIMIT ?`。本地 MySQL 8 复现返回 `ER_WRONG_ARGUMENTS: Incorrect arguments to mysqld_stmt_execute`，路由未捕获该 MySQL 错误，最终由全局错误处理返回 500。

同类风险也存在于 MySQL 积分流水查询的 `LIMIT ?` 写法。

## 3. 修复方案

将受限、已归一化的分页上限计算为 `pageLimit = limit + 1` 后内联到 SQL 的 `LIMIT ${pageLimit}`，保留其他查询条件的参数绑定。`limit` 来源仍经过正整数和上限收敛，不接受用户原始字符串直接进入 SQL。

新增 `smoke:admin-mysql`，覆盖 MySQL 新库初始化后 Admin 首屏相关读路径：用户列表、系统设置、生成审计、队列状态、兑换码列表，以及同类积分流水查询。

## 4. 改动文件清单

- `apps/api/src/domain/redemption-codes/redemption-code-store.ts`：修复 MySQL 兑换码列表 `LIMIT ?`。
- `apps/api/src/domain/credits/credit-store.ts`：修复 MySQL 积分流水列表同类 `LIMIT ?`。
- `apps/api/src/smoke/admin-mysql-smoke.ts`：新增 Admin MySQL smoke。
- `apps/api/package.json`：新增 `smoke:admin-mysql` 脚本。

## 5. 验证结果

- `SMOKE_MYSQL_ADMIN=1 MYSQL_CREATE_DATABASE=true pnpm --filter @gpt-image-canvas/api smoke:admin-mysql`：通过。
- 本地 MySQL `gpt_image_canvas` 初始化后表数量：21。
- `rg "LIMIT\\s+\\?|OFFSET\\s+\\?" apps packages`：未发现残留。
- 全仓 `LIMIT` SQL 抽查：剩余动态 limit 均来自已收敛数字、常量或固定上限，未发现用户原始字符串进入 SQL limit。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。

## 6. 运行说明

首次部署时，如果 `MYSQL_CREATE_DATABASE=false`，部署平台必须先创建 `MYSQL_DATABASE` 指向的数据库；应用启动只负责建表和补字段。若要让应用首次创建数据库，需要临时设置 `MYSQL_CREATE_DATABASE=true`，或手动建库后保持生产配置为 `false`。
