---
doc_type: audit-fix-note
status: verified
scope: canvas-toc-config-regression
created_at: 2026-06-03
---

# 画布 ToC 配置入口回归修复记录

## 修复方案

1. 将 Agent Skill Library 从画布 Agent 头部迁到后台 `/admin/agent-skills`。
   - Skill 的启停、触发方式、关键词和文件内容属于 Agent 行为配置，不属于 ToC 生图参数。
   - ToC 画布页只保留尺寸、质量、格式、数量、参考图等生成参数。

2. Agent 状态刷新失败时清空旧状态。
   - `/api/agent-config/status` 失败或返回异常结构时，前端不能继续沿用旧的 `configured=true`。
   - 失败态应阻止发送，并显示 Agent 暂不可用或状态读取失败。

## 改动点

- `apps/web/src/features/canvas/CanvasApp.tsx`
  - 移除画布页 `AgentSkillDialog` 入口与弹层状态。
  - `/api/agent-config/status` 失败时执行 `setAgentConfig(null)`。
  - 后台路由映射增加 `agentSkills: "/admin/agent-skills"`。

- `apps/web/src/features/admin/AdminPage.tsx`
  - 新增 `agentSkills` tab。
  - 在后台页面集中打开 `AgentSkillDialog isAdmin`。

- `apps/web/src/shared/i18n/index.tsx`
  - 新增后台 Agent Skills tab 和按钮文案。

## 验证

- `nvm use 24.15.0 && pnpm typecheck`：通过。
- `nvm use 24.15.0 && pnpm build`：通过；保留既有 Vite 大 chunk 警告。
- `GET /api/agent-config/status`：返回 `200 {"configured":false,"supportsVision":false}`，不含模型名、Base URL、secret 或 source order。
- 未登录访问 `/api/agent-config`：返回 `401`。
- 未登录访问 `/api/provider-config`：返回 `401`。
- 隔离临时数据目录启动 `pnpm dev` 后，用 headless Chrome 验证：
  - 桌面 `/canvas` 手动 tab：无后台配置、API Key、Base URL、Codex 登录、Agent Skill Library 等配置词。
  - 桌面 `/canvas` Agent tab：`agent-model-pill` 为 `DIV role="status"`，无 `agent-skills-open`，无 thinking/reasoning 控件，无模型名 `gpt-5.4`。
  - 桌面 `/generate`：无配置入口词。
  - 后台 `/admin/agent-skills`：Agent Skill 配置 tab 可进入，能打开 Agent Skill Library 弹层。
  - 移动 `/canvas`：页面宽度未溢出，未发现配置入口词。
