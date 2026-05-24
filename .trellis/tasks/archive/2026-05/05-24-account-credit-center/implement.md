# 用户名菜单与积分中心实施计划

## 实施顺序

1. 契约层
   - 在 `packages/shared/src/credits.ts` 增加 `CreditTransactionListResponse`。
   - 如需要分页，增加游标字段类型；初版至少支持 `items`。

2. 后端接口
   - 在 `apps/api/src/domain/credits/credit-store.ts` 增加当前用户流水查询函数。
   - 新增 `apps/api/src/server/routes/credits.ts`。
   - 在 `apps/api/src/server/app.ts` 注册积分路由。
   - 接口使用 `requireAuth()`，只查当前登录用户。

3. 前端路由
   - 新增 `apps/web/src/features/credits/CreditCenterPage.tsx`。
   - 在 `CanvasApp.tsx` 扩展 `AppRoute`、路径识别和 lazy load。
   - 将 `/credits` 接入主渲染区域。

4. 用户名下拉菜单
   - 重构 `TopNavigation` 账号区为用户名按钮 + 下拉菜单。
   - 菜单包含积分摘要、积分中心入口、退出。
   - 实现点击外部、Escape、选择菜单项关闭。
   - 移除顶部常驻完整签到按钮。

5. 积分中心页面
   - 显示余额、签到状态、签到按钮。
   - 拉取并展示积分流水。
   - 签到成功后刷新账户状态和流水。
   - 展示 loading、error、empty 状态。

6. 样式和 i18n
   - 补 `credits.css` 并导入 `styles.css`。
   - 补账号菜单在 light/dark/responsive 下的样式。
   - 补中英文文案和流水原因文案。

7. 验证和清理
   - 检查本任务文件 diff，确认未回退其他已有改动。
   - 跑类型检查和构建。
   - 使用内置浏览器验证桌面和移动路径。

## 验证命令

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 >/dev/null && pnpm typecheck
source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 >/dev/null && pnpm build
```

UI 验证：

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 24.15.0 >/dev/null && pnpm dev
```

浏览器验证目标：

- `http://localhost:5173/generate`：用户名菜单可打开，导航不挤压。
- 菜单点击「积分中心」进入 `/credits`。
- `/credits` 显示余额、签到状态、流水。
- 未签到时点击签到后余额、状态、流水刷新。
- `/`、`/canvas`、`/pool`、`/gallery` 顶部菜单仍可用。
- 390px 左右移动视口无横向溢出。

## 风险文件

- `apps/web/src/features/canvas/CanvasApp.tsx` 当前已有本会话前序改动，实施时只继续改账号菜单和路由相关代码。
- `apps/web/src/styles/responsive.css` 顶部导航断点容易引起挤压，需要浏览器验证。
- `apps/api/src/domain/credits/credit-store.ts` 同时支持 SQLite/MySQL，新增查询需覆盖两种 driver。

## 回滚点

- 如果积分中心页面实现出现布局风险，可先保留新接口和用户名菜单入口，但隐藏 `/credits` 入口不作为完成态。
- 如果分页实现复杂，初版可退回最近 30 条无分页，但必须在 PRD 验收中保留流水可见。
