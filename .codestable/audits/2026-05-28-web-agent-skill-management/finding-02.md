---
doc_type: audit-finding
audit: 2026-05-28-web-agent-skill-management
finding_id: "performance-02"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: resolved
---

# Finding 02：初始加载关闭弹窗后不取消正在进行的请求

## 速答

初始加载用 `isActive` 阻止卸载后 setState，但没有 AbortController；关闭弹窗后列表和详情请求仍会继续占用网络和后端资源。

## 关键证据

- `apps/web/src/features/agent/AgentSkillDialog.tsx:128` — `const nextSkills = await fetchAgentSkillList(locale, t);` —— 初始加载先请求列表。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:141` — `const detail = await fetchAgentSkillDetail(firstSkillId, locale, t);` —— 随后请求首个详情。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:160` — cleanup 只执行 `isActive = false;`。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:678` — `fetch("/api/agent-skills")` 没有接收 signal。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:688` — `fetch(/api/agent-skills/${...})` 也没有 signal。

## 影响

用户快速打开/关闭技能弹窗时，请求仍在后台完成。影响不大但容易造成无意义负载，并和后续打开弹窗时的新请求重叠。

## 修复方向

给 `fetchAgentSkillList` 和 `fetchAgentSkillDetail` 增加 `AbortSignal`，弹窗关闭时 abort。

## 建议动作

`cs-refactor`，因为这是请求生命周期整理。
