# Web 质量规范

## 构建和浏览器验证

- 常规检查：`pnpm typecheck`、`pnpm build`。
- UI 改动：`pnpm dev` 后打开 `http://localhost:5173`。
- 至少检查桌面和移动视口；重点看 panel、drawer、dialog、按钮文字、缩略图和 canvas overlay 不重叠。
- Canvas 改动要验证：选择参考图、生成 placeholder、生成结果替换、计划节点定位、快照保存/恢复。

## 性能

- 避免 render path 中重同步循环，尤其是 canvas/tldraw overlay、WebSocket event handler、图片 metadata 读取。
- 大列表筛选用 memo/deferred，参考 Prompt Pool。
- 独立请求可并发发起，避免 async waterfall。
- heavy optional page 用 lazy preload。
- 图片预览使用 `/api/assets/:id/preview?width=`，不要直接拉原图做缩略图。

## 可访问性

- 自定义按钮需要 `aria-label` 或可见文本。
- modal/dialog 支持 Escape。
- 不能只靠颜色传达状态；配图标/文案。
- 移动触摸目标至少约 44px；现有 icon 按钮用 pseudo element 扩展热区。
- 动态状态如 loading/failed 使用 role/status 或明确文本。

## 视觉一致性

- 使用 `tokens.css` 中 token，不新造一套主题。
- CSS transition 写明确属性，不写全局无边界动画。
- 动态数字、状态 chip、技术值使用 tabular nums，参考 `base.css`。
- 图片缩略图保持 neutral outline。
- Press feedback 使用 `scale(var(--motion-scale-press))`。

## 错误和空状态

- 请求错误要显示用户可理解信息，不静默失败。
- clipboard、notification、download 等浏览器能力要有 fallback。
- 空状态文案放 i18n，不写死。

## 避免

- 新增 UI 后只靠 typecheck，不做浏览器检查。
- 加新依赖解决微交互；当前用 CSS transition。
- 让 loading/error 文案撑开按钮或 toolbar。
- 直接嵌入 generated image base64 到长期 React state 或 localStorage。
