# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

### 账号与积分状态

- `AuthMeResponse` 是当前登录用户、积分余额、签到状态和积分设置的服务端事实来源。
- 页面可以通过父级传入的 `accountStatus` 渲染，但不能把它当成长期有效缓存。
- 进入会消耗或展示积分的页面时，例如简单生成页和积分中心，必须重新请求 `/api/auth/me`。
- 生成、取消、签到、兑换码兑换，以及后台调整当前登录用户积分后，必须刷新当前账号状态。
- 后台用户列表中的 `AdminUserSummary.credits` 只能代表后台表格行状态；如果调整的是当前登录用户，还要刷新全局 `accountStatus`。

```typescript
useEffect(() => {
  const controller = new AbortController();
  void onRefreshAccountStatus(controller.signal);
  return () => controller.abort();
}, [onRefreshAccountStatus]);
```

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- 只更新后台用户列表里的积分，忘记刷新当前会话的 `accountStatus`，会导致顶部账户菜单、积分中心或简单生成页继续显示旧余额。
- 简单生成页只读取父级缓存，不在进入页面时重新拉取 `/api/auth/me`，会导致其他页面或其他标签页调整积分后显示过期余额。
