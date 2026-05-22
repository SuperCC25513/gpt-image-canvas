# 后台管理与生成审计

## Goal

新增最小可用后台：用户管理、积分调整、系统规则配置和生成审计。管理员可管理用户状态、角色、积分和运营规则，并查看生成请求审计记录。

## Parent And Dependency

- 父任务：`.trellis/tasks/05-21-mysql-users-gallery`
- 前置依赖：`.trellis/tasks/05-22-user-auth-ownership` 已完成 admin 鉴权。
- 前置依赖：`.trellis/tasks/05-22-credits-checkins` 已完成积分设置和流水。
- 可并行前置：`.trellis/tasks/05-22-public-gallery-visibility` 完成后，审计页可显示公开状态和输出链接。

## Requirements

- 新增管理员鉴权中间件，所有 `/api/admin/*` 接口必须要求 admin。
- 新增用户列表、搜索、角色更新、状态更新、积分设置和积分增减接口。
- 禁止管理员通过普通接口返回或修改原始 provider API Key、Agent API Key、OAuth token、数据库密码。
- 新增系统设置接口，支持注册开关、审核开关、注册送积分、每张图消耗积分、签到奖励、单次生成数量上限。
- 系统设置初始值为 `allow_registration=true`、`require_approval=false`。
- 新增生成请求审计记录，保存用户、prompt、公开状态、状态、错误摘要、IP、User-Agent、输出关联、创建和更新时间。
- 后台 UI 包含用户管理、系统设置、生成审计三个视图。
- 后台 UI 复用当前产品的纸张、墨色、铜色、青绿色视觉语言，保持工具型界面密度。
- 管理员不能禁用或降级自己的当前会话账号，避免锁死。

## Acceptance Criteria

- [ ] 普通用户访问 `/api/admin/*` 返回 403。
- [ ] 管理员可查看用户列表，并修改其他用户角色和状态。
- [ ] 管理员可直接设置积分，也可按 delta 增减积分，并写流水。
- [ ] 管理员可修改注册、审核、注册送积分、生成扣费、签到奖励等系统设置。
- [ ] 初始系统设置默认开放注册，默认不需要审核。
- [ ] 每次生成请求都会写审计记录，包含 IP、User-Agent、状态和错误摘要。
- [ ] 审计页可按最新时间查看生成请求和关联输出。
- [ ] 后台接口不返回原始密钥、token、cookie 或数据库密码。
- [ ] 通过 `pnpm typecheck`。
- [ ] 通过 `pnpm build`。
- [ ] 运行 `pnpm dev` 后，用内置浏览器验证后台桌面/移动基本可用。

## Out Of Scope

- 不做内容审核队列。
- 不做运营数据图表大屏。
- 不做支付订单管理。
- 不做细粒度 RBAC 权限矩阵。

## Notes

- 参考项目已有 `/api/admin/settings`、`/api/admin/users`、`/api/admin/generations` 和后台静态页，但本项目应按 React/Vite/Hono/shared 契约重建，不直接复制单体实现。
