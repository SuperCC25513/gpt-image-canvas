# Hook 规范

## Effect 职责

- 一个 `useEffect` 做一类副作用：数据加载、键盘监听、timer 清理、路由监听、WebSocket 生命周期分开写。
- 异步加载在 effect 内创建 `AbortController`，cleanup 时 abort。参考 `GalleryPage`、`PromptPoolPage`、`ProviderConfigDialog`。
- 事件监听必须 cleanup，参考 modal Escape 关闭逻辑。
- timer ref 必须 unmount 清理，参考 Gallery/Prompt Pool 的 `statusTimerRef`、`copiedTimerRef`。

## Fetch 模式

```ts
const controller = new AbortController();
try {
  const response = await fetch("/api/...", { signal: controller.signal });
  if (!response.ok) throw new Error(await readError(response, locale, t));
  const body = await response.json();
  if (!controller.signal.aborted) setState(body);
} finally {
  if (!controller.signal.aborted) setIsLoading(false);
}
```

要点：

- abort 后不写 state。
- response shape 要做最低限度 runtime 检查，例：Gallery 检查 `Array.isArray(body.items)`。
- POST JSON 必须带 `Content-Type: application/json`。
- 错误用 localized helper 或 feature fallback。

## Memo 和 deferred

- 昂贵派生值用 `useMemo`：筛选列表、Map、Set、列布局、formatter。
- 大列表搜索输入用 `useDeferredValue`，参考 Prompt Pool 和收藏面板。
- 函数作为 effect 依赖或传给稳定子组件时用 `useCallback`，参考 `loadProviderConfig`、`loadAgentConfig`。

## Custom Hook 形态

当前 custom hook 很少，只有局部 UI hook，如 `usePromptPoolColumnCount()`。新增 hook 时：

- 只封装跨组件复用或复杂生命周期。
- 返回稳定、命名清楚的数据和 action。
- 不把 feature 业务拆到 generic hook 里造成追踪困难。

## 避免

- 在 effect 里做用户点击触发逻辑；点击、保存、删除用 event handler。
- effect 依赖里直接放临时 object/array。
- fetch catch 后无视 abort，导致卸载后 setState。
- 把 `t`、`locale` 缺在依赖数组里；文案变化时 UI 会过期。
