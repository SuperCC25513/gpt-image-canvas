# 简单生图模式实现计划

## 前置检查

- 运行 `nvm use 24.15.0`。
- 读取 `trellis-before-dev`，加载 web/frontend 和 shared/contracts 相关规范。
- 确认工作区已有用户改动，不回滚无关文件。

## 实现步骤

1. 路由与导航
   - 在 `CanvasApp.tsx` 中为 `AppRoute` 增加 `generate`。
   - 更新 `routeFromLocation()`、`pathForRoute()`、`TopNavigation`。
   - 保留 `/` 首页，新增 `/generate` 渲染简单生图页。

2. 简单页骨架
   - 新建 `features/simple-generation/SimpleGenerationPage.tsx`。
   - 新建 `styles/simple-generation.css` 并接入样式入口。
   - 页面包含提示词、尺寸、风格、数量、高级参数、生成按钮、Provider/账号提示、结果区。

3. 生成逻辑
   - 复用 shared 常量和尺寸校验。
   - 调用 `POST /api/images/generate`。
   - 对运行中记录轮询 `/api/generations/:id`。
   - 成功、部分失败、失败都写入简单页状态。
   - 生成后刷新 Gallery 最近作品。

4. 结果区
   - 使用当前会话输出 + `/api/gallery` 最近作品合成最近 8 张。
   - 桌面 2x4 稳定网格，移动端响应式。
   - 每张支持下载、复用提示词。
   - “查看更多”导航到 `/gallery`。

5. 去画布继续编辑
   - App 顶层维护待导入到画布的 asset id 列表。
   - 简单页点击动作设置待导入列表并导航 `/canvas`。
   - 画布 editor ready 后插入或定位对应资产，消费一次后清空。
   - 防止重复点击造成同一批图片无提示重复插入。

6. i18n
   - `apps/web/src/shared/i18n/index.tsx` 增加 `zh-CN` 和 `en` 文案。
   - 包括导航、简单页标题、字段、错误、空状态、结果动作。

7. 样式和响应式
   - 使用现有 token。
   - 避免卡片嵌套卡片和 `transition: all`。
   - 检查按钮文字、结果网格、移动端折叠区不溢出。

## 验证命令

- `nvm use 24.15.0`
- `pnpm typecheck`
- `pnpm build`
- `pnpm dev`

## 浏览器验证

- 打开 `http://127.0.0.1:5173/`，确认首页仍存在。
- 打开 `http://127.0.0.1:5173/generate`，确认默认进入简单生图页。
- 桌面视口验证：
  - 默认参数为 `square-1k`、`auto`、`png`、`1`、无风格。
  - 结果区最多显示最近 8 张，布局稳定。
  - “查看更多”进入 `/gallery`。
  - “去画布继续编辑”进入 `/canvas` 并插入或定位结果。
- 移动视口验证：
  - 表单和结果区无遮挡、无横向滚动、按钮可点击。
- 打开 `http://127.0.0.1:5173/canvas`，确认现有画布、Agent、参考图编辑入口仍可用。

## 回滚点

- 路由和导航改动可单独回滚。
- 简单页 feature 文件和样式文件可单独移除。
- 待导入画布逻辑风险最高，应保持独立函数和一次性状态，便于回退为“只导航到画布”。
