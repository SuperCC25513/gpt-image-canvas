# 兑换码积分兑换实施计划

## 实施顺序

1. Shared 契约
   - 新增 `packages/shared/src/redemption-codes.ts`，定义兑换码状态、列表项、创建请求、兑换请求和响应。
   - 更新 `packages/shared/src/credits.ts`：`CREDIT_TRANSACTION_REASONS` 增加 `redemption_code`，`CreditTransaction` 增加 `relatedRedemptionCodeId?: string`。
   - 更新 `packages/shared/src/index.ts` 导出新增契约。

2. 数据库结构
   - 更新 `apps/api/src/infrastructure/schema.ts`：新增 `redemptionCodes`、`creditRedemptions` 表；`creditTransactions` 增加 `relatedRedemptionCodeId`。
   - 更新 `apps/api/src/infrastructure/sqlite-database.ts`：创建新表、索引、兼容加列。
   - 更新 `apps/api/src/infrastructure/mysql-database.ts`：新增 MySQL 表定义、字段注释、索引和兼容迁移。

3. API 解析与 domain
   - 在 `apps/api/src/server/http/validation.ts` 增加解析函数：
     - `parseRedeemCreditCodePayload`
     - `parseAdminCreateRedemptionCodesPayload`
     - `parseAdminRedemptionCodePatchPayload`
   - 新增 `apps/api/src/domain/redemption-codes/redemption-code-store.ts`：
     - 创建码值生成与查重。
     - 后台列表、创建、启用/禁用、删除。
     - 用户兑换事务，写用户余额、`credit_transactions`、`credit_redemptions`、兑换码状态。
   - 扩展积分流水 response 映射，返回 `relatedRedemptionCodeId`。

4. API route
   - 新增 `apps/api/src/server/routes/redemption-codes.ts`。
   - 用户：`POST /api/credits/redeem`。
   - 后台：
     - `GET /api/admin/redemption-codes`
     - `POST /api/admin/redemption-codes`
     - `PATCH /api/admin/redemption-codes/:id`
     - `DELETE /api/admin/redemption-codes/:id`
   - 在 `apps/api/src/server/app.ts` 注册路由。

5. Web runtime guard 与 i18n
   - 更新 `apps/web/src/shared/api/generation.ts` 或新增相关 guard，校验兑换码响应。
   - 更新 `apps/web/src/shared/i18n/index.tsx`：
     - 兑换码 UI 文案。
     - 新错误码本地化。
     - `creditsReasonRedemptionCode`。

6. Admin 页面
   - 更新 `apps/web/src/features/admin/AdminPage.tsx`：
     - `AdminTab` 增加 `redemptionCodes`。
     - 加载兑换码列表。
     - 创建表单：积分、数量、过期时间。
     - 过期时间快捷选项：明天、3 天、一个星期、一个月、一年，写入对应日期 `23:59:59`。
     - 创建成功结果区，`count=1` 自动复制。
     - 列表复制、启用/禁用、删除。
   - 更新 `apps/web/src/features/canvas/CanvasApp.tsx`：Admin 路由映射新增 `/admin/redemption-codes`，Tab 顺序更新。
   - 更新 `apps/web/src/styles/admin.css`，复用现有表格/按钮样式，补充必要布局。

7. 积分中心
   - 更新 `apps/web/src/features/credits/CreditCenterPage.tsx`：
     - 兑换码输入表单。
     - 成功后调用 `onRefreshAccountStatus()` 和流水刷新。
     - 显示成功/失败状态。
   - 更新 `apps/web/src/styles/credits.css`，保持页面现有密度和响应式。

8. 验证
   - `nvm use 24.15.0`
   - `pnpm typecheck`
   - `pnpm build`
   - UI 验证：
     - `pnpm dev`
     - 打开 `http://localhost:5173`
     - 后台 `/admin/redemption-codes`：创建单个、自动复制、批量创建、复制列表项、禁用/启用、删除。
     - 积分中心 `/credits`：兑换成功刷新余额和流水；重复兑换失败；禁用/过期码失败。

## 风险点

- SQLite/MySQL 双驱动事务路径必须保持同等行为。
- 一次性全局码必须用 DB 事务锁和唯一约束兜住并发。
- 积分余额变更必须和 `credit_transactions` 同事务。
- 删除只能作用于未兑换且无 `credit_redemptions` 记录的码。
- 用户侧流水不应完整暴露码值。
- 前端自动复制依赖浏览器 Clipboard API，需要保留已有 `document.execCommand("copy")` fallback。

## 回滚点

- 若后台 UI 复杂度超出预期，保留 API 和积分中心兑换，后台列表先做最小表格；但不能省略管理员创建与复制能力。
- 若 MySQL 验证环境不可用，至少完成 typecheck/build，并记录未跑 MySQL 的阻塞原因。
