# API 目录结构

## 分层边界

`apps/api/src` 当前有三层：

- `server/`：Hono 路由、HTTP/WebSocket 边界、请求读取、响应状态码。例：`server/app.ts` 只注册路由和静态资源 fallback；`server/routes/images.ts` 只做 JSON 读取、payload 解析、调用 generation task。
- `domain/`：业务编排、持久化读写、生成任务、provider 选择、Agent 计划/执行。例：`domain/generation/generation-tasks.ts` 管理后台任务和取消；`domain/generation/image-generation.ts` 写 generation record、outputs 和本地 asset。
- `infrastructure/`：外部适配器和运行时资源。例：`infrastructure/runtime.ts` 解析 `.env`、`DATA_DIR`、端口、SQLite pragma；`infrastructure/providers/*` 包装 OpenAI/Codex；`infrastructure/storage/asset-storage.ts` 包装本地资产读写。

新增代码先判断归属：

- 新 API endpoint 放 `server/routes/<feature>.ts`，并在 `server/app.ts` 注册。
- 新请求解析放 `server/http/validation.ts`，返回 `ParseResult<T>`。
- 新业务流程放 `domain/<feature>/`。
- 新第三方 SDK、文件系统、运行时环境适配放 `infrastructure/`。
- 跨 API/Web 的类型、常量、验证函数放 `packages/shared/src`，不要在 API 内重定义。

## 文件命名

- TypeScript 文件用 kebab-case：`provider-config.ts`、`generation-tasks.ts`、`asset-storage.ts`。
- route 文件以资源名命名：`images.ts`、`gallery.ts`、`agent-ws.ts`。
- domain 内按能力建目录：`agent/`、`generation/`、`providers/`、`prompt-pool/`。

## 导入规则

- API 从 shared 通过 `domain/contracts.ts` 统一转出口导入，例：`server/http/validation.ts` 从 `../../domain/contracts.js` 导入 presets 和类型。
- server 可以依赖 domain 和 infrastructure 的错误类型，但不要直接写 DB。
- domain 可以依赖 infrastructure 适配器和 schema，但不要 import Hono `Context`。
- infrastructure 不应该依赖 server。
- ESM 输出要求相对导入带 `.js` 后缀，源码已统一这样写：`"./runtime.js"`、`"../contracts.js"`。

## 常见反例

- 在 route 中直接 `JSON.parse` 或写数据库，绕过 `readJson` 和 `parse*Payload`。
- 在 Web 端复制 provider 规则；应从 API response 和 shared contracts 驱动。
- 把 secret masking 写在组件或 route 内；现有 pattern 在 domain config view 中统一处理。
