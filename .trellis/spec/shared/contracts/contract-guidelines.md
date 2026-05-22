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

## 向后兼容

- 旧字段需要保留读兼容时，API/Web 都要接受 legacy 形态。例：edit request 同时支持 `referenceImage` 和 `referenceImages`、`referenceAssetId` 和 `referenceAssetIds`。
- 新增字段优先 optional，再由 API/domain 设置默认。
- 改保存到项目快照或 tldraw shape 的契约时，必须保留旧快照恢复路径。

## 避免

- Web/API 各自定义同名 interface。
- 用 number/string 魔法值代替 shared union。
- 修改 shared 常量但不搜索所有使用方。
