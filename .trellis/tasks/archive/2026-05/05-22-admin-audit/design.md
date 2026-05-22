# 后台管理与生成审计设计

## Architecture

本任务建立最小运营后台。它依赖 admin 鉴权、积分流水和系统设置已经存在。

边界：

- `adminStore`：用户列表、用户更新、积分调整、系统设置、生成审计查询。
- `auditStore`：生成请求审计写入和状态更新。
- `/api/admin/*`：全部要求 admin。
- Web Admin：用户管理、系统设置、生成审计三个视图。

## API

- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/credits`
- `GET /api/admin/settings`
- `PATCH /api/admin/settings`
- `GET /api/admin/generation-requests?limit=200`

所有响应都不能包含原始密钥、token、cookie、数据库密码。

## User Management

管理员可修改：

- `role`
- `status`
- `credits` 或积分 delta

限制：

- 当前会话用户不能禁用自己。
- 当前会话用户不能降级自己。
- 积分调整必须写 `credit_transactions`。

## Settings

设置项：

- `allow_registration`
- `require_approval`
- `default_credits`
- `generation_credit_cost`
- `checkin_credit`
- `max_images_per_request`

初始值：

- `allow_registration=true`
- `require_approval=false`

## Generation Audit

审计记录保存：

- 用户 ID、用户名、邮箱摘要。
- prompt。
- 是否公开。
- 状态。
- 错误摘要。
- IP。
- User-Agent。
- 关联 generation/output。
- 创建和更新时间。

审计写入点：

- 生成请求开始时创建 `pending/running` 记录。
- 成功、部分失败、失败时更新状态和输出关联。

## Web UX

- 后台不是营销页，是紧凑管理界面。
- 复用当前纸张、墨色、铜色、青绿色 token。
- 用户管理优先表格布局。
- 系统设置用表单和开关。
- 审计使用可扫描列表或表格，prompt 可折叠。

## Security

- 普通用户访问 admin API 返回 403。
- 所有 admin route 必须经过同一个 admin middleware。
- 日志和响应不输出敏感信息。
- 设置接口不管理 provider 原始密钥；provider 密钥继续走已有安全配置边界。
