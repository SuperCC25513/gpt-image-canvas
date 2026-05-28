---
doc_type: audit-finding
audit: 2026-05-28-web-agent-skill-management
finding_id: "bug-01"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 01：Agent Skill 响应全部强转，缺少运行时 guard

## 速答

Agent Skill 列表、详情、保存、启停、导入和重置响应都通过 `as ...Response` 强转后直接更新状态，没有校验 skill/files/trigger 字段。

## 关键证据

- `apps/web/src/features/agent/AgentSkillDialog.tsx:189` — `const payload = (await response.json()) as SaveAgentSkillResponse;` —— 保存响应直接强转。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:226` — `const payload = (await response.json()) as SaveAgentSkillResponse;` —— 启停响应直接强转。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:255` — `const payload = (await response.json()) as ImportAgentSkillResponse;` —— 导入响应直接强转。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:683` — `const body = (await response.json()) as AgentSkillListResponse;` —— 列表响应直接强转。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:693` — `const body = (await response.json()) as { skill: AgentSkillDetail };` —— 详情响应直接强转。

## 影响

Agent Skill 会进入 Agent planning 上下文，错误的 `files`、`triggerMode` 或 `required` 状态可能误导规划。API 漂移或畸形响应会把坏数据写入编辑器。

## 修复方向

补 `isAgentSkillSummary`、`isAgentSkillDetail`、`isAgentSkillListResponse` 等 guard，失败时保留旧列表并显示错误。

## 建议动作

`cs-issue`，因为这是 Agent 配置数据边界 bug。
