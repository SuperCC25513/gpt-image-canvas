---
doc_type: audit-index
status: resolved
scope: canvas-toc-config-regression
created_at: 2026-06-03
---

# 画布 ToC 配置入口回归检查审计

## 范围

- 当前 Trellis 任务：`.trellis/tasks/06-03-canvas-toc-config-regression`。
- 重点文件：`apps/web/src/features/canvas/CanvasApp.tsx`、`apps/web/src/features/agent/AgentSkillDialog.tsx`、`apps/web/src/features/simple-generation/SimpleGenerationPage.tsx`、`apps/api/src/server/routes/agent-config.ts`、`apps/api/src/domain/agent/config.ts`、`packages/shared/src/agent.ts`。
- 重点维度：配置入口后台化、ToC 只保留生图参数、Agent 状态接口、权限边界、状态一致性。

## 总评

Provider / Agent LLM 主配置入口已从画布和简单生成页移除，非敏感 `/api/agent-config/status` 状态契约也符合后台配置详情 admin-only 的方向。

本轮审计发现 2 个问题，均已修复：Agent Skill Library 已从画布页迁到后台 Agent Skills tab；Agent 状态刷新失败时会清空旧状态，避免旧的 `configured=true` 继续放行发送。

## 发现清单

| ID | 性质 | 严重度 | 置信度 | 标题 | 建议动作 |
| --- | --- | --- | --- | --- | --- |
| finding-01 | arch-drift | P1 | high | 画布页仍暴露 Agent Skill 行为配置入口 | resolved |
| finding-02 | bug | P2 | high | Agent 状态刷新失败后旧的可用状态仍可放行发送 | resolved |

## 交叉分类矩阵

| 性质 \ 严重度 | P0 | P1 | P2 |
| --- | --- | --- | --- |
| bug | 0 | 0 | 1 |
| security | 0 | 0 | 0 |
| performance | 0 | 0 | 0 |
| maintainability | 0 | 0 | 0 |
| arch-drift | 0 | 1 | 0 |

## 修复结果

- `finding-01`：移除画布 Agent 头部 `agent-skills-open`，将 `AgentSkillDialog` 挂到后台 `/admin/agent-skills`。
- `finding-02`：`loadAgentConfig()` catch 分支设置 `setAgentConfig(null)`，状态不可确认时前端不再沿用旧可用状态。
- 修复记录见 `fix-note.md`。
