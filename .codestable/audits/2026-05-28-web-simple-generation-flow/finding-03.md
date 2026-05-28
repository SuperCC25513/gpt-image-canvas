---
doc_type: audit-finding
audit: 2026-05-28-web-simple-generation-flow
finding_id: "performance-03"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: resolved
---

# Finding 03：轮询等待函数反复注册 abort listener 且正常完成不移除

## 速答

每次轮询等待都会给同一个 `AbortSignal` 注册一次 abort listener；计时器正常 resolve 后没有移除 listener，长时间 pending 生成会累积监听器。

## 关键证据

- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1296` — `function waitForGenerationPollInterval(signal: AbortSignal): Promise<void>` —— 轮询等待函数每轮调用。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1298` — `const timer = window.setTimeout(resolve, GENERATION_POLL_INTERVAL_MS);` —— 正常路径只 resolve。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1299` — `signal.addEventListener("abort", () => { ... }, { once: true })` —— 每轮新增 abort listener。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1302` — `window.clearTimeout(timer);` —— 只有 abort 路径清理 timer，没有正常完成后的 `removeEventListener`。

## 影响

单次影响小，但卡住的生成会持续轮询，listener 会跟随同一个 `AbortSignal` 累积，直到请求结束或被 abort。

## 修复方向

像 `CanvasApp.waitForGenerationPollInterval` 一样抽出 cleanup，在 timeout resolve 和 abort reject 两条路径都移除 listener。

## 建议动作

`cs-refactor`，因为这是轮询 helper 生命周期整理。
