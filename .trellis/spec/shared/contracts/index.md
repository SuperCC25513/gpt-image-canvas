# Shared 契约规范索引

`packages/shared` 是 API 和 Web 的契约包。它导出图像、生成记录、Agent 计划、Provider 配置、项目状态、Prompt Pool/Favorites、验证函数。

## 开发前必读

- [目录结构](./directory-structure.md)
- [契约规范](./contract-guidelines.md)
- [验证规范](./validation-guidelines.md)

## 质量检查

- 改 shared 后跑 `pnpm --filter @gpt-image-canvas/shared typecheck`，最终跑根 `pnpm typecheck` 和 `pnpm build`。
- 新增导出要更新 `src/index.ts`。
- 新增 request/response 字段要同步 API parser/domain 和 Web 使用方。
- 新增 union/constant 要同步 UI label、本地化、API validation、Agent plan validation（如适用）。

## 当前导出面

- `image.ts`：图片模型、尺寸预设、风格预设、质量、格式、生成数量、尺寸 tier。
- `validation.ts`：尺寸验证、API size value。
- `generation.ts`：生成请求/响应、Gallery、Agent GenerationPlan。
- `provider-config.ts`：Provider 配置 request/response 和 masked secret。
- `agent.ts`：Agent LLM、Skill、WebSocket event。
- `project.ts`：项目快照状态。
- `prompt-pool.ts`、`prompt-favorites.ts`：提示词池和收藏。
