# 契约规范

## 常量驱动

选项值集中在 shared：

- `SIZE_PRESETS`
- `STYLE_PRESETS`
- `IMAGE_QUALITIES`
- `OUTPUT_FORMATS`
- `GENERATION_COUNTS`
- `PROVIDER_SOURCE_IDS`
- `MAX_REFERENCE_IMAGES`
- `MAX_GENERATION_PLAN_IMAGES`

API parser 和 Web UI 都应引用这些常量，避免散落硬编码。

## Request / Response 形态

- Request interface 表达客户端发送内容，如 `GenerateImageRequest`、`EditImageRequest`、`SaveProviderConfigRequest`。
- Response interface 表达 API 返回内容，如 `GenerationResponse`、`GalleryResponse`、`ProviderConfigResponse`。
- Secret 在 response 中必须是 `MaskedSecret`，不要暴露 raw value。
- 状态字段使用 string union，如 `GenerationStatus`、`GenerationPlanStatus`、`ProviderSourceStatus`。

## Scenario: 注册审核 pending 响应

### 1. Scope / Trigger

- Trigger: `POST /api/auth/register` 在 `requireApproval=true` 时会创建 pending 用户，但不能创建 session。
- 这是 API、shared、Web 的跨层响应契约，必须在 `packages/shared/src/auth.ts` 中表达。

### 2. Signatures

- Request: `RegisterRequest { name: string; email: string; password: string }`
- Active success response: `AuthSessionResponse { user: CurrentUser }`
- Pending success response: `AuthPendingRegistrationResponse { status: "pending"; message: string }`
- Register response union: `AuthRegisterResponse = AuthSessionResponse | AuthPendingRegistrationResponse`

### 3. Contracts

- `201` 表示 active 用户注册成功，API 必须设置 session cookie。
- `202` 表示 pending 用户已创建并等待管理员审核，API 不得设置 session cookie。
- `status` 只能是 `"pending"`，Web 用该 discriminant 区分是否进入主应用。
- `message` 是 API fallback 文案，Web 仍需用 i18n 展示本地化提示。

### 4. Validation & Error Matrix

- `allowRegistration=false` -> `403 registration_disabled`，不创建用户。
- 邮箱已存在，包括 pending 用户 -> `409 email_already_registered`。
- `requireApproval=false` 且字段有效 -> `201 AuthSessionResponse`。
- `requireApproval=true` 且字段有效 -> `202 AuthPendingRegistrationResponse`。
- pending 用户登录 -> `403 account_inactive`。

### 5. Good/Base/Bad Cases

- Good: pending 注册返回 `{ status: "pending" }`，没有 `Set-Cookie`，Web 切回登录并提示等待审核。
- Base: active 注册返回 `{ user }`，设置 session cookie，Web 进入主应用。
- Bad: 先创建 pending 用户再返回 `403 account_inactive`，用户会以为注册失败但邮箱已被占用。

### 6. Tests Required

- API route smoke: pending 注册返回 `202`，无 `Set-Cookie`。
- API route smoke: pending 邮箱再次注册返回 `409`。
- Web typecheck: 注册响应消费 `AuthRegisterResponse` union，不直接把注册响应强转为 `AuthSessionResponse`。

### 7. Wrong vs Correct

#### Wrong

```ts
const body = (await response.json()) as AuthSessionResponse;
setCurrentUser(body.user);
```

#### Correct

```ts
const body = (await response.json()) as AuthRegisterResponse;
if ("status" in body && body.status === "pending") {
  showPendingApprovalMessage();
  return;
}
setCurrentUser(body.user);
```

## GenerationPlan

Agent plan 是 schema 化契约：

- `schemaVersion` 当前为 `GENERATION_PLAN_SCHEMA_VERSION = 1`。
- `jobs` 描述可执行图像任务。
- `edges` 描述依赖 DAG。
- source job 被下游依赖时 count 必须为 `1`，该规则由 API planner/executor 校验。
- 每个 job 最多 `MAX_GENERATION_JOB_REFERENCES` 张参考图，总图数最多 `MAX_GENERATION_PLAN_IMAGES`。

改 plan 字段时同步：

- `packages/shared/src/generation.ts`
- `apps/api/src/domain/agent/planner.ts`
- `apps/api/src/domain/agent/executor.ts`
- `apps/web/src/features/agent/AgentPlanNodeShape.tsx`
- `apps/web/src/features/canvas/CanvasApp.tsx`

## Scenario: 当前用户积分流水查询

### 1. Scope / Trigger

- Trigger: 新增或修改用户侧积分流水页面、接口、shared response 类型。
- 这是 API、shared、Web 的跨层契约，必须由 `packages/shared/src/credits.ts` 表达响应 shape。

### 2. Signatures

- API: `GET /api/credits/transactions?limit=<positive-int>`
- Domain: `listCreditTransactionsForUser(userId, { limit? })`
- Response: `CreditTransactionListResponse { items: CreditTransaction[]; nextCursor?: string }`

### 3. Contracts

- 接口必须 `requireAuth()`，只读取当前 session 的 `auth.user.id`，不得接收客户端传入的 `userId`。
- `limit` 非正数或缺失时使用默认值，超过上限时在 domain 层 clamp。
- 排序固定为 `createdAt DESC, id DESC`，避免同一时间多条流水时顺序抖动。
- `CreditTransaction.reason` 必须来自 `CREDIT_TRANSACTION_REASONS`，Web label 以该 union 为准。

