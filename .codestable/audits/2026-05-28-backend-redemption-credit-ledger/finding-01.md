---
doc_type: audit-finding
audit: 2026-05-28-backend-redemption-credit-ledger
finding_id: "security-01"
nature: security
severity: P2
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：兑换接口按不存在/停用/过期/已兑换返回不同错误，形成兑换码状态 oracle

## 速答

`/api/credits/redeem` 对同一格式的兑换码会区分返回“找不到”“停用”“过期”“已被使用”。兑换码熵较高，直接撞库概率低，但任何登录用户都可以用该接口验证已获得的码值并判断生命周期状态。

## 关键证据

- `apps/api/src/server/routes/redemption-codes.ts:20` — `app.post("/api/credits/redeem", async (c) => {` —— 用户兑换入口。
- `apps/api/src/server/routes/redemption-codes.ts:21` — `const auth = await requireAuth(c);` —— 任意 active 登录用户可调用。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:333` — `const code = tx.select().from(redemptionCodes).where(eq(redemptionCodes.code, normalizedCode)).get();` —— 按完整码值查询。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:335` — `throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);` —— 不存在返回独立错误码。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:479` — `if (code.status !== "active")` —— 停用单独判断。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:480` — `throw new RedemptionCodeDomainError("redemption_code_disabled", "该兑换码已停用。", 400);` —— 停用返回独立错误码。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:482` — `if (code.expiresAt && Date.parse(code.expiresAt) <= Date.parse(now))` —— 过期单独判断。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:483` — `throw new RedemptionCodeDomainError("redemption_code_expired", "该兑换码已过期。", 400);` —— 过期返回独立错误码。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:485` — `if (code.redeemedByUserId || code.redeemedAt)` —— 已兑换单独判断。
- `apps/api/src/domain/redemption-codes/redemption-code-store.ts:486` — `throw new RedemptionCodeDomainError("redemption_code_redeemed", "该兑换码已被使用。", 409);` —— 已兑换返回独立错误码。

## 影响

兑换码格式由校验器限制，随机猜中概率很低；但一旦码值从截图、聊天记录或日志中泄露，任意登录用户都能判断它是否真实存在、是否已被使用、是否过期。若后续加入批量码、短码或外部分发活动，这个 oracle 会提高枚举和社工成功率。

## 修复方向

对用户兑换失败统一返回“兑换码不可用或已失效”，内部日志保留详细原因；同时可按用户/IP 对失败兑换做轻量节流或审计。

## 建议动作

`cs-issue`，因为这是接口安全语义问题，修复需要兼顾用户提示和防枚举。
