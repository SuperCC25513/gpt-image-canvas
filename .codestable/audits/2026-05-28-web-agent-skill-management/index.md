---
doc_type: audit-index
audit: 2026-05-28-web-agent-skill-management
scope: Agent Skill CRUD, import, detail, and local editor dialog
created: 2026-05-28
status: active
total_findings: 4
---

# web-agent-skill-management 审计报告

## 范围

扫描 `apps/web/src/features/agent/AgentSkillDialog.tsx`，并查看 shared/API 对 Agent Skill 的契约暴露。重点看技能列表、详情、创建/保存、启停、导入 ZIP/Markdown、内置技能重置和文件编辑器。

## 总评

共发现 4 条：1 条 `bug`、1 条 `security`、1 条 `performance`、1 条 `maintainability`。最值得先处理的是技能管理所有关键响应都直接强转；技能内容会影响 Agent planning prompt，属于高影响配置数据。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | medium | Agent Skill 响应全部强转，缺少运行时 guard | [finding-01.md](finding-01.md) |
| 2 | performance | P2 | medium | 初始加载关闭弹窗后不取消正在进行的请求 | [finding-02.md](finding-02.md) |
| 3 | security | P2 | medium | 技能导入缺少前端文件大小和类型早期校验 | [finding-03.md](finding-03.md) |
| 4 | maintainability | P2 | high | 一个 Dialog 同时实现列表、编辑器、导入和重置 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 0 | 1 |
| security | 0 | 0 | 1 | 1 |
| performance | 0 | 0 | 1 | 1 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **1** | **3** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-01 建议开 `cs-issue`，先补技能响应解析。
- **P2 有空再看**：finding-02、finding-04 适合 `cs-refactor`；finding-03 可和 API 导入限制一起补前端预检。