### 4. Validation & Error Matrix

- 未登录 -> `401 unauthorized`。
- `limit` 缺失、非整数、非正数 -> 使用默认 limit。
- `limit` 超过上限 -> 使用最大 limit。
- 返回体缺少 `items` 或 `items` 不是数组 -> Web 显示积分流水数据异常。

### 5. Good/Base/Bad Cases

- Good: route 只传 `auth.user.id` 给 domain，Web 用 runtime guard 校验 `items` 后再渲染。
- Base: SQLite 与 MySQL 查询都复用同一 `CreditTransaction` response 映射。
- Bad: 前端拼接 `userId` 查询参数，或 Web 直接 `as CreditTransactionListResponse` 后渲染深层字段。

### 6. Tests Required

- API smoke: 匿名请求返回 `401`。
- API smoke: 登录用户只返回自己的流水，按最新时间排序。
- Web check: 积分流水空、加载失败、非法数据都有稳定状态。
- Typecheck/build: shared、API、Web 全部通过。

### 7. Wrong vs Correct

#### Wrong

```ts
await listCreditTransactionsForUser(c.req.query("userId") ?? "");
```

#### Correct

```ts
const auth = await requireAuth(c);
if (!auth.ok) return auth.response;
return c.json(await listCreditTransactionsForUser(auth.user.id, { limit }));
```

## Scenario: 兑换码积分兑换

### 1. Scope / Trigger

- Trigger: 新增或修改兑换码生成、校验、后台管理或用户兑换入口。
- 这是 shared、API、DB、Web 的跨层契约，码值格式和积分流水字段必须保持一致。

### 2. Signatures

- Shared constant: `REDEMPTION_CODE_PREFIX = "CC"`。
- API: `POST /api/credits/redeem`，请求 `RedeemCreditCodeRequest { code: string }`。
- Admin API: `POST /api/admin/redemption-codes`，请求 `AdminCreateRedemptionCodesRequest { credits: number; count: number; expiresAt?: string }`。
- Response: `RedeemCreditCodeResponse { user; transaction; redemption }`，其中 `redemption.codeShort` 是短码展示值。

### 3. Contracts

- 码值格式固定为 `CC-XXXX-XXXX-XXXX`。
- 字符集排除易混淆字符：不使用 `O`、`0`、`I`、`1`。
- 码值生成和用户输入校验都必须引用 shared 的 `REDEMPTION_CODE_PREFIX`，不得在 Web/API 各自散落硬编码前缀。
- 用户侧积分流水只展示短码；后台兑换码列表可展示完整码。
- 兑换成功必须同事务更新用户积分、写入 `credit_transactions(reason=redemption_code)`、写入 `credit_redemptions`、回写兑换码兑换状态。

### 4. Validation & Error Matrix

- 空码或格式不符合 `CC-XXXX-XXXX-XXXX` -> `400 invalid_redemption_code`。
- 不存在 -> `404 redemption_code_not_found`。
- 已停用 -> `400 redemption_code_disabled`。
- 已过期 -> `400 redemption_code_expired`。
- 已被任意用户兑换 -> `409 redemption_code_redeemed`。
- 创建数量不在 `1..200` 或积分不在 `1..10000` -> `400 invalid_admin_redemption_code`。

### 5. Good/Base/Bad Cases

- Good: 后台生成 `CC-ABCD-EFGH-JKLM`，用户输入小写或带空格时服务端 `trim().toUpperCase()` 后兑换。
- Base: 管理员批量生成多个未过期 active 码，用户成功兑换一个码后余额和流水同时刷新。
- Bad: 后端生成 `CC-`，但 Web 占位符仍提示旧前缀，用户会按错误格式输入。

### 6. Tests Required

- API smoke: 生成码以 `REDEMPTION_CODE_PREFIX` 开头，格式匹配。
- API smoke: 非 `CC-` 前缀返回 `invalid_redemption_code`。
- API integration: 成功兑换后余额、`credit_transactions`、`credit_redemptions` 和 `redemption_codes.redeemed_at` 同步落库。
- Web check: 后台生成结果和积分中心占位符都显示 `CC-XXXX-XXXX-XXXX`。
- Typecheck/build: shared、API、Web 全部通过。

### 7. Wrong vs Correct

#### Wrong

```ts
const REDEMPTION_CODE_PATTERN = /^GIC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u;
```

#### Correct

```ts
const REDEMPTION_CODE_PATTERN = new RegExp(`^${REDEMPTION_CODE_PREFIX}-...$`, "u");
```

## 向后兼容

- 旧字段需要保留读兼容时，API/Web 都要接受 legacy 形态。例：edit request 同时支持 `referenceImage` 和 `referenceImages`、`referenceAssetId` 和 `referenceAssetIds`。
- 新增字段优先 optional，再由 API/domain 设置默认。
- 改保存到项目快照或 tldraw shape 的契约时，必须保留旧快照恢复路径。

## 避免

- Web/API 各自定义同名 interface。
- 用 number/string 魔法值代替 shared union。
- 修改 shared 常量但不搜索所有使用方。
