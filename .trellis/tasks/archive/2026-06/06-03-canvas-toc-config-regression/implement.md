# 画布 ToC 配置入口回归检查执行计划

## 开工前读取

- `docs/PRODUCT_SENSE.md`
- `docs/DESIGN.md`
- `docs/FRONTEND.md`
- `docs/SECURITY.md`
- `docs/product-specs/provider-configuration.md`
- `.codestable/architecture/ARCHITECTURE.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`

## 实施步骤

1. 盘点入口
   - 搜索 `agentOpenModelConfig`、`agentConfigAskAdmin`、`providerStatusNoneCopy`、`ProviderConfigDialog`、`/api/provider-config`、`/api/agent-config`。
   - 列出所有 ToC 页面里会展示配置型入口或配置型行动文案的位置。

2. 调整画布 Agent 头部
   - 将 `agent-model-pill` 改成只读状态或替换为新的状态组件。
   - 移除 `navigateToAdminTab("providers")` 触发链。
   - 更新 `data-testid` 或新增测试定位，方便浏览器回归确认。

3. 调整 Agent 参数弹层
   - 保留生图参数：尺寸、宽高、质量、输出格式、参考状态。
   - 按用户确认结果处理对话规划过程里的 thinking / reasoning effort / 原始思考展示：默认保留只读“正在分析”状态，移除或后台化可调推理参数和原始思考展开。
   - 确认发送 Agent 消息时仍能传递有效的生成默认值。

4. 调整 ToC 文案
   - 更新 `apps/web/src/shared/i18n/index.tsx` 中配置导向文案。
   - 区分 Admin providers 页面文案和 ToC 状态文案，不复用会引导去后台的文本。
   - 同步中英文。

5. 回归 Admin providers
   - 确认 `ProviderConfigPanel` 仅在 Admin 页面渲染。
   - 确认后台保存后仍刷新 auth status 和 Agent config 状态。
   - 如迁移 API 路径，更新前端调用、smoke 和文档；否则保留旧路径但记录 admin-only 边界。

6. 更新产品文档
   - 更新 provider 配置产品规格的新边界。
   - 如设计或安全文档有冲突措辞，同步修正。

7. 验证
   - 运行类型和构建验证。
   - 启动本地应用做浏览器回归。

## 验证命令

```sh
nvm use 24.15.0
pnpm typecheck
pnpm build
```

UI 回归：

```sh
nvm use 24.15.0
pnpm dev
```

浏览器验证 `http://localhost:5173/canvas` 和 `http://localhost:5173/generate`：

- 桌面视口：确认画布 Agent 头部无后台配置入口，生图参数可打开和修改。
- 移动视口：确认右侧面板或抽屉没有文字重叠、隐藏配置入口后布局不塌。
- 管理员账号：确认 `/admin/providers` 仍能进入并保存配置。
- 普通账号：确认不能进入 Admin，ToC 页面无配置入口。
- 缺少 provider/Agent 配置：确认生成/Agent 执行阻止和提示稳定。

可选 API 回归：

```sh
nvm use 24.15.0
pnpm --filter @gpt-image-canvas/api smoke:provider-config
```

## 执行记录

- 已将画布 Agent 头部调整为只读服务状态，不再展示全局模型名或跳转后台 provider 配置。
- 已移除画布 Agent 的 thinking/reasoning 用户控件和原始思考展开；仅保留“正在分析”只读进度消息。
- 已新增 `GET /api/agent-config/status` 作为 ToC 可用状态接口；`/api/agent-config` 和 `/api/provider-config` 继续保持 admin-only。
- 已将简单生成页 provider chip 改为通用生成服务状态，缺失服务时提示联系管理员。
- 已同步更新 provider 配置、新用户 onboarding 与产品边界文档，明确 ToC 创作页只展示状态和生图参数，系统配置只在后台。
- 二轮代码审计发现画布页仍有 Agent Skill 行为配置入口，已迁移到后台 `/admin/agent-skills`。
- 二轮代码审计发现 Agent 状态刷新失败会保留旧可用状态，已在刷新失败时清空 `agentConfig`。

## 验证记录

- `nvm use 24.15.0 && pnpm typecheck`：通过。
- `nvm use 24.15.0 && pnpm build`：通过；Vite 保留既有大 chunk 警告。
- `GET http://127.0.0.1:8787/api/agent-config/status`：`200 {"configured":false,"supportsVision":false}`。
- `GET http://127.0.0.1:8787/api/agent-config`：未登录返回 `401`。
- `GET http://127.0.0.1:8787/api/provider-config`：未登录返回 `401`。
- `GET http://127.0.0.1:5174/canvas`：`200`；本轮验证时 `5173` 未监听，Vite 使用 `5174`。
- 浏览器回归已覆盖桌面 `/canvas`、桌面 `/generate`、桌面 `/admin/providers`、移动 `/canvas`、移动 `/generate`：ToC 页面未发现配置入口词，后台 providers 保留配置和 Codex 操作。
- 二轮修复后 `nvm use 24.15.0 && pnpm typecheck`：通过。
- 二轮修复后 `nvm use 24.15.0 && pnpm build`：通过；Vite 保留既有大 chunk 警告。
- 二轮修复后隔离临时 `DATA_DIR` 启动 `pnpm dev`，用 headless Chrome 验证桌面 `/canvas` 手动 tab、桌面 `/canvas` Agent tab、桌面 `/generate`、后台 `/admin/agent-skills`、移动 `/canvas`：ToC 页面无配置入口词，Agent tab 无 `agent-skills-open` 与 thinking/reasoning 控件，后台 Agent Skills 能打开 Agent Skill Library。
- 二轮修复后 `GET /api/agent-config/status` 返回 `200 {"configured":false,"supportsVision":false}`；未登录访问 `/api/agent-config` 和 `/api/provider-config` 均返回 `401`。

## 风险文件

- `apps/web/src/features/canvas/CanvasApp.tsx`
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx`
- `apps/web/src/shared/i18n/index.tsx`
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`
- `apps/api/src/server/routes/provider-config.ts`
- `apps/api/src/server/routes/agent-config.ts`
- `docs/product-specs/provider-configuration.md`
- `docs/PRODUCT_SENSE.md`

## 已决策事项

- Agent 对话规划过程里的“查看原始思考”和 thinking / reasoning effort 按模型行为配置处理，不在 ToC 创作页暴露；仅保留只读“正在分析”状态。
- 本任务不迁移 `/api/provider-config`、`/api/agent-config` 到 `/api/admin/*`；现有路径继续保留，但配置详情接口保持 admin-only，ToC 使用 `/api/agent-config/status`。
