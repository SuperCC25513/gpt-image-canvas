# Provider 配置

## 目标

生成服务和 Agent LLM 是后台全局系统配置。管理员在后台维护 provider、凭据、source order、Codex 会话和 Agent LLM 参数；ToC 创作页只展示服务可用状态和用户创作所需的生图参数。

## ToC 创作页边界

画布、简单生成、作品库、提示池、图片广场和 onboarding 不提供系统配置入口。普通用户不应在创作流中看到 API Key、Base URL、source order、Codex 登录、Agent LLM 模型名、timeout 或推理强度等系统配置项。

ToC 页面可以展示：

- 生成服务可用、检查中、暂不可用等状态。
- 缺少生成服务或 Agent 服务时的稳定提示，文案指向“联系管理员”，不指向后台配置页。
- 用户创作参数，例如提示词、尺寸、宽高、质量、输出格式、数量、参考图、风格和生成模式。

ToC 页面不展示当前启用的具体 provider 来源、Codex 账号、全局模型名或凭据细节。

## 后台配置边界

后台 Providers 页面是系统配置唯一入口，负责：

- 图片 provider source order。
- 环境 OpenAI-compatible 配置状态。
- 应用数据库中保存的 OpenAI-compatible 配置。
- Codex 登录、退出和会话状态。
- Agent LLM API Key、Base URL、模型名、timeout 和 `supportsVision`。

环境配置来自 `.env` 或运行时变量，在后台只读展示。数据库配置在 SQLite 和 MySQL 模式下使用同一后台页面契约；切换到 MySQL 不迁移已有 SQLite provider、Codex 或 Agent LLM 配置，需要管理员重新保存。

## Agent LLM 配置

Agent 规划使用独立的 OpenAI-compatible chat 配置。图片 provider 可用不代表 Agent LLM 已配置，Agent LLM 可用也不代表图片 provider 可用。

Agent 对话中可以保留“正在分析”这类只读进度状态，但原始思考内容、thinking 开关、reasoning effort 等模型行为配置默认不在 ToC 创作页暴露。若后续要把它们作为用户创作参数，需要先更新产品决策和本规格。

## 变更验收

- ToC 页面没有跳转后台、登录 Codex、编辑 provider 或编辑 Agent LLM 的入口。
- ToC 页面缺服务提示不泄露凭据、模型、Base URL 或后台配置细节。
- 后台 Providers 页面仍能读取 masked secret、保存配置、保留 secret、刷新 provider 和 Agent LLM 状态。
- 配置详情接口保持 admin-only；非管理员不能读取或修改 provider/Agent 配置。
- ToC 状态接口只返回可用性这类非敏感字段，不返回模型名、Base URL、timeout、source order、账号或 secret mask。
- 安全规则继续遵守 `docs/SECURITY.md`。
