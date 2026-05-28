---
doc_type: explore
type: module-overview
date: "2026-05-28"
slug: codestable-onboard-audit
topic: CodeStable 接入现状与旧文档迁移审计
scope: .codestable 骨架、仓库根目录文档、docs 目录文档、AGENTS 启动约定
keywords:
  - codestable
  - onboard
  - docs
  - migration
status: active
confidence: high
---

# CodeStable 接入现状与旧文档迁移审计

## 结论

本仓库已经完成 CodeStable 基础接入，`.codestable/` 下存在 `attention.md`、`architecture/`、`requirements/`、`features/`、`issues/`、`compound/`、`roadmap/`、`tools/`、`reference/`。本次 onboard 刷新了技能包维护的共享资产，并补齐新版共享口径中列出的 `refactors/` 和 `brainstorm/` 空目录。

仓库存在大量既有 `docs/` 文档，但这些文件被 `AGENTS.md` 的 Documentation Map 明确作为项目工作入口引用，不属于可直接搬迁的零散遗留文档。本次处理结果为：保留原位，不移动、不删除、不重命名。后续若要让 CodeStable 更完整地索引这些内容，应使用对应子技能做 backfill 或摘要归档，而不是直接迁移原文件。

## 骨架检查

| 路径 | 状态 | 处理结果 |
|---|---|---|
| `.codestable/attention.md` | 已存在 | 保留，内容包含项目测试注意事项 |
| `.codestable/architecture/ARCHITECTURE.md` | 已存在 | 保留，作为架构总入口 |
| `.codestable/requirements/` | 已存在 | 保留 |
| `.codestable/roadmap/` | 已存在 | 保留 |
| `.codestable/features/` | 已存在 | 保留 |
| `.codestable/issues/` | 已存在 | 保留 |
| `.codestable/compound/` | 已存在 | 新增本审计文档 |
| `.codestable/tools/` | 已存在 | 已从 `cs-onboard` 技能包刷新 |
| `.codestable/reference/` | 已存在 | 已从 `cs-onboard` 技能包刷新 |
| `.codestable/refactors/` | 缺失 | 已补齐 `.gitkeep` |
| `.codestable/brainstorm/` | 缺失 | 已补齐 `.gitkeep` |

## 旧文档审计

| 现有文件 | 推测内容类型 | 建议归入 CodeStable | 置信度 | 本次处理 |
|---|---|---|---|---|
| `README.md` | 项目说明 / 使用入口 | 保留原位；必要摘要可进入 `.codestable/architecture/ARCHITECTURE.md` | 高 | 保留原位 |
| `README.zh-CN.md` | 中文项目说明 / 使用入口 | 保留原位；必要摘要可进入 `.codestable/architecture/ARCHITECTURE.md` | 高 | 保留原位 |
| `CHANGELOG.md` | 发布历史 | 保留原位；不纳入 CodeStable 工作流 | 高 | 保留原位 |
| `AGENTS.md` | Agent 启动约定 | 保留原位；CodeStable 子技能另读 `.codestable/attention.md` | 高 | 保留原位 |
| `docs/PRODUCT_SENSE.md` | 产品原则 / 工作流上下文 | 可用 `cs-req backfill` 摘要为需求愿景，不移动原文件 | 高 | 保留原位 |
| `docs/product-specs/*.md` | 产品能力规格 | 可用 `cs-req backfill` 拆成 `.codestable/requirements/{slug}.md`，原文件保留 | 中 | 保留原位 |
| `docs/DESIGN.md` | 设计质量规则 | 可用 `cs-arch backfill` 或 `cs-learn` 摘要，原文件保留 | 中 | 保留原位 |
| `docs/FRONTEND.md` | 前端实现规则 | 可用 `cs-arch backfill` 摘要前端架构约束，原文件保留 | 中 | 保留原位 |
| `docs/design-docs/*.md` | 设计系统 / 交互规则 | 可用 `cs-learn` 或 `cs-trick` 归档稳定规则，原文件保留 | 中 | 保留原位 |
| `docs/RELIABILITY.md` | 可靠性规则 | 可用 `cs-arch backfill` 摘要运行时和持久化边界，原文件保留 | 中 | 保留原位 |
| `docs/SECURITY.md` | 安全和隐私规则 | 可用 `cs-arch backfill` 或 `cs-decide` 摘要长期约束，原文件保留 | 中 | 保留原位 |
| `docs/PLANS.md` | 计划文档规范 | 保留原位；与 CodeStable roadmap/feature 可并行 | 中 | 保留原位 |
| `docs/ralph-execution.md` | Ralph 执行规则 | 保留原位；不纳入 CodeStable 工作流 | 高 | 保留原位 |
| `docs/exec-plans/**` | 执行计划索引 / 技术债 | 可按主题转为 `.codestable/roadmap/` 或 `issues/`，需用户逐条确认 | 低 | 保留原位 |
| `docs/generated/db-schema.md` | 生成的数据库 Schema 文档 | 保留原位；可作为架构 backfill 证据，不复制生成物 | 高 | 保留原位 |
| `docs/references/README.md` | 参考资料入口 | 保留原位；按需链接 | 中 | 保留原位 |

## 不确定项

- `docs/product-specs/*.md` 与 `.codestable/requirements/` 有语义重叠，但前者是现有项目文档体系的一部分。直接移动会破坏 `AGENTS.md` 的阅读约定；更合适的方式是后续按主题做 requirement backfill。
- `docs/design-docs/*.md` 包含不少稳定设计规则，但并非全部都是架构现状。应按内容拆分为 architecture、learning 或 trick，而不是整文件搬迁。
- `docs/exec-plans/tech-debt-tracker.md` 可能对应多个 CodeStable issue 或 roadmap 条目，低置信度，必须另起任务逐条确认。

## 后续建议

1. 若要补齐项目愿景层，运行 `cs-req backfill`，优先处理 `docs/PRODUCT_SENSE.md` 和 `docs/product-specs/*.md`。
2. 若要补齐架构层，运行 `cs-arch backfill`，优先处理 `docs/RELIABILITY.md`、`docs/SECURITY.md`、`docs/FRONTEND.md` 和 `docs/generated/db-schema.md`。
3. 若要沉淀设计规则，按主题使用 `cs-learn` 或 `cs-trick`，不要整批复制 `docs/design-docs/*.md`。
4. 若要整理技术债，先将 `docs/exec-plans/tech-debt-tracker.md` 拆成具体 issue 或 roadmap，再逐条进入对应流程。
