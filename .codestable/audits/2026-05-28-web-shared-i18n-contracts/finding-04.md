---
doc_type: audit-finding
audit: 2026-05-28-web-shared-i18n-contracts
finding_id: "arch-drift-04"
nature: arch-drift
severity: P2
confidence: medium
suggested_action: cs-refactor
status: resolved
---

# Finding 04：API guard 覆盖范围不均，多个新前端域回到本地浅校验

## 速答

`shared/api/generation.ts` 只覆盖生成、Gallery、积分、兑换码等部分响应；Prompt Pool、Provider Config、Agent Skill 等新前端域没有同级 guard，调用点只能本地浅校验或泛型强转。

## 关键证据

- `apps/web/src/shared/api/generation.ts:40` — shared 提供 `isGenerationResponse`。
- `apps/web/src/shared/api/generation.ts:69` — shared 提供 `isGalleryResponse`。
- `apps/web/src/shared/api/generation.ts:73` — shared 提供 `isCreditTransactionListResponse`。
- `apps/web/src/shared/api/generation.ts:77` — shared 提供 `isRedemptionCodeListResponse`。
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx:140` — Provider Config 仍用 `as ProviderConfigResponse`。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:683` — Agent Skill list 仍用 `as AgentSkillListResponse`。
- `apps/web/src/features/pool/PromptPoolPage.tsx:107` — Prompt Pool 只检查 `Array.isArray(body.items) || body.summary`。

## 影响

前端契约校验分散后，各模块会逐渐形成不同强度的防线。新增 API 域越多，越容易重复出现强转和浅校验。

## 修复方向

把响应 guard 按 API 域放入 `apps/web/src/shared/api/*` 或 `packages/shared` 可复用 parser，禁止 feature 直接 `as ResponseType` 消费外部 JSON。

## 建议动作

`cs-refactor`，因为这是共享契约边界漂移治理。
