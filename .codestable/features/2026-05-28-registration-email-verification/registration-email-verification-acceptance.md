# Registration Email Verification 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-29
> 关联方案 doc：.codestable/features/2026-05-28-registration-email-verification/registration-email-verification-design.md

## 1. 接口契约核对

对照方案第 2.1 节名词层逐一核查：

**接口示例逐项核对**：

- [x] `POST /api/auth/registration-email-verifications` 已新增，接收 `{ email, locale? }`，成功返回 `{ ok: true, expiresAt }`。
- [x] `POST /api/auth/register` 已要求 `emailVerificationCode`，缺失或格式不对返回 `email_verification_required`，不创建用户。
- [x] Mail Gateway 调用使用 `POST /v1/emails/send`、`X-Api-Key` 和 `type="verification_code"`，验证码明文只出现在发送给网关的请求体中，不返回前端。

**名词层“现状 -> 变化”逐项核对**：

- [x] shared auth contract：`RegisterRequest`、`RegisterEmailVerificationRequest`、`RegisterEmailVerificationResponse` 和验证码错误码已同步。
- [x] API validation：注册 payload 增加 6 位验证码校验；发送验证码 payload 单独校验邮箱和 locale。
- [x] auth domain：新增验证码生成、HMAC 哈希、发送节流、尝试次数、过期、消费和网关错误收敛。
- [x] persistence：SQLite / MySQL 新增 `registration_email_verifications` 挑战表和过期时间索引。
- [x] Web auth form：注册页新增邮箱验证码输入、发送按钮、冷却状态、成功/失败提示和 zh/en 文案。

**流程图核对**：

- [x] 发送验证码流程：payload 校验 -> 读取 auth settings -> `allowRegistration` -> 邮箱后缀 -> 发送节流 -> 写 challenge -> 调 Mail Gateway。
- [x] 注册流程：payload 校验 -> `allowRegistration` -> 邮箱后缀 -> 邮箱查重 -> 消费同邮箱 challenge -> 原有创建用户 / 积分 / 审核 / session 分支。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] 注册页能向当前邮箱发送验证码，并展示发送成功和重发冷却状态。
- [x] 缺验证码、错误验证码、过期验证码都不会创建用户、积分流水或 session。
- [x] 验证码通过后，`allowRegistration`、邮箱后缀、`requireApproval`、注册送积分和 session 语义保持原有分支。
- [x] 网关缺配置、超时或非 2xx 响应收敛为稳定 auth 错误码，不暴露 API key、内部 URL 或 provider 原始错误。

**明确不做逐项核对**：

- [x] 未新增登录二次验证、忘记密码、修改邮箱、邀请注册、邮件订阅或管理员代发邮件。
- [x] 未在本仓库接入 Resend / Mailgun SDK，也未读取服务商 API key 环境变量。
- [x] 未新增后台邮件网关配置 UI；配置仍来自运行时环境变量。
- [x] 未改变邮箱后缀支持列表、管理员审核或注册送积分规则。

**关键决策落地**：

- [x] 新增“发送验证码”入口，注册入口只消费验证码，避免把发邮件副作用混入创建用户 endpoint。
- [x] challenge 保存在数据库，支持 SQLite / MySQL 和多进程模式；没有使用内存 Map。
- [x] 验证码只作为注册创建前门禁，保留现有注册响应形态。
- [x] Mail Gateway 错误统一折叠为本地 auth 错误码，且失败时恢复原 challenge 或删除新 challenge。

**流程级约束核对**：

- [x] 错误语义：required / invalid / expired / rate_limited / unavailable 均有本地错误码。
- [x] 顺序约束：发送和注册都先复用开放注册和邮箱后缀策略；验证码只在用户尚不存在时消费。
- [x] 数据一致性：验证码在创建用户前消费；用户创建失败不恢复验证码，用户可重新发送；网关发送失败不会留下不可用 challenge 或触发无效冷却。
- [x] 安全：验证码不进响应、不存明文、不暴露网关 key 和 URL。

**挂载点反向核对（可卸载性）**：

- [x] Shared contract：`packages/shared/src/auth.ts`。
- [x] API validation / route：`apps/api/src/server/http/validation.ts`、`apps/api/src/server/routes/auth.ts`。
- [x] Auth domain：`apps/api/src/domain/auth/registration-email-verification.ts`、`auth-errors.ts`、`auth-store.ts`。
- [x] Persistence：`schema.ts`、`sqlite-database.ts`、`mysql-database.ts`。
- [x] Web auth surface：`apps/web/src/App.tsx`、`apps/web/src/shared/i18n/index.tsx`、`apps/web/src/styles/auth.css`。
- [x] Docs：`.env.example`、`docs/RELIABILITY.md`、`docs/SECURITY.md`、`docs/generated/db-schema.md`、CodeStable architecture / requirement。

