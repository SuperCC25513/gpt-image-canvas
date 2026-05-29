---
doc_type: requirement
slug: system-provider-configuration
pitch: 管理员可以在系统页面配置生成服务和 Agent 模型，让保存后的设置持续生效。
status: current
last_reviewed: "2026-05-29"
implemented_by:
  - ARCHITECTURE
tags: [provider, agent, admin, config]
---

# 配置生成服务和 Agent 模型

## 用户故事

- 作为本地工作台管理员，我希望在系统页面保存图片生成服务配置，而不是每次部署或切换存储后都只能依赖环境变量。
- 作为使用 Agent 规划的人，我希望 Agent 模型配置和图片生成配置分开保存，而不是配置了图片 provider 后还不知道 Agent 为什么不能用。
- 作为需要 Codex fallback 的管理员，我希望登录状态能被系统页面识别和清除，而不是保存了 source order 却看不到 Codex 是否可用。
- 作为切换到 MySQL + OSS 运行模式的人，我希望系统页面保存的配置在刷新和重启后继续生效，而不是只在 SQLite 本地模式可用。

## 为什么需要

生成服务配置是本地工作站能不能真正出图和规划的入口。只支持环境变量会让管理员必须离开产品界面改部署文件；只支持 SQLite 会让 MySQL 模式下的系统页面看似能配置、实际不生效。系统需要让管理员在同一个页面理解当前可用 source、保存本地 provider、配置 Agent 模型，并确认 Codex fallback 的登录状态。

## 怎么解决

管理员在系统页面维护图片 provider source order、本地 OpenAI-compatible provider、Codex fallback 和 Agent LLM 设置。系统保存后读取同一份配置来决定图片生成 provider 和 Agent 规划模型，并在页面上只展示 masked secret 和可用性状态。环境变量 provider 仍是只读来源。

## 边界

- 不迁移旧存储中的 provider、Agent 或 Codex 配置；切换存储后需要重新保存设置或重新登录。
- 不为不同用户保存不同 provider 或 Agent 模型；这是工作站级全局配置。
- 不配置 OSS、MySQL、Redis、Mail Gateway 或其他部署凭据。
- 不保证配置的上游服务一定可用；它只保存配置并在运行时按现有 provider 错误语义反馈失败。

## 变更日志

- 2026-05-29：MySQL 模式接入图片 provider 配置、Agent LLM 配置和 Codex fallback token 持久化；SQLite 与 MySQL 共享系统页面配置契约，能力状态落为 current。
