# 兑换码积分兑换技术设计

## 范围

本任务新增一次性全局兑换码能力，跨 `packages/shared`、`apps/api` 和 `apps/web`：

- Shared：新增兑换码、创建请求、兑换请求和响应类型；扩展积分流水原因与关联字段。
- API：新增兑换码 domain、用户兑换路由、后台管理路由、请求解析。
- DB：SQLite 和 MySQL 新增兑换码相关表；积分流水增加兑换码关联字段。
- Web：积分中心新增兑换入口；Admin 新增「兑换码」Tab。

## 数据模型

### `redemption_codes`

记录后台生成的码本体。

- `id`：主键，`redemption-code-<uuid>`。
- `code`：唯一码值，格式 `CC-XXXX-XXXX-XXXX`。
- `credits`：兑换后增加的积分，范围 1 到 10000。
- `status`：`active` 或 `disabled`。
- `expires_at`：可空 ISO 时间；为空表示永久有效。
- `redeemed_by_user_id`：可空，兑换成功用户。
- `redeemed_at`：可空，兑换成功时间。
- `created_by_admin_id`：创建管理员。
- `created_at` / `updated_at`：ISO 时间。

索引：

- `UNIQUE(code)`。
- `status`。
- `redeemed_by_user_id`。
- `created_at`。

### `credit_redemptions`

记录一次成功兑换，用于审计和删除保护。

- `id`：主键，`credit-redemption-<uuid>`。
- `code_id`：兑换码 ID。
- `user_id`：兑换用户。
- `credits_awarded`：本次发放积分。
- `transaction_id`：对应 `credit_transactions.id`。
- `created_at`：ISO 时间。

索引：

- `UNIQUE(code_id)` 保证一次性全局码只能成功兑换一次。
- `user_id`。
- `transaction_id`。

### `credit_transactions`

扩展：

- `reason` 增加 `redemption_code`。
- 新增 `related_redemption_code_id`，指向 `redemption_codes.id`。
- `admin_note` 可继续承载短码，例如 `code:CC-ABCD...WXYZ`，供用户侧流水展示。

说明：不在用户侧流水暴露完整码值。后台兑换码列表显示完整码，并提供复制按钮。

## API 契约

### 用户兑换

`POST /api/credits/redeem`

请求：

```ts
interface RedeemCreditCodeRequest {
  code: string;
}
```

响应：

```ts
interface RedeemCreditCodeResponse {
  user: CurrentUser;
  transaction: CreditTransaction;
  redemption: CreditRedemptionSummary;
}
```

校验与错误：

- 未登录：`401 unauthorized`。
- 空码/格式错误：`400 invalid_redemption_code`。
- 不存在：`404 redemption_code_not_found`。
- 禁用：`400 redemption_code_disabled`。
- 已过期：`400 redemption_code_expired`。
- 已兑换：`409 redemption_code_redeemed`。

成功路径必须在一个 DB 事务中：

1. 锁定兑换码。
2. 确认 active、未过期、未兑换。
3. 增加 `users.credits`。
4. 写 `credit_transactions(reason=redemption_code)`。
5. 写 `credit_redemptions`。
6. 回写 `redemption_codes.redeemed_by_user_id/redeemed_at/updated_at`。

### 后台兑换码管理

`GET /api/admin/redemption-codes?limit=200`

- 返回最近兑换码列表，包含完整码值。

`POST /api/admin/redemption-codes`

请求：

```ts
interface AdminCreateRedemptionCodesRequest {
  credits: number;
  count: number;
  expiresAt?: string;
}
```

规则：

- `credits` 为 1 到 10000。
- `count` 为 1 到 200。
- `expiresAt` 可空；如果提供必须是有效未来 ISO 时间。
- 系统生成码，不接受手动码值。

响应返回创建出的码列表。`count=1` 时 Web 创建成功后自动复制该码。

`PATCH /api/admin/redemption-codes/:id`

- 第一版只支持 `{ status: "active" | "disabled" }`。
- 已兑换码也允许调整状态字段，但状态不影响已完成兑换，只影响未兑换码。

`DELETE /api/admin/redemption-codes/:id`

- 只允许删除未兑换且没有 `credit_redemptions` 记录的码。
- 已兑换或存在兑换记录返回 `409 redemption_code_has_redemption`。

## 码值生成

- 格式：`CC-XXXX-XXXX-XXXX`。
- 字符集排除易混淆字符：不使用 `O`、`0`、`I`、`1`。
- domain 生成后查重；碰撞时重试，达到合理次数后返回内部错误。

## Web 设计

### Admin

- `AdminTab` 增加 `redemptionCodes`。
- 路由：`/admin/redemption-codes`。
- Tab 顺序：用户、兑换码、生成服务、生成审计、系统设置。
- 面板包含：
  - 创建表单：积分额度、生成数量、过期时间。
  - 过期时间快捷选项：明天、3 天、一个星期、一个月、一年；点击后写入现有 `datetime-local` 控件，时间固定为本地时间 23:59:59。
  - 最近生成结果区：本次创建码列表；生成数量为 1 时自动复制。
  - 兑换码列表：码值、积分、状态、过期时间、兑换状态、创建时间、操作。
  - 操作：复制、启用/禁用、删除。

### 积分中心

- 在 `/credits` 概览区域或流水上方增加兑换码输入。
- 提交成功后：
  - 显示成功提示。
  - 刷新账户状态。
  - 刷新积分流水。
- 失败时显示本地化错误，不改变当前余额展示。

## 兼容性与迁移

- SQLite 启动 SQL 新增表和索引，并通过 `ensureColumn` 给 `credit_transactions` 增加 `related_redemption_code_id`。
- MySQL 表定义同步新增表、字段、索引和注释，启动兼容迁移补齐。
- 旧库无兑换码表时启动自动创建，不迁移旧积分流水。
- `CreditTransaction` 新字段为 optional，旧流水兼容。

## 安全与可靠性

- 用户兑换和后台管理都必须走现有 session 鉴权。
- 后台路由必须使用 `requireAdmin()`。
- 兑换码比较前统一 `trim().toUpperCase()`。
- 不在普通用户流水完整暴露码值。
- 兑换成功必须事务化，不能只加余额或只写流水。
- 一次性全局码通过事务锁和唯一约束共同保证。

## 验证

- `pnpm typecheck`
- `pnpm build`
- 浏览器验证：
  - 管理员打开 `/admin/redemption-codes`。
  - 创建 1 个码，成功后自动复制，列表显示该码。
  - 批量创建多个码，列表可复制单个码。
  - 禁用码后用户兑换失败。
  - 用户在积分中心兑换 active 未过期码，余额和流水刷新。
  - 已兑换码再次兑换失败。
  - 已兑换码删除失败，未兑换码删除成功。
