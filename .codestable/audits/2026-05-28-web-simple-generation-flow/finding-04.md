---
doc_type: audit-finding
audit: 2026-05-28-web-simple-generation-flow
finding_id: "bug-04"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 04：生成轮询没有最大等待时间或最大次数

## 速答

`pollGenerationUntilComplete` 使用无限 `while (true)`，只在记录变成非 active 或 signal abort 时退出；服务端若长期返回 pending/running，页面会一直生成中。

## 关键证据

- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:427` — 非终态响应进入 `await pollGenerationUntilComplete(...)`。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:450` — `async function pollGenerationUntilComplete(recordId: string, signal: AbortSignal)` —— 轮询逻辑在页面内。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:451` — `while (true)` —— 没有次数或总时长限制。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:463` — `if (!isActiveGenerationRecord(body.record)) { return body.record; }` —— 只靠终态记录退出。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:151` — unmount cleanup 会 abort 当前 controller，但用户不离开页面时没有超时兜底。

## 影响

如果 API 任务丢失、后端轮询状态卡住或网络层一直返回 active 记录，用户会长时间无法结束当前生成，只能刷新或开始新请求。

## 修复方向

增加最大轮询时长/次数，并在超时后提供“稍后从 Gallery/历史恢复”或重试入口。

## 建议动作

`cs-issue`，因为这是异常状态下的可恢复性 bug。
