# 修复前端业务逻辑风险执行计划

## 实施步骤

1. 更新 `App.tsx`
   - 给 `loadMe` 增加登录后刷新选项。
   - 登录/注册成功后刷新失败时保留 `body.user`。
   - 确认初次加载和登出仍会清空无效登录态。

2. 更新 `CanvasApp.tsx`
   - 将账号加载中、账号加载失败、未认证纳入生成禁用条件。
   - 同步禁用签到按钮。
   - 复用现有错误展示；必要时补 i18n 文案。

3. 更新 `GalleryPage.tsx`
   - 新增响应和 item runtime guard。
   - 加载接口使用 guard 后再 `setItems`。
   - 覆盖 `items` 非数组和 item shape 非法两类错误。

4. 更新 `AdminPage.tsx`
   - 当前管理员自己的角色/状态控件禁用。
   - 无 asset 的审计输出改为不可点击元素。

5. 验证
   - `source ~/.nvm/nvm.sh && nvm use 24.15.0`
   - `pnpm typecheck`
   - `pnpm build`
   - 如实现涉及可见 UI 状态，启动 `pnpm dev` 并用浏览器检查登录页、Canvas、Gallery、Admin 页面基本交互。

## 风险点

- Gallery guard 过严可能拒绝旧数据；实现时必须对照 `packages/shared/src/generation.ts` 的必需字段。
- `App.loadMe` 的错误处理不能让初次加载误保留空用户。
- Canvas 禁用逻辑不能阻断正常的账号加载完成路径。

## 完成前检查

- 没有提交 `.idea/`、`.pnpm-store/`、`package-lock.json` 等本地噪音。
- 没有修改后端权限模型。
- 新增文案同时覆盖 `zh-CN` 和 `en`。
