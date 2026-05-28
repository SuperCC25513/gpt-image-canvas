---
doc_type: audit-finding
audit: 2026-05-28-web-agent-skill-management
finding_id: "security-03"
nature: security
severity: P2
confidence: medium
suggested_action: cs-issue
status: resolved
---

# Finding 03：技能导入缺少前端文件大小和类型早期校验

## 速答

导入入口只通过 input `accept` 提示 `.md,.zip`，拿到文件后直接放进 FormData POST；前端没有检查文件大小、MIME 或扩展名。

## 关键证据

- `apps/web/src/features/agent/AgentSkillDialog.tsx:380` — `<input ... accept=".md,.zip,text/markdown,application/zip" ...>` —— accept 只是选择器提示。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:385` — `onChange={(event) => void importSkill(event.target.files?.[0])}` —— 选中后直接进入导入流程。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:245` — `const body = new FormData();` —— 不做本地预检。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:246` — `body.set("file", file);` —— 原文件直接进入请求体。
- `apps/web/src/features/agent/AgentSkillDialog.tsx:247` — `fetch("/api/agent-skills/import", { method: "POST", body })` —— 交给服务端拒绝。

## 影响

服务端已有导入限制，但前端缺少早期拒绝会让用户上传明显不合法或过大的文件，浪费本地工作站资源，也让错误反馈滞后。

## 修复方向

在前端同步检查扩展名、MIME 和大小上限；超限时不发请求，直接显示稳定错误。

## 建议动作

`cs-issue`，因为这是上传入口输入边界缺口。
