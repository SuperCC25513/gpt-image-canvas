---
doc_type: audit-finding
audit: 2026-05-28-web-canvas-agent-runtime
finding_id: "bug-01"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: deferred
---

# Finding 01：自动保存请求乱序可能用旧快照覆盖新画布

## 速答

画布自动保存只在前端用 `saveRequestRef` 控制状态显示，没有给 `/api/project` PUT 带版本或取消旧请求；旧请求晚到服务端时可能覆盖较新的画布快照。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:3615` — `const requestId = saveRequestRef.current + 1;` —— 这个 ID 只存在于前端状态控制里。
- `apps/web/src/features/canvas/CanvasApp.tsx:3621` — `fetch("/api/project", { method: "PUT", ... snapshot: filterLoadingPlaceholdersFromSnapshot(editor.getSnapshot()) })` —— 保存请求没有 revision、updatedAt 条件或幂等序号。
- `apps/web/src/features/canvas/CanvasApp.tsx:3635` — `if (saveRequestRef.current === requestId) { setSaveStatus("saved"); }` —— 乱序保护只影响 UI 状态，不影响服务端已经收到的写入。
- `apps/web/src/features/canvas/CanvasApp.tsx:4117` — `editor.store.listen(... window.setTimeout(() => { void saveProjectSnapshot(editor); }, AUTOSAVE_DEBOUNCE_MS))` —— 连续编辑会产生多个异步 PUT，网络慢时可乱序完成。

## 影响

用户连续编辑时，较早快照的 PUT 如果晚于较新快照到达 API，最终项目状态可能回退。画布是核心工作产物，影响属于数据可靠性问题。

## 修复方向

让保存请求携带服务端可判定的新旧版本，或在前端取消/串行化旧 PUT，确保旧快照不能覆盖新快照。

## 建议动作

`cs-issue`，因为这是可触发的数据一致性 bug。
