---
doc_type: audit-finding
audit: 2026-05-28-web-agent-skill-management
finding_id: "maintainability-04"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: deferred
---

# Finding 04：一个 Dialog 同时实现列表、编辑器、导入和重置

## 速答

`AgentSkillDialog.tsx` 把技能列表、详情加载、表单编辑、文件编辑器、导入、内置重置和 CRUD 请求都放在单组件文件里。

## 关键证据

- `apps/web/src/features/agent/AgentSkillDialog.tsx:173` — `saveSkill` 处理创建/更新。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:203` — `toggleSkill` 处理启停。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:236` — `importSkill` 处理上传导入。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:270` — `resetBuiltInSkill` 处理内置重置。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:504` — UI 内嵌 `agent-skill-files` 文件列表和编辑器。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:677` — 同文件底部还定义 API fetch helpers。

## 影响

技能管理是 Agent 行为入口，后续加验证、diff、预览或权限提示都会继续推高复杂度。单文件使局部变更更难测试。

## 修复方向

拆出 `useAgentSkills` 数据 hook、`AgentSkillEditor`、`AgentSkillList` 和 `AgentSkillImportButton`，让 Dialog 只负责布局和模式切换。

## 建议动作

`cs-refactor`，因为这是行为不变的模块边界整理。
