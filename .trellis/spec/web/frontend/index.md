# Web 前端规范索引

`apps/web` 是 Vite + React + tldraw 客户端。主体验是画布工作台，辅以 Gallery、Prompt Pool、Provider/Agent 配置和本地化。

## 开发前必读

- [目录结构](./directory-structure.md)
- [组件规范](./component-guidelines.md)
- [Hook 规范](./hook-guidelines.md)
- [状态管理](./state-management.md)
- [类型安全](./type-safety.md)
- [质量规范](./quality-guidelines.md)
- 共享契约：`.trellis/spec/shared/contracts/index.md`
- UI 改动读 `docs/DESIGN.md`、`docs/FRONTEND.md`、`docs/design-docs/interaction-quality.md`。

## 质量检查

- 跑 `pnpm typecheck` 和 `pnpm build`。
- UI 故事运行 `pnpm dev`，打开 `http://localhost:5173`，检查桌面和移动视口。
- 改用户可见文案时同步 `zh-CN` 和 `en`。
- 改 tldraw shape props 时检查快照恢复和旧数据容错。
- 改 API 读取时确认错误走 `localizedApiErrorMessage()` 或本地 fallback。

## 本层文件

| 文件 | 用途 |
| --- | --- |
| [directory-structure.md](./directory-structure.md) | feature / shared / styles 组织 |
| [component-guidelines.md](./component-guidelines.md) | React 组件、tldraw shape、dialog 模式 |
| [hook-guidelines.md](./hook-guidelines.md) | effect、memo、fetch、cleanup |
| [state-management.md](./state-management.md) | local state、server state、canvas state、缓存 |
| [type-safety.md](./type-safety.md) | shared 类型、runtime guard、i18n 类型 |
| [quality-guidelines.md](./quality-guidelines.md) | UI 验证、性能、可访问性 |
