# 修复前端业务逻辑风险

## Goal

修复代码审查中发现的前端业务逻辑风险，让认证刷新、账号失效、Gallery 数据边界和后台管理交互在异常情况下保持可预期，不把用户引导到必失败或崩溃的流程。

## Confirmed Facts

- 顶层 `App` 在登录/注册成功后先设置 `currentUser`，再调用 `/api/auth/me` 刷新完整状态；刷新失败会清空当前用户。
- `CanvasApp` 内部独立读取 `/api/auth/me` 作为积分、角色和签到状态来源；当该请求失败或会话过期时，生成按钮当前不一定被禁用。
- Gallery 页面只校验 `items` 是数组，随后直接读取 item 深层字段。
- Admin 页面后端已拒绝管理员自降级/自禁用，但前端仍允许用户选择这些必失败操作。
- Admin 审计输出没有 asset 时仍渲染 `href="#"` 链接。
- 后端鉴权和权限控制仍是最终保护，本任务只修复前端业务流程和展示边界。

## Requirements

- 登录/注册成功后的二次状态刷新失败时，不应把已经成功建立的登录态立即清空。
- Canvas 账号状态加载中、加载失败或未认证时，不允许继续发起生成、签到等依赖登录态的操作。
- Gallery 对服务端响应做必要 runtime guard，坏数据应展示错误状态，不应导致页面崩溃。
- Admin 自身账号行不应提供自降级或自禁用的可操作控件。
- Admin 审计输出缺少资源时不应展示可点击假链接。
- 修复应保持 shared 契约优先，不在 Web 复制新的 API 类型。
- 用户可见文案新增或变更时，同步中英文 i18n。

## Acceptance Criteria

- [x] 登录或注册接口成功后，即使后续 `/api/auth/me` 临时失败，用户仍留在主应用，页面给出可理解的状态刷新错误。
- [x] `/api/auth/me` 在 Canvas 中返回失败、未认证或仍在加载时，生成按钮和签到按钮不可点击，且不会创建生成占位图。
- [x] Gallery 收到 `{ "items": [{}] }` 这类非法响应时显示 `galleryServiceInvalidData`，页面不崩溃。
- [x] Admin 当前管理员自己的角色和状态控件不可发起变更请求，后端保护保持不变。
- [x] Admin 审计输出无 asset 时渲染为不可点击状态，不再使用 `href="#"`。
- [x] 浏览器验证通过：登录页、公共 Gallery、Canvas 账号失效禁用态、Admin 自账号禁用态无明显交互异常。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm build` 通过。

## Notes

- 范围限定在前端业务逻辑修复；不改变后端权限模型、数据库结构或 Gallery API 契约。
- 本任务不处理视觉重设计，只做必要禁用态、错误态和数据守卫。
- 验证记录：`rtk proxy pnpm typecheck` 通过；`rtk proxy pnpm build` 通过；`rtk git diff --check` 通过。
- 浏览器验证记录：使用 MySQL 临时库 `gpt_image_canvas_codex_frontend_logic_8801`，API 运行在 `127.0.0.1:8801`，Web 运行在 `127.0.0.1:5175`。已验证登录页、公共 Gallery、Canvas 正常账号态和 Admin 自账号角色/状态禁用态。另用 `127.0.0.1:8803` 临时代理让第三次及之后的 `/api/auth/me` 返回 503，并通过 `127.0.0.1:5177` 验证 Canvas 在账号状态失效时生成按钮和签到按钮均禁用，且顶层用户栏仍保留已登录用户。
