# 仓库说明

## 包管理

- 运行项目 `pnpm` 命令前，先执行 `nvm use 24.15.0`；`.nvmrc` 固定为 `24.15.0`。
- 使用 `pnpm install`；包管理器固定为 `pnpm@9.14.2`。
- 根目录脚本会委托给工作区包：`pnpm dev`、`pnpm api:dev`、`pnpm web:dev`、`pnpm typecheck`、`pnpm build` 和 `pnpm start`。

## 工作区结构

- API 应用：`apps/api`。
- Web 应用：`apps/web`。
- 共享契约：`packages/shared`。

## 必需验证

- 完成 story 前，运行 `pnpm typecheck` 和 `pnpm build`。
- UI story 需要针对运行中的应用进行浏览器验证。运行 `pnpm dev` 并打开 Vite Web 应用，通常是 `http://localhost:5173`。


## CodeStable

- 本仓库已接入 CodeStable；项目骨架和持久知识位于 `.codestable/`。
- 使用任何 `cs-*` 工作流前，必须先阅读 `.codestable/attention.md`；它是 CodeStable 技能启动必读入口，不用 `AGENTS.md` 替代。
- CodeStable 体系总览见 `.codestable/reference/system-overview.md`；目录结构、frontmatter、checklist 生命周期和收尾提交规则以 `.codestable/reference/shared-conventions.md` 为准。
- `.codestable/architecture/ARCHITECTURE.md` 是当前架构总入口；`.codestable/requirements/VISION.md` 是需求愿景索引。
- 新功能走 `cs-feat`，bug 走 `cs-issue`，行为不变的优化走 `cs-refactor`，不确定场景先走 `cs` 分诊。
- 既有 `docs/` 文档保留原位；需要纳入 CodeStable 时，用对应 backfill 或沉淀技能摘要归档，不要直接移动原文件。

## 文档索引

- 修改产品行为、onboarding、Gallery、provider 配置或 Agent 工作流前，阅读 `docs/PRODUCT_SENSE.md`。
- 在 `apps/web` 中做 UI 工作前，阅读 `docs/DESIGN.md` 和 `docs/FRONTEND.md`。
- 做 UI 打磨和微交互工作时，阅读 `docs/design-docs/interaction-quality.md`。
- 编写产品规格、执行计划、Ralph PRD 或多 story 任务拆解前，阅读 `docs/PLANS.md`。
- 做 API、存储、provider、Docker、SQLite、资产、secret 或本地数据工作前，阅读 `docs/RELIABILITY.md` 和 `docs/SECURITY.md`。

## 原生依赖

- 切换 Node 版本后，如果 `better-sqlite3` 报告 `NODE_MODULE_VERSION` 不匹配，重建 API 原生依赖：`pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream`。

## Docker

- 使用真实 `.env` 凭据做 Docker 验证时，运行 `docker compose config --quiet --no-env-resolution`；普通 `docker compose config` 会展开 env 文件，可能打印 secret。
- Docker 可用时，运行 `docker compose up --build`，并在配置的 `PORT` 上检查应用（默认 `8787`）。

## Ralph

- Ralph 驱动的工作在创建或运行任务前，先阅读 `docs/ralph-execution.md`。
- Ralph PRD 放在 `.agents/tasks/`，运行时状态放在 `.ralph/`，额外 wrapper 日志放在 `.codex-temp/`。
- 在 Windows 上调用 Ralph 时，优先设置 `PRD_PATH` 并通过 Git Bash 运行 `.agents/ralph/loop.sh`；避免使用会意外重写 Windows 路径的 CLI flags。

## 安全与本地文件

- 将本地 agent 临时文件放在 `.codex-temp/` 下；不要提交本地运行日志或机器特定路径。
- 不要提交 `.ralph`、`.codex-temp`、`data`、生成图片、SQLite 数据库或构建输出。
- `.codestable/` 是项目持久知识，不属于本地临时文件；只提交经过对应 CodeStable 流程确认的内容。
- break-glass 凭据提交必须留在私有本地分支：不要 push、开 PR、分享 patch、运行公开 CI、粘贴日志，或合并到共享历史。
- 常规开发仍应从 `.env` 或运行时环境读取 secret，

