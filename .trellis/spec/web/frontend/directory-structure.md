# Web 目录结构

## 顶层入口

- `src/main.tsx` 挂载 React。
- `src/App.tsx` 只 re-export `features/canvas/CanvasApp`，当前主应用在画布 feature 内。
- `src/i18n.tsx` 是 i18n provider 入口包装。

## Feature 分区

- `features/canvas/`：主画布、生成面板、路由、Agent 面板、项目保存、tldraw 资产接入。`CanvasApp.tsx` 是当前大中枢。
- `features/agent/`：Agent 计划节点 shape、Skill dialog。
- `features/gallery/`：Gallery 页面、导出、删除、复用。
- `features/pool/`：Prompt Pool 和收藏操作。
- `features/home/`：首页/工作台入口。
- `features/simple-generation/`：低门槛文生图入口。它复用现有生成 API 和 Gallery 资产链路，结果先停留在简单页，用户主动继续时再交给画布。
- `features/provider-config/`：图片 provider 和 Agent LLM 配置弹窗。
- `features/prompt-favorites/`：收藏 API helper。

## Shared 分区

- `shared/i18n/index.tsx`：locale、翻译函数、API error code 映射、格式化。
- `shared/api/assets.ts`：资产 URL helper。
- `shared/api/generation.ts`：生成记录、Gallery 响应的 runtime guard，以及跨页面 API 错误读取 helper。
- `shared/imageValidation.ts`：Web 层共享的图片尺寸校验文案映射。
- 更多跨 feature helper 优先放 `shared/`，但不要提前抽象；三处以上重复或跨 feature 使用再提。

## 样式组织

- `src/styles.css` 导入样式。
- `src/styles/tokens.css` 定义设计 token。
- feature 样式分文件：`agent.css`、`gallery.css`、`provider-config.css`、`pool.css`、`canvas.css` 等。
- 新样式放最小相关 stylesheet；只在真正共享时放 `base.css` / `layout.css` / `tokens.css`。

## 命名规则

- React 组件文件用 PascalCase：`ProviderConfigDialog.tsx`、`GalleryPage.tsx`。
- API/helper 文件用 camelCase 或领域名：`promptFavoritesApi.ts`、`assets.ts`。
- CSS class 使用 BEM-like 前缀，例：`agent-plan-node__job-row`、`gallery-card__image`、`provider-config-dialog__close`。

## 避免

- 新页面绕过 feature 目录直接塞进 `CanvasApp.tsx`，除非确实是画布主流程的一小段。
- 把 feature-specific CSS 放进全局文件。
- 在 Web 端复制 API 规则或 shared 常量。
