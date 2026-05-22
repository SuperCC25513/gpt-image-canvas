# Shared 目录结构

## 文件职责

- `src/index.ts`：唯一 barrel export。
- `image.ts`：底层图像常量、union、preset、helper。
- `validation.ts`：跨 API/Web 共用的尺寸验证。
- `generation.ts`：生成记录、Gallery、Agent plan schema。
- `provider-config.ts`：图片 provider 来源、masked secret、Codex auth response。
- `agent.ts`：Agent LLM 配置、Skill、WebSocket client/server event。
- `project.ts`：保存的项目快照。
- `prompt-pool.ts`、`prompt-favorites.ts`：提示词池和收藏数据结构。

## 放置规则

- API 和 Web 都要理解的类型/常量放 shared。
- 只属于 API 的 provider SDK config、DB row、filesystem 路径不要放 shared。
- 只属于 Web 的 label、CSS、React props 不要放 shared。
- 验证函数只有在 API 和 Web 都需要时才放 shared；单边解析保留在对应包。

## 导出规则

新增文件后必须在 `src/index.ts` export。当前 pattern 是：

```ts
export * from "./image.js";
export * from "./validation.js";
```

保持 `.js` 后缀，匹配 ESM 编译输出。

## 避免

- 从 shared import API/Web 代码，shared 必须保持无 React、无 Hono、无 Node SDK 依赖。
- 把 runtime secret 或本地路径类型暴露为客户端契约。
- 为临时 UI state 增加 shared 类型。
