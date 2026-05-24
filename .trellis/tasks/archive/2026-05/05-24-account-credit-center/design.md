# 用户名菜单与积分中心技术设计

## 范围

本任务跨 `apps/api`、`packages/shared`、`apps/web`：

- API：新增当前用户积分流水查询接口。
- Shared：补充积分流水列表响应契约。
- Web：新增 `/credits` 路由、积分中心页面、用户名下拉菜单，并迁移签到入口。

## 后端设计

### 接口

新增接口：

```http
GET /api/credits/transactions?limit=30&cursor=<createdAt-or-id>
```

初版可只实现 `limit`，默认返回最近 30 条，最大 100 条。若实现分页，使用稳定游标避免 offset 在新流水写入时抖动。

响应：

```ts
interface CreditTransactionListResponse {
  items: CreditTransaction[];
  nextCursor?: string;
}
```

接口必须通过 `requireAuth()`，只查询 `auth.user.id` 对应流水，不能接收前端传入的 `userId`。

### 查询位置

优先在 `apps/api/src/domain/credits/credit-store.ts` 新增只读函数，例如 `listCreditTransactionsForUser(userId, options)`：

- SQLite：使用 Drizzle 从 `creditTransactions` 查询。
- MySQL：使用 `creditTransactionSelectSql()` 复用字段映射。
- 排序：`created_at DESC`，必要时用 `id` 作稳定次序。

路由可放在现有 `apps/api/src/server/routes/auth.ts`，也可以新增 `routes/credits.ts` 并在 `server/app.ts` 注册。推荐新增 `routes/credits.ts`，避免 `auth.ts` 继续承载积分领域接口。

### 现有流水来源

无需改写已有流水写入规则：

- 注册赠送：`registration_bonus`。
- 签到：`daily_checkin`。
- 生成预扣：`generation_charge`。
- 失败退款：`generation_refund`。
- 后台调整：`admin_adjustment`。

## 前端设计

### 路由

扩展 `AppRoute`：

```ts
type AppRoute = ... | "credits";
```

路径：

```ts
credits -> /credits
```

`routeForPath()` 识别 `/credits`，`pathForRoute()` 返回 `/credits`。

积分中心页面建议新增 `apps/web/src/features/credits/CreditCenterPage.tsx`，并在 `CanvasApp.tsx` 中按现有 Gallery/Pool 模式 lazy load。

### 用户名下拉菜单

`TopNavigation` 的账号区域改成：

- 一个用户名按钮，包含用户图标、名称和下拉箭头。
- 点击后打开菜单。
- 菜单内容：
  - 用户名和邮箱。
  - 当前积分余额摘要。
  - 「积分中心」按钮/链接，点击后关闭菜单并路由到 `/credits`。
  - 「退出登录」按钮。

菜单关闭条件：

- 点击菜单外。
- 按 Escape。
- 选择菜单项。

顶部导航不再常驻展示签到按钮。签到入口放入积分中心页面。

### 积分中心页面

页面接收来自 `CanvasApp` 的账户状态和操作：

- `accountStatus`
- `accountError`
- `isAccountLoading`
- `isCheckingIn`
- `onCheckin`
- `onRefreshAccountStatus`

页面自身加载流水：

- `GET /api/credits/transactions`
- loading、error、empty 状态完整展示。
- 签到成功后重新拉取账户状态和流水。

流水展示字段：

- `delta`：正数显示增加，负数显示消耗。
- `reason`：用 i18n 映射业务文案。
- `createdAt`：使用现有 `formatDateTime`。
- `relatedGenerationId` / `relatedCheckinDate` / `adminNote`：作为辅助信息，不强制每条都有。

### i18n

新增用户可见文案到 `apps/web/src/shared/i18n/index.tsx`，同步 `zh-CN` 和 `en`：

- 账号菜单。
- 积分中心标题/空状态/错误。
- 流水原因。
- 流水字段。

## 样式

新增最小相关样式文件：

- `apps/web/src/styles/credits.css`：积分中心页面。
- 账号菜单样式可放在 `layout.css` / `layout-theme.css` / `dark.css` / `responsive.css`，因为属于全局顶部导航。

遵守现有 warm paper、ink、copper、teal token。菜单和页面控件要有稳定尺寸，移动端不造成导航横向溢出。

## 兼容性

- 不迁移数据库。`credit_transactions` 已存在。
- 不改变现有积分写入逻辑。
- 不改变现有 `/api/auth/me` 和 `/api/checkin` 契约。
- 已签到状态应继续由 `/api/auth/me` 的 `checkin` 字段提供。

## 风险

- 顶部菜单的外部点击和 Escape 关闭逻辑容易泄漏监听，需要 effect cleanup。
- 当前工作区已有未提交改动，实施时只改本任务相关文件，不能回退其他会话改动。
- 新接口必须避免暴露其他用户流水。
