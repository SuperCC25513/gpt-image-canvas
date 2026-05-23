# 简单生图模式技术设计

## 目标边界

新增独立 `/generate` 简单生图页，保留当前 `/` 首页和 `/canvas` 画布页。简单页只做文生图第一版，复用现有生成接口、Gallery 资产接口、账号/积分/Provider 状态、i18n 和设计 token。

## 路由与导航

- 扩展 `AppRoute`：新增 `generate`。
- `routeFromLocation()` 识别 `/generate`。
- `pathForRoute()` 输出 `/generate`。
- `TopNavigation` 新增“简单生成”入口；`/canvas` 仍为“画布”。
- HomePage 不被替换；如有创作入口，应优先指向 `/generate`，Gallery 入口保留。
- 简单页内提供“画布模式”动作，导航到 `/canvas`。

## 页面结构

新增 feature：

- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx`
- `apps/web/src/styles/simple-generation.css`

页面分区：

- 顶部工作区标题与 Provider 状态。
- 主输入区：提示词、提示词 starter、尺寸预设、风格、数量、生成按钮。
- 高级区：质量、输出格式、公开开关；默认折叠。
- 状态区：账号/积分、校验错误、生成中、失败、成功提示。
- 结果区：最近生成 8 张图，桌面优先 2x4 稳定网格，移动端响应式 2 列或 1 列。
- 结果动作：下载、复用提示词、去画布继续编辑、查看更多。

## 参数与默认值

简单页使用独立默认值，不改变画布默认值：

- `sizePresetId`: `square-1k`
- `quality`: `auto`
- `outputFormat`: `png`
- `count`: `1`
- `presetId`: `none`
- `isPublic`: `false`

参数选项继续来自 `@gpt-image-canvas/shared`：

- `SIZE_PRESETS`
- `STYLE_PRESETS`
- `IMAGE_QUALITIES`
- `OUTPUT_FORMATS`
- `GENERATION_COUNTS`

## 生成数据流

1. 用户提交表单。
2. 前端校验提示词、尺寸、账号、积分、最大张数。
3. `POST /api/images/generate`，请求体使用现有 `GenerateImageRequest` 字段。
4. 如果返回运行中记录，轮询 `/api/generations/:id` 直到终态。
5. 终态成功后把成功输出追加到简单页结果区，并刷新 `/api/gallery`。
6. 失败或部分失败显示可理解错误，不清空已有结果。

简单页不创建 tldraw placeholder；画布页继续使用现有 placeholder 机制。

## 最近结果区

结果来源优先级：

1. 当前简单页会话中新生成的成功输出。
2. `/api/gallery` 返回的最近作品，按接口现有排序补足到 8 张。

结果项使用 `GalleryImageItem` 或由 `GenerationRecord.outputs` 映射出的等价视图模型。缩略图使用：

- `assetPreviewUrl(asset.id, 512)` 或根据布局选择合适宽度。
- 下载使用 `assetDownloadUrl(asset.id)`。

“查看更多”使用应用内导航到 `/gallery`，开发环境地址即 `http://127.0.0.1:5173/gallery`。

## 去画布继续编辑

用户点击结果区的“去画布继续编辑”后才进入画布，不自动跳转。

实现约束：

- 简单页保存待导入结果的 asset id 列表到 App 顶层一次性状态。
- 导航到 `/canvas` 后，画布 editor ready 时消费这批待导入结果。
- 如果对应 asset 已被插入过，则定位到已有 shape；否则插入图片。
- 消费后清空待导入状态，避免重复点击无提示地重复插入。

若第一版实现复杂度过高，可先实现“进入画布并定位/提示从 Gallery 使用”，但必须满足验收中的不重复插入约束；实现计划默认按自动插入或定位做。

## 复用现有逻辑

应提取或复用 CanvasApp 中可共享的纯函数，避免复制分叉：

- 生成响应 guard。
- 终态/运行中判断。
- 成功输出提取。
- 下载 URL / 预览 URL helper。
- 尺寸校验消息。
- API 错误读取。

不把 tldraw 专用 placeholder、shape、selection 逻辑带入简单页。

## 兼容性

- 不改变 API 契约。
- 不改变现有画布页默认值、生成面板、Agent、参考图编辑。
- 不改变 Gallery 数据结构。
- 不改变 Provider 配置路由和优先级。

## UI 和可访问性

- 视觉沿用 warm paper、ink、copper、teal token。
- 不做营销 hero；`/generate` 第一屏就是可操作生图界面。
- 控件保持稳定尺寸，生成中不撑开按钮。
- 结果图使用 neutral image outline。
- 移动端控件触摸区至少约 44px。
- 所有新增文案写入 `zh-CN` 和 `en`。

## 风险

- `CanvasApp.tsx` 当前聚合大量状态，抽取共享生成 helper 时要小步改，避免影响画布流程。
- 简单页与画布页都需要读取账号/Provider 状态，注意不要引入重复请求瀑布。
- 待导入结果跨路由状态必须只消费一次，否则会重复插入画布。
