# 管理后台生成服务配置平铺实施计划

## 当前判断

代码已基本符合 PRD：

- `AdminPage` 的 `providers` tab 已直接渲染 `ProviderConfigPanel variant="page"`。
- `ProviderConfigPanel` 同时服务 page 和 dialog 两种入口。
- 原弹窗外壳 `ProviderConfigDialog` 仍存在。

实现阶段先做验证，再根据实际缺口做最小修补。

## 修改顺序

1. 前置规范读取。
   - 读取 `.trellis/spec/web/frontend/index.md`。
   - 读取 `.trellis/spec/shared/contracts/index.md`。
   - 读取 `docs/PRODUCT_SENSE.md`、`docs/DESIGN.md`、`docs/FRONTEND.md`、`docs/design-docs/interaction-quality.md`。

2. 代码复核。
   - 检查 `apps/web/src/features/admin/AdminPage.tsx`：
     - providers tab 是否直接渲染 `ProviderConfigPanel variant="page"`。
     - 是否没有“打开生成服务配置”按钮作为主路径。
   - 检查 `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`：
     - `ProviderConfigPanel` 是否统一加载 / 保存 / 刷新 / 掩码 / Codex 登录退出。
     - `ProviderConfigDialog` 是否继续复用面板。
   - 检查 `apps/web/src/features/canvas/CanvasApp.tsx`：
     - 后台页是否收到 `providerConfig` 回调。
     - 旧弹窗入口是否仍收到同一组回调。

3. 若发现缺口，按最小范围修补。
   - 首选调整 `ProviderConfigPanel` props / variant 样式。
   - 只在必要时修改 `AdminPage`。
   - 不新增 Provider API 或 shared 字段。
   - 用户可见文案如变更，同步 `zh-CN` 和 `en`。

4. CSS 复核。
   - 检查 `apps/web/src/styles/provider-config.css`。
   - 检查 `apps/web/src/styles/admin.css`、`responsive.css` 里相关布局。
   - 不新增 `transition: all`。
   - 保持 page variant 无 fixed/backdrop 行为。

5. 浏览器验证。
   - 打开 `http://localhost:5173/admin/providers`。
   - 桌面视口确认：
     - 不需要点击弹窗按钮即可看到配置主体。
     - 生图模型 tab 可见：当前来源、来源顺序、来源详情、本地配置。
     - Agent 大模型 tab 可见。
     - 刷新 / 保存按钮可见。
     - Codex 登录 / 退出入口可见。
   - 移动视口确认：
     - 面板无横向页面溢出。
     - 输入框、tab、按钮不重叠。

## 验证命令

```bash
source ~/.nvm/nvm.sh
nvm use 24.15.0
pnpm typecheck
pnpm build
pnpm dev
```

## 验收清单

- [ ] `/admin/providers` 打开后直接展示生成服务配置主体。
- [ ] 主路径没有只剩“打开生成服务配置”按钮。
- [ ] 图像模型、Agent 大模型、来源顺序、来源详情可见。
- [ ] 保存 / 刷新沿用 `ProviderConfigPanel`。
- [ ] 密钥掩码显示沿用现有逻辑。
- [ ] Codex 登录 / 退出入口可见。
- [ ] 旧弹窗入口仍使用 `ProviderConfigDialog`。
- [ ] 桌面和移动视口无明显遮挡 / 溢出。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。

## 回滚点

- `apps/web/src/features/admin/AdminPage.tsx`
- `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`
- `apps/web/src/styles/provider-config.css`
- `apps/web/src/styles/admin.css`
- `apps/web/src/styles/responsive.css`
