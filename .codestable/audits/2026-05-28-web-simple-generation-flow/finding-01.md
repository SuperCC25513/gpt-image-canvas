---
doc_type: audit-finding
audit: 2026-05-28-web-simple-generation-flow
finding_id: "security-01"
nature: security
severity: P1
confidence: medium
suggested_action: cs-issue
status: dismissed
---

# Finding 01：简易生成硬编码公开发布，用户没有私密选项

## 速答

已驳回。用户在 2026-05-28 明确确认：画布和简易生成入口默认公开是当前产品决策，不作为 bug 修复。

## 关键证据

- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:121` — `const publishGeneration = true;` —— 公开状态被硬编码。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:390` — `const requestBody: Record<string, unknown> = { ... }` —— 生成请求体在页面内组装。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:402` — `isPublic: publishGeneration` —— 请求固定使用公开值。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:781` — `<div className="simple-publish-control">` —— UI 是公开状态控件。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:788` — `onClick={showPrivacyLockedNotice}` —— 点击只展示提示，不切换私密。

## 影响

不作为当前审计风险项。后续如果产品决策改回“默认私密”，再重新打开对应审计或走 `cs-feat-design` 对齐公开/私密语义。

## 修复方向

无代码修复。保留证据用于追溯这次审计误报。

## 建议动作

无需动作，状态为 `dismissed`。
