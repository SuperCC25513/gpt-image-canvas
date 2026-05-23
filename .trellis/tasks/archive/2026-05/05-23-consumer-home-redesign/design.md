# To C 首页重设计方案

## 设计目标

首页从“工具说明页”改成“创作启动页”。首屏优先传达三件事：

1. 现在就能开始生成。
2. 想深做可以进画布。
3. 没灵感可以逛图片广场。

页面保持项目既有 warm paper、ink、copper、teal、editorial 字体，但降低后台感和工程感，减少流程解释，增加作品预览和行动入口。

## 页面结构

### 首屏：创作入口

左侧为短标题和行动按钮：

- Kicker：`今天想做什么图？`
- H1：`从一个想法开始生成`
- Deck：强调“写一句描述，先生成；想继续改，再放进画布；没灵感，去广场看看。”
- 主 CTA：`开始简单生成`
- 次 CTA：`进入画布`
- 第三入口：`逛图片广场`

首屏不出现服务状态、API、密钥、本地运行、fallback 或管理员语境。

右侧为灵感视觉：

- 优先展示公开广场最新 6-8 张作品，形成轻量拼贴/瀑布预览。
- 每张图来自 `assetPreviewUrl(item.asset.id, width)`，使用中等预览宽度，避免拉原图。
- 图片区域点击或按钮进入图片广场。
- 无公开作品或加载失败时，使用 `docs/assets/app-preview.png` 和 3-4 个静态灵感 prompt chip 回退。

### 第二段：三条开始路径

三张并列行动卡：

- `快速出图`：一句话、选尺寸、立刻看结果。按钮进简单生成。
- `画布深做`：参考图、排版、局部修改、Agent 计划。按钮进画布。
- `去找灵感`：看公开作品和提示词，找到方向后再生成。按钮进图片广场。

每张卡有 lucide 图标、短标题、两行以内说明、一个明确按钮。卡片是重复项目，允许使用卡片样式，半径不超过 8px。

### 第三段：场景灵感

用更 C 端的用例词替代“工作流证据”：

- 头像/角色
- 产品图/海报
- 社交封面
- 空间/氛围
- 插画/壁纸

这些只做灵感入口，不在本任务内实现跨页预填。

## 技术设计

### React 边界

修改 `apps/web/src/features/home/HomePage.tsx`：

- 移除 Provider 状态展示和相关图标/文案依赖。
- `HomePageProps` 新增：
  - `onOpenCanvas: () => void`
  - `onOpenPublicGallery: () => void`
- 保留 `authError`，只在必要时显示简短创作错误提示。
- 可移除未使用的 `authStatus`、`isAuthLoading`，除非实现中仍需要错误状态来源。
- 新增 public gallery preview state：
  - `publicItems: GalleryImageItem[]`
  - `isPublicPreviewLoading: boolean`
- `useEffect` 请求 `/api/gallery/public?limit=8`。
- 使用 `isGalleryResponse()` 做 runtime guard。
- 使用 `AbortController`，卸载时取消请求。
- preview 加载失败不阻断首页，不弹大错误；仅走回退视觉。

### 路由接入

修改 `apps/web/src/features/canvas/CanvasApp.tsx`：

- 给 `HomePage` 传入：
  - `onOpenGenerate={() => navigateToRoute("generate")}`
  - `onOpenCanvas={() => navigateToRoute("canvas")}`
  - `onOpenPublicGallery={() => navigateToRoute("publicGallery")}`
- 私有 `Gallery` 不作为首页主 CTA；顶部导航仍保留。

### 登录状态展示

修改 `apps/web/src/App.tsx` 和顶部导航相关组件：

- 删除当前主应用外层右下角 `.auth-user-bar` 浮块。
- 把当前用户信息传入 `CanvasApp`，再传给 `TopNavigation`。
- 在顶部导航右侧语言切换附近展示账户名，例如 `Local Admin`。
- 退出动作仍保留在顶部账户区域，可做成紧凑按钮或账户菜单；不能继续占用页面右下角。
- 登录错误/会话提示不再用右下浮块承载。若仍需显示，使用顶部账户区的 warning tone 或后续页面内状态，不阻挡首页内容。
- 移动端顶部账户区域需避免挤压主导航；必要时显示短名称和图标按钮。

### 样式边界

修改 `apps/web/src/styles/home.css`：

- 可重写大部分 `home-*` 结构样式，但保留 class 前缀。
- 首屏使用响应式 grid：桌面左右两列，移动单列。
- CTA 按钮使用稳定高度和明确 hit area。
- 图片预览使用固定 aspect-ratio、neutral outline、object-fit cover。
- 移动端三入口卡片堆叠，图片预览可横向滚动或紧凑网格。
- 删除 marquee、服务状态、工程化 proof line、ops/trust panel 等不符合本次 To C 目标的样式。

修改 `apps/web/src/styles/auth.css` / `layout*.css`：

- 删除或停用 `.auth-user-bar` 的 fixed bottom 样式。
- 为顶部账户区增加稳定高度、可点击区域和移动端换行/收缩规则。
- 避免账户名与语言切换、导航项重叠。

### i18n

修改 `apps/web/src/shared/i18n/index.tsx`：

- 替换首页文案为 C 端创作语言。
- 同步 `zh-CN` 和 `en`。
- 删除不再使用的首页文案 key，或保留但不再引用；实现时优先清理无用 key，降低噪音。

## 数据与失败处理

- 公开作品预览是增强体验，不是首页可用性的前置条件。
- 请求失败、返回空、返回非法数据时：首页仍显示静态回退视觉和三个入口。
- 不在首页显示详细 API/provider 错误；简单生成和画布页继续负责具体阻塞提示。

## 可访问性

- 三个入口按钮必须有可见文本。
- 图片预览装饰性图片可为空 alt；如果图片可点击则按钮/链接本身要有可访问名称。
- 动态加载区域不需要强提示，避免首页首屏吵闹；关键 CTA 始终可用。
- 移动端触摸目标至少约 44px。

## 取舍

- 不做首页 prompt 输入框。原因：当前简单生成页未支持跨页预填，本任务优先修正入口和观感，避免扩大状态传递范围。
- 不把服务状态放首页。原因：To C 首页应先激发创作；配置/错误在进入生成流程后再展示更合适。
- 使用公开广场预览但不依赖它。原因：作品能激发使用，但本地空库或接口失败时首页不能空。
- 把登录信息放顶部而不是首页内部。原因：账户状态是全局 shell 信息，右下浮块会干扰 C 端首页浏览和移动端内容阅读。
