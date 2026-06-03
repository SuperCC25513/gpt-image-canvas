# 画布 ToC 配置入口回归检查

## 背景

线上画布页 Agent 面板顶部仍显示“视觉模型 / gpt-5.4”模型入口。管理员悬停时会出现“前往后台生成服务配置模型”，点击可跳到后台 provider 配置页。当前产品定位已调整为 ToC：普通用户只应配置生图参数，不应看到或进入生成服务、Agent LLM、provider、API Key、Base URL、source order、Codex 登录等系统配置能力。

这次任务不是只修一个按钮，而是做一次全站回归：所有配置相关入口必须收敛到后台；ToC 用户界面只保留创作所需的生图参数和清晰的服务状态。

## 目标

将配置能力从 ToC 创作流中下沉到后台，避免普通用户在画布、简单生成等创作页看到“去配置模型/服务”的入口或配置型文案，同时保留用户可理解的生成服务状态、缺失服务提示和生图参数控制。

## 已确认事实

- 画布 Agent 头部位于 `apps/web/src/features/canvas/CanvasApp.tsx`，`agent-model-pill` 当前显示模型能力和模型名。
- `agent-model-pill` 对管理员可点击并调用 `navigateToAdminTab("providers")`，tooltip 文案为 `agentOpenModelConfig`。
- 普通用户不会进入后台，但仍能看到模型能力/模型名以及“联系管理员配置 Agent LLM”类配置文案。
- Agent 参数弹层中已有生图参数：尺寸、宽高、质量、输出格式、参考状态；这些属于用户可配置的创作参数。
- Agent 对话里会出现“思考 / 查看原始思考”，这是 Agent 在聊天规划过程中的分析展示；参数弹层里的 DeepSeek 思考开关和 reasoning effort 是规划模型行为参数，不属于图片生成参数。
- 简单生成页缺失 provider 状态复用 `providerStatusNoneCopy`，当前文案会指向“后台生成服务页保存 API Key，或登录 Codex”。
- Provider/Agent 配置面板已放在 Admin providers tab：`apps/web/src/features/admin/AdminPage.tsx` 渲染 `ProviderConfigPanel`。
- 后端 `/api/provider-config` 和 `/api/agent-config` 当前已调用 `requireAdmin`，但路径仍不是 `/api/admin/*`。
- `.codestable/architecture/ARCHITECTURE.md` 记录 Provider 和 Agent LLM 配置是 admin-only 全局配置。
- `docs/product-specs/provider-configuration.md` 仍保留“用户理解和选择 provider”的旧口径，需要更新为后台系统配置边界。

## 需求

- 画布页普通创作界面不得提供跳转后台、打开 provider/Agent 配置、登录 Codex、编辑 API Key、编辑 Base URL、选择 source order、切换模型的入口。
- 画布 Agent 面板不得把全局 Agent LLM 模型名作为 ToC 主界面卖点暴露；需要改成用户可理解的服务状态或 Agent 可用状态。
- 管理员在画布页也不应通过创作页控件进入后台配置；后台配置入口只保留在全站后台导航和 Admin providers 页面内。
- 普通用户只可配置生图参数：提示词/Agent 消息、尺寸、宽高、质量、输出格式、数量、参考图、必要的风格/生成选项。
- Agent 的对话规划过程参数（例如 thinking 开关、reasoning effort、原始思考展示）默认视为模型行为配置，不在 ToC 创作页暴露；若后续要保留，必须先有明确产品决策。
- 缺少生成服务或 Agent 配置时，ToC 页面应展示清晰状态和下一步，但文案不得引导用户自行进入后台配置；建议语义是“生成服务暂不可用，请联系管理员”。
- 后台 providers 页面继续承载图片 provider、Agent LLM、Codex source order 等配置能力，并保持 masked secret、admin-only、保存刷新能力不退化。
- API 层要回归验证 provider/Agent 配置接口只允许 admin 操作；如迁移到 `/api/admin/*`，旧路径兼容和调用方更新需要明确处理。
- 所有可见文案必须走 `apps/web/src/shared/i18n/index.tsx` 的中英文翻译。
- 产品文档需要同步新边界，避免后续实现再次把系统配置入口放回 ToC 页面。

## 验收标准

- [ ] 画布页 Agent 面板不再出现“前往后台生成服务配置模型”入口，管理员和普通用户都无法从该控件跳到 Admin providers。
- [ ] 画布页 Agent 顶部状态不再以全局模型名为核心展示；无配置、有配置、加载、错误状态都用 ToC 可理解文案表达。
- [ ] 画布页只保留生图参数入口；尺寸、宽高、质量、输出格式、参考状态等仍可配置并参与 Agent 计划默认值。
- [ ] Agent thinking/reasoning 控件和“查看原始思考”展示按产品决策移除、后台化或降级为只读进度状态；若保留，任务文档和 UI 文案必须说明它是对话规划过程，不是生图参数。
- [ ] 简单生成页、首页/onboarding、Gallery、提示池、作品库等 ToC 页面没有 provider/Agent 配置入口或“去后台配置模型/API Key/Base URL”的用户行动文案。
- [ ] 后台 Admin providers 页仍能加载、保存图片 provider 和 Agent LLM 配置，并能刷新画布 Agent 配置状态。
- [ ] `/api/provider-config`、`/api/agent-config` 或迁移后的 `/api/admin/*` 配置接口对非 admin 返回拒绝，对 admin 正常返回 masked 配置；不得泄露 raw secret。
- [ ] 缺少生成服务时，手动生成和 Agent 执行仍被阻止，并显示稳定、不会泄露凭据细节的提示。
- [ ] `docs/PRODUCT_SENSE.md` 或 `docs/product-specs/provider-configuration.md` 至少一处更新为新产品边界：ToC 创作页只展示状态和生图参数，系统配置只在后台。
- [ ] 完成实现后运行 `nvm use 24.15.0 && pnpm typecheck`、`nvm use 24.15.0 && pnpm build`。
- [ ] UI 回归需运行 `nvm use 24.15.0 && pnpm dev`，用浏览器验证 `http://localhost:5173/canvas` 和 `http://localhost:5173/generate` 的桌面与移动视口。

## 不在本任务范围

- 不重做 Admin providers 页的完整视觉结构，除非为移除 ToC 入口必须小幅调整。
- 不变更 provider source order、secret masking、Codex OAuth、SQLite/MySQL 持久化业务规则。
- 不新增普通用户自助配置 provider 或 Agent LLM 的能力。
- 不修改图片生成模型真实调用逻辑，除非 UI/API 路由迁移必须同步调用方。

## 待确认决策

- Agent 对话规划过程里的 thinking / reasoning effort / 原始思考展示是否也必须从 ToC 创作页移除？推荐保留“正在分析”这类只读进度状态，移除用户可调的推理强度和原始思考展开，因为它们配置或暴露的是 Agent LLM 推理行为，不是图片生成参数；保留的代价是 ToC 页面仍存在“模型行为配置”边界争议。
