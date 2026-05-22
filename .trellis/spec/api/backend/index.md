# API 后端规范索引

`apps/api` 是本地 Hono API、WebSocket、SQLite 持久化、图片生成、本地资产存储和 Agent 执行层。代码按 `server` / `domain` / `infrastructure` 分层，跨层契约来自 `packages/shared`。

## 开发前必读

- [目录结构](./directory-structure.md)
- [数据库规范](./database-guidelines.md)
- [错误处理](./error-handling.md)
- [日志规范](./logging-guidelines.md)
- [质量规范](./quality-guidelines.md)
- 共享契约：`.trellis/spec/shared/contracts/index.md`
- 涉及 provider、本地资产、SQLite、Docker、secret 时读 `docs/RELIABILITY.md` 和 `docs/SECURITY.md`。

## 质量检查

- 跑 `pnpm typecheck` 和 `pnpm build`。
- 改 API 路由时确认请求体通过 `readJson` 和 `parse*Payload` 类函数进入 domain。
- 改持久化时确认 `apps/api/src/infrastructure/schema.ts`、`apps/api/src/infrastructure/database.ts`、domain 读写函数、shared response 类型同步。
- 改 secret/provider 时确认响应只返回 masked secret，不打印原始 key/token。
- 改 Agent WebSocket 或计划执行时确认事件类型仍由 `packages/shared` 导出，断线、取消、重试仍可检查。

## 本层文件

| 文件 | 用途 |
| --- | --- |
| [directory-structure.md](./directory-structure.md) | 分层边界和文件归属 |
| [database-guidelines.md](./database-guidelines.md) | SQLite、Drizzle、迁移和资产一致性 |
| [error-handling.md](./error-handling.md) | API 错误响应、ProviderError、validation |
| [logging-guidelines.md](./logging-guidelines.md) | console 使用边界和 secret 保护 |
| [quality-guidelines.md](./quality-guidelines.md) | 验证、并发、取消、构建检查 |