## 3. 验收场景核对

- [x] **S1**：支持域名邮箱请求发送验证码 -> 调用 Mail Gateway `verification_code`，返回 200 + `expiresAt`，响应不包含验证码明文。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S2**：Mail Gateway 未配置或不可用 -> 返回稳定错误码，不暴露 API key、内部 URL 或 provider 原始错误，且不留下不可用 challenge。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S3**：同一邮箱冷却时间内重复请求 -> 返回 429 + `email_verification_rate_limited`，且不重复调用 Mail Gateway。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S4**：注册缺少 `emailVerificationCode` -> 返回 `email_verification_required`，不新增用户和积分流水。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S5**：验证码错误或尝试次数超限 -> 返回 `email_verification_invalid`，不新增用户和积分流水。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S6**：验证码过期 -> 返回 `email_verification_expired`，不新增用户和积分流水。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S7**：正确邮箱和未过期验证码 -> 创建用户；`requireApproval=false` 返回 201 + session，`requireApproval=true` 返回 202 pending；注册送积分保持事务一致。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S8**：验证码属于邮箱 A 但注册邮箱 B -> 返回验证码错误，不创建邮箱 B 用户。
  - 证据来源：`smoke:auth-registration-email-verification`。
  - 结果：通过。
- [x] **S9**：邮箱域名不支持或注册关闭 -> 发送验证码和注册都沿用 `email_domain_not_allowed` / `registration_disabled`，且不发送邮件。
  - 证据来源：`smoke:auth-registration-email-verification`、`smoke:auth-registration-domain`。
  - 结果：通过。
- [x] **S10**：前端桌面和移动注册页 -> 邮箱、发送按钮、验证码输入、密码和提交按钮不重叠，状态可读。
  - 证据来源：内置 Browser；desktop 1280x900 无 `.auth-shell` 水平溢出，发送验证码后显示成功状态和重发倒计时；mobile 390x844 下验证码 grid 为单列，`.auth-shell` 水平溢出为空。
  - 结果：通过。
- [x] **S11**：范围守护。
  - 证据来源：代码核对和 typecheck。
  - 结果：未接入 Resend/Mailgun SDK，未新增后台邮件配置 UI，登录、退出、Codex OAuth 和管理员 bootstrap 不要求验证码。

**已执行验证**：

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:auth-registration-email-verification`
- [x] `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:auth-registration-domain`
- [x] `docker compose config --quiet --no-env-resolution`
- [x] `git diff --check`
- [x] 内置 Browser：desktop 1280x900、mobile 390x844。

## 4. 术语一致性

- `registration email verification` / `注册邮箱验证码`：design、requirement、architecture、API、Web 文案一致。
- `registration_email_verifications`：数据库表、schema 文档和代码命名一致。
- `Mail Gateway`：只表示 cc-base 邮件网关；未把服务商 provider 名词引入本仓库公开契约。
- 防冲突：邮箱后缀 allowlist 和邮箱验证码是两个不同门禁，文档和代码分支均保留区分。

## 5. 架构归并

- [x] `.codestable/architecture/ARCHITECTURE.md`：已加入注册邮箱验证码、验证挑战、Mail Gateway、持久化表和注册页流程。
- [x] `.codestable/requirements/registration-email-verification.md`：已从 draft 更新为 current，并记录本 feature 的能力边界。
- [x] `.codestable/requirements/VISION.md`：已索引注册邮箱验证码 requirement。
- [x] `docs/RELIABILITY.md`：已记录 Mail Gateway 运行时变量、节流、过期、失败语义和本地 smoke。
- [x] `docs/SECURITY.md`：已记录 `MAIL_GATEWAY_API_KEY` 的 secret 边界和不暴露规则。
- [x] `docs/generated/db-schema.md`：已记录 `registration_email_verifications` 表。
- [x] `.codestable/attention.md`：无需更新。没有新增每次开发都必须记住的本地命令或工具陷阱；smoke 仍沿用已有 `USE_MYSQL=false` 注意事项。

## 6. requirement 回写

- [x] `.codestable/requirements/registration-email-verification.md` 已更新为 current。
- [x] `.codestable/requirements/VISION.md` 已加入 requirement 索引。

## 7. roadmap 回写

- [x] 本 feature 未归属已有 roadmap，无需 roadmap 回写。

## 8. attention.md 候选盘点

- [x] 无候选：本次新增的 Mail Gateway 配置已写入 `.env.example`、可靠性文档和安全文档，不属于每次 CodeStable 启动都必须读取的一句话陷阱。

## 9. 遗留

- 邮件验证码 challenge 当前保存在 SQLite/MySQL；后续如果引入 Redis，可单独评估把短 TTL 验证码状态迁移到 Redis，降低数据库短期状态写入。
- 当前只做注册邮箱验证码，不包含登录 MFA、找回密码或修改邮箱验证。
