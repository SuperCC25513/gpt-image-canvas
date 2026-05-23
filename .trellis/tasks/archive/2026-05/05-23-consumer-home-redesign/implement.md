# To C 首页重设计实施计划

## 修改顺序

1. 更新 `HomePage.tsx` 组件结构。
   - 调整 props，新增 `onOpenCanvas`、`onOpenPublicGallery`。
   - 移除 Provider 状态展示。
   - 增加三入口首屏和公开作品预览。
   - 增加公开作品预览 fetch，失败走静态回退。

2. 更新 `CanvasApp.tsx` 路由传参。
   - 给 `HomePage` 传入画布和图片广场入口。
   - 确认 `publicGallery` 路由跳转正常。

3. 调整登录账户显示。
   - 修改 `App.tsx`，删除主应用外层右下角 `.auth-user-bar` 渲染。
   - 把 `currentUser` 和 `logout` 动作传入 `CanvasApp` / `TopNavigation`。
   - 在顶部右侧展示用户名和退出入口。
   - 移除或替换 `.auth-user-bar` fixed bottom 样式。

4. 更新 `home.css`。
   - 重写首页首屏、入口卡、灵感预览、移动响应式。
   - 删除旧服务状态、marquee、工作流/ops 说明区相关样式。
   - 确认无 `transition: all`，图片有稳定尺寸和 neutral outline。

5. 更新 `shared/i18n/index.tsx`。
   - 替换首页中英文文案。
   - 清理未使用 key 或至少确保新增 key 双语齐全。
   - 如账户区文案变化，同步中英文。

6. 手动检查无残留后台/技术文案。
   - 搜索 `homeProvider`、`homeTrust`、`BYOK`、`OpenAI API`、`pnpm dev`、`fallback` 等首页引用。
   - 搜索 `.auth-user-bar`，确认右下浮块不再渲染。

## 验证命令

- `nvm use 24.15.0`
- `pnpm typecheck`
- `pnpm build`
- `pnpm dev`

## 浏览器验证

打开 `http://localhost:5173/`：

- 桌面视口：确认首屏三入口可见，图片预览稳定，页面不再展示服务配置/技术状态。
- 桌面视口：确认用户名显示在顶部右侧，右下角无登录信息浮块，退出按钮可用。
- 移动视口：确认三入口可点击，文案无重叠，图片预览不造成横向页面滚动，账户区不挤压导航。
- 点击：
  - `开始简单生成` → `/generate`
  - `进入画布` → `/canvas`
  - `逛图片广场` → `/public-gallery`

## 风险与回滚点

- 首页 CSS 改动范围较大，风险在响应式布局。回滚点：`HomePage.tsx` 和 `home.css`。
- 公开作品预览请求若失败不能影响首页主 CTA。实现时必须保留静态回退。
- 文案 key 清理可能影响其他页面。清理前用 `rg` 确认引用。
