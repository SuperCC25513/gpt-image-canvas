# 状态管理

## 当前状态形态

项目没有 Redux/Zustand/React Query。状态主要分四类：

- React local state：表单、modal、loading、error、筛选、临时 UI。
- tldraw editor/store：画布 shape、asset、snapshot。
- Server state：项目快照、generation record、Gallery、provider/Agent config。
- 模块级缓存：资产 metadata/preview request、lazy page module promise。

## Local state

- 相关表单字段用对象 state + patch updater，参考 `ProviderConfigDialog` 的 `updateLocalForm()`、`updateAgentForm()`。
- 瞬时 status/toast 用 state + timer ref 清理。
- modal 状态用具体 item/id，而不是多个 boolean 互斥状态，参考 Gallery `selectedItem`、`pendingDeleteItem`。

## Server state

- API 返回是 source of truth；保存成功后用返回 body 回填本地状态。
- 删除/收藏这类明确小操作可做局部乐观更新，但失败要显示 error。
- generation 先创建 canvas placeholder，再轮询 `/api/generations/:id`，终态替换 shape。
- Agent WebSocket 事件驱动 plan/message/preview 状态；重连时保留 connection/run/conversation id。

## tldraw state

- Canvas asset URL 统一走 `canvasAssetStore.resolve()` 和 `assetPreviewUrl()` / `assetDownloadUrl()` helper。
- 自定义 placeholder 和 plan node 都是 shape，不是外部隐藏状态。
- 保存项目快照前过滤 loading placeholder，避免恢复半成品 transient shape。
- 改 shape props 要同步 type guard、shape util props、快照恢复处理。

## 缓存

- `assetMetadataCache` 和 `assetMetadataRequests` 是模块级缓存，用于避免重复 metadata fetch。
- `initialCanvasPreviewWidths` 控制首屏预览宽度。
- 新模块级缓存必须是有界或与资产/id 生命周期一致；不要缓存包含 secret 或用户 prompt 的敏感数据。

## 避免

- 为单页局部状态引入全局 store。
- 在多个 state 分支重复保存同一个 server fact。
- 让 UI 状态成为 API 契约来源；契约应在 shared/API。
- 把 `localStorage` 当主数据源；当前仅 locale 等偏好适合本地存储。
