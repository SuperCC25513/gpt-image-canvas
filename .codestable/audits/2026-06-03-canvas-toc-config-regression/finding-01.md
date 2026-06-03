---
doc_type: audit-finding
status: resolved
severity: P1
nature: arch-drift
confidence: high
suggested_action: cs-issue
---

# 画布页仍暴露 Agent Skill 行为配置入口

## 证据

- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:6961) 在画布 Agent 头部渲染 `agent-skills-open` 按钮，并直接打开 Skill Library。
- [CanvasApp.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/canvas/CanvasApp.tsx:7369) 从画布页挂载 `AgentSkillDialog isAdmin={isCurrentUserAdmin}`。
- [AgentSkillDialog.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/agent/AgentSkillDialog.tsx:78) 只用 `isReadOnly = !isAdmin` 控制编辑能力。
- [AgentSkillDialog.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/agent/AgentSkillDialog.tsx:496) 管理员可从该弹层启停 Skill。
- [AgentSkillDialog.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/agent/AgentSkillDialog.tsx:561) 管理员可从该弹层修改启用状态、触发方式、触发关键词。
- [AgentSkillDialog.tsx](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/apps/web/src/features/agent/AgentSkillDialog.tsx:625) 管理员可从该弹层编辑 Skill 文件内容。
- [docs/product-specs/provider-configuration.md](/Users/jesuscc/wcc/projects/github/gpt-image-canvas/docs/product-specs/provider-configuration.md:9) 写明画布等 ToC 页面不提供系统配置入口，只展示生图参数。

## 为什么是问题

本任务目标是 ToC 创作页只保留生图参数，配置能力下沉后台。Agent Skill Library 管理的是 Agent 规划时读取的本地指令、触发方式和文件内容，属于 Agent 行为配置，不是尺寸、质量、输出格式、参考图这类生图参数。

当前普通用户能看到只读配置详情，管理员还能在画布页直接修改 Agent 行为。即使写接口已经 `requireAdmin`，入口仍在 ToC 创作页，违背产品边界和验收口径。

## 影响

- 管理员仍可从创作页修改 Agent 行为配置。
- 普通用户仍会在创作页看到 Agent Skill、触发方式、关键词、文件等配置概念。
- 后续回归搜索 provider/Agent 配置入口时，Skill Library 会成为新的漏网配置入口。

## 建议

把 Agent Skill Library 迁移到后台，或至少从 ToC 画布页移除 `agent-skills-open` 入口。若短期仍需要普通用户查看技能说明，应改成纯说明视图，并去掉触发方式、启停、关键词、文件编辑等配置型字段。

## 修复记录

- 已从画布 Agent 头部移除 `agent-skills-open` 按钮。
- 已从 `CanvasApp.tsx` 移除 `AgentSkillDialog` 渲染状态。
- 已新增后台 `/admin/agent-skills` tab，用于管理员打开 `AgentSkillDialog isAdmin`。
- 已通过浏览器回归确认桌面和移动 `/canvas` 不再出现 Agent Skill Library 配置入口。
