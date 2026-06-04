# 画布 ToC 配置入口回归检查设计

## 范围边界

本任务按“配置能力后台化、ToC 创作页只保留生图参数”的产品边界设计。配置能力包括 provider source order、OpenAI-compatible API Key、Base URL、模型名、timeout、Codex 登录/退出、Agent LLM API Key、Base URL、模型名、supports vision，以及规划模型行为开关。

ToC 创作参数包括 prompt/Agent 消息、尺寸、宽高、质量、输出格式、数量、参考图、生成/编辑模式，以及与输出直接相关的视觉选项。

## 用户界面设计

### 画布 Agent 头部

- 将 `agent-model-pill` 从“可点击模型配置入口”改为只读服务状态。
- 管理员和普通用户都不通过该状态控件进入后台。
- 有配置时展示类似“Agent 可用 / 视觉理解可用”或更短状态，不突出全局模型名。
- 无配置或错误时展示“Agent 暂不可用 / 请联系管理员”类状态，不出现“前往后台配置模型”。
- 保留刷新配置状态按钮，或改成“重新检查状态”；它只刷新状态，不打开配置。

### Agent 参数弹层

- 保留尺寸、宽高、质量、输出格式、参考状态，因为它们是生成输出参数。
- DeepSeek thinking / reasoning effort 默认按配置能力处理：移除 ToC 控件，或迁移到后台配置默认值。
- 对话卡片里的“思考中 / 正在分析”可以作为只读进度状态保留；“查看原始思考”和用户可调推理强度默认不在 ToC 暴露。
- 如果产品最终要求保留 thinking 控件，需要将其重命名为创作质量/规划深度，并在 PRD 中明确这是用户创作参数，不是系统配置。

### 简单生成与其他 ToC 页面

- 替换 `providerStatusNoneCopy` 等配置导向文案，避免普通用户看到“后台生成服务页保存 API Key / 登录 Codex”作为行动入口。
- 普通用户缺少 provider 时显示“生成服务暂不可用，请联系管理员”。
- 管理员也不在 ToC 状态卡中获得直接配置跳转；后台导航仍是唯一配置入口。

### 后台

- Admin providers tab 继续作为系统配置唯一 UI。
- 保持 `ProviderConfigPanel` 的 masked secret、保存、刷新、Codex 登录能力。
- 若 ToC 页面依赖配置状态刷新，继续通过回调让后台保存后刷新画布 Agent 状态。

## API 与权限设计

- 当前 `/api/provider-config` 和 `/api/agent-config` 已经调用 `requireAdmin`，实现阶段至少需要回归测试这个事实。
- 可选改进：将配置接口迁移到 `/api/admin/provider-config` 和 `/api/admin/agent-config`，并更新 Admin provider panel 调用。
- 如果迁移接口路径，需决定旧路径是否保留兼容：
  - 推荐短期保留旧路径但继续 admin-only，并在代码注释或任务记录中标明它是兼容入口。
  - 若直接移除旧路径，必须确认没有外部脚本或 smoke 依赖旧路径。
- 任何配置读取响应仍只返回 masked secret；ToC 页面不应调用配置详情接口来拿模型名展示。

## 文档设计

- 更新 `docs/product-specs/provider-configuration.md`：从“用户选择 provider”改为“管理员在后台配置全局生成服务，ToC 用户只看到可用状态”。
- 如 `docs/PRODUCT_SENSE.md` 的 Provider Configuration 仍暗示用户配置，需要同步措辞。
- `.codestable/architecture/ARCHITECTURE.md` 已记录 admin-only 全局配置，可作为实现依据；若实现调整 API 路径，需要后续 CodeStable 收尾更新。

## 兼容与风险

- 风险：过度隐藏 provider 状态会让用户不知道为什么不能生成。缓解：保留清晰可见的服务状态和稳定错误提示。
- 风险：移除模型名展示后管理员失去快速确认当前模型的入口。缓解：后台 providers 页保留完整配置，ToC 页只显示可用/不可用。
- 风险：接口路径迁移会影响 smoke 或旧调用方。缓解：先搜索所有 `/api/provider-config`、`/api/agent-config` 调用，再决定兼容策略。
- 风险：Agent 对话规划过程的思考展示与用户可调模型参数边界不清。缓解：保留只读进度状态，移除或后台化可调推理参数和原始思考展开。

## 回归观察点

- 管理员登录状态下访问 `/canvas`，不能从 Agent 状态控件跳转后台。
- 普通用户登录状态下访问 `/canvas`，看不到配置型模型名或后台配置行动文案。
- 缺少 Agent 配置时，Agent 输入不可执行但提示清楚。
- 缺少图片 provider 时，手动生成不可执行但提示清楚。
- 后台 `/admin/providers` 仍能保存并刷新配置状态。
