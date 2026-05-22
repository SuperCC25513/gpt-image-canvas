# 组件规范

## 产品视觉

遵守 `docs/DESIGN.md`：

- 应用第一屏是工作台/画布，不做营销 landing hero。
- 使用 warm paper、dark ink、copper accent、teal focus 这套 token。
- 避免通用 SaaS 蓝紫渐变、玻璃、装饰 blob。
- 控件要密集、可扫读、尺寸稳定。

## React 组件模式

- 组件靠近 feature。例：`GalleryPage` 只接收 `onDeleted`、`onReuse`，内部管理列表、筛选、导出和 modal。
- Dialog 用 portal 渲染到 `document.body`，Escape 关闭，参考 `ProviderConfigDialog`、Gallery preview/delete modal。
- 图标优先从 `lucide-react` 导入；按钮需有可读 label 或 `aria-label`。
- 动态列表的 action handler 可组合成对象传给子组件，参考 `GalleryActionHandlers` / `GallerySelectionHandlers`。
- 大型可选页面用 `lazy` + `Suspense`，并提供 preload，参考 `LazyGalleryPage`、`LazyPromptPoolPage`。

## tldraw shape

- 自定义 shape 用 `BaseBoxShapeUtil`、`RecordProps`、`declare module "@tldraw/tlschema"` 扩展 props。
- shape props 必须可序列化，兼容项目快照。
- 快照读取必须对坏数据容错，参考 `AgentPlanNodeShape.tsx` 的 `isGenerationPlan()` 和坏计划展示。
- loading/failed canvas 状态用真实 shape 表示，不放隐藏临时 DOM，参考 `GenerationPlaceholderShape.tsx`。

## 文案和 i18n

- 用户可见文案放 `shared/i18n/index.tsx`，同时写 `zh-CN` 和 `en`。
- 组件内只允许 brand、文件扩展名、model id、API value 等稳定技术字面量。
- 错误优先显示 localized API error；网络/未知错误用 feature 级 fallback。

## CSS 和交互

- 使用已有 token 和 class 前缀。
- 按钮/卡片/缩略图/toolbar 需稳定尺寸，避免 loading、hover、错误文本导致布局跳动。
- 微交互用 CSS transition；当前项目不引入 motion/framer-motion。
- 触摸/图标按钮至少有实际点击热区，参考 `base.css` 的 `::after` 扩展 hit area。

## 避免

- 卡片嵌套卡片、页面大段浮动卡片。
- 组件内硬编码长中文/英文文案。
- 用 object literal/inline function 造成子组件或 effect 重复运行，必要时 `useMemo` / `useCallback`。
- 自定义 SVG 图标替代已有 lucide 图标，除非是 shape 内的专用视觉资产。
