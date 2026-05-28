---
doc_type: audit-remediation
audit: 2026-05-28-web-audit-remediation
source_audits:
  - 2026-05-28-web-canvas-agent-runtime
  - 2026-05-28-web-auth-admin-access
  - 2026-05-28-web-provider-agent-config
  - 2026-05-28-web-simple-generation-flow
  - 2026-05-28-web-gallery-assets-publication
  - 2026-05-28-web-agent-skill-management
  - 2026-05-28-web-prompt-pool-favorites
  - 2026-05-28-web-shared-i18n-contracts
created: 2026-05-28
status: completed
resolved_findings: 18
dismissed_findings: 1
deferred_findings: 13
---

# 前端审计修复归档

## 结论

本轮根据 8 个前端审计任务做了确定性修复：18 条标记为 `resolved`，1 条按用户产品决策标记为 `dismissed`，13 条需要后续较大设计或服务端契约改造，标记为 `deferred`。

用户已确认画布和简易生成入口默认公开是预期行为，因此 `2026-05-28-web-simple-generation-flow/finding-01.md` 不进入修复范围。

## 已修复

| 模块 | Findings | 修复摘要 |
|---|---:|---|
| canvas-agent-runtime | 1 | `CanvasApp` 改用 shared 生成响应 guard；资产元数据缓存增加上限和 LRU 淘汰。 |
| auth-admin-access | 3 | 非管理员 `/admin` 前端入口不再加载后台页面；登出失败不再先清空用户；后台用户、设置、审计、积分调整响应增加运行时 guard。 |
| provider-agent-config | 2 | provider / Agent LLM 配置响应增加运行时 guard；secret 展示只接受明确 masked 值，异常明文回退为“已保存”。 |
| simple-generation-flow | 2 | 生成轮询等待清理 abort listener；轮询增加 20 分钟上限和超时提示。 |
| gallery-assets-publication | 2 | 可见性切换响应增加 guard；详情弹窗统一走 `assetPreviewUrl`。 |
| agent-skill-management | 3 | Skill 列表/详情/保存/导入响应增加 guard；初始加载使用 AbortController；导入增加类型和 2 MB 大小预校验。 |
| prompt-pool-favorites | 3 | Prompt Pool 和 Favorites API 增加运行时 guard；持久化 modelFilter 不存在时自动回退到 `all`。 |
| shared-i18n-contracts | 2 | Canvas 生成 guard 回归 shared；Gallery、Prompt、Provider、Admin、Agent Skill 等前端域补齐 guard 覆盖。 |

## Deferred

| 模块 | Findings | 原因 |
|---|---:|---|
| canvas-agent-runtime | 3 | 自动保存乱序、Agent WebSocket 事件深校验、CanvasApp 拆分都需要单独设计和更宽回归。 |
| gallery-assets-publication | 2 | Gallery 服务端分页/流式导出需要 API 契约和后端实现配合。 |
| simple-generation-flow | 1 | 参考图 data URL 状态改造涉及预览 URL、上传 payload 和生命周期管理。 |
| provider-agent-config | 2 | 图片 provider 与 Agent LLM 原子保存需要后端聚合事务；表单校验抽象属于重构项。 |
| prompt-pool-favorites | 1 | Prompt Pool 服务端筛选/分页需要 API 契约扩展。 |
| agent-skill-management | 1 | Dialog 拆分是结构性重构，功能风险低于本轮响应 guard 修复。 |
| auth-admin-access | 1 | AdminPage 拆分是维护性重构，建议单独走 `cs-refactor`。 |
| shared-i18n-contracts | 2 | 错误码/i18n 编译期同步和消息参数类型收紧需要共享契约设计。 |

## 验证

- `pnpm typecheck`：已通过。
- `pnpm build`：已通过。
