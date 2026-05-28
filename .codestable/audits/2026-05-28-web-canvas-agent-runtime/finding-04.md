---
doc_type: audit-finding
audit: 2026-05-28-web-canvas-agent-runtime
finding_id: "maintainability-04"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: deferred
---

# Finding 04：CanvasApp 聚合太多运行时职责，局部审计和回归成本高

## 速答

`CanvasApp.tsx` 同时承载路由、账号、项目保存、生成、参考图、收藏、Agent 历史、WebSocket 和 tldraw 集成，单文件审计面过大。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:3219` — `export function App({ currentUser, sessionError = "", onLogout }: CanvasAppProps)` —— 主组件入口在一个大文件内。
- `apps/web/src/features/canvas/CanvasApp.tsx:3251` — `const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());` —— 路由状态在画布组件内。
- `apps/web/src/features/canvas/CanvasApp.tsx:3268` — `const [projectSnapshot, setProjectSnapshot] = useState<PersistedSnapshot | undefined>();` —— 项目持久化状态在同一组件内。
- `apps/web/src/features/canvas/CanvasApp.tsx:3305` — `const [agentConfig, setAgentConfig] = useState<AgentLlmConfigView | null>(null);` —— Agent 配置和运行状态也在同一组件内。
- `apps/web/src/features/canvas/CanvasApp.tsx:3331` — `const agentSocketRef = useRef<WebSocket | null>(null);` —— WebSocket 生命周期和 UI 状态同处一个组件。

## 影响

这会放大后续变更风险：任何生成、Agent、导航或保存调整都需要重新理解同一 7k+ 行文件，测试切片也难以按职责收敛。

## 修复方向

按职责提取 `project autosave`、`generation runtime`、`agent socket runtime` 和 `route/account shell` 的 hook 或子模块，先切运行时逻辑，保持 UI 行为不变。

## 建议动作

`cs-refactor`，因为这是行为不变的结构风险治理。
