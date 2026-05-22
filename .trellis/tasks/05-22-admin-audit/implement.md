# 后台管理与生成审计实施计划

## Ordered Checklist

- [ ] 确认用户权限、积分签到任务已完成。
- [ ] shared 增加 admin 用户、设置、审计类型。
- [ ] 新增 admin middleware。
- [ ] 新增用户列表和用户更新接口。
- [ ] 新增管理员积分调整接口，写积分流水。
- [ ] 新增系统设置读取和更新接口。
- [ ] 新增生成请求审计表和 store。
- [ ] 在生成入口写入审计开始记录。
- [ ] 在生成成功/失败/部分失败路径更新审计记录。
- [ ] Web 新增后台入口，仅 admin 可见。
- [ ] Web 新增用户管理视图。
- [ ] Web 新增系统设置视图。
- [ ] Web 新增生成审计视图。
- [ ] i18n 增加中英文文案。
- [ ] 更新安全和运营文档。

## Validation

- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] 普通用户访问 admin API 返回 403。
- [ ] 管理员可修改其他用户角色和状态。
- [ ] 管理员不能禁用或降级自己。
- [ ] 管理员调分后余额和流水正确。
- [ ] 管理员可修改注册/审核/积分/签到设置。
- [ ] 生成请求写审计，成功和失败都更新状态。
- [ ] 后台接口不返回原始密钥或 token。
- [ ] 运行 `pnpm dev`，用内置浏览器验证后台桌面和移动基本可用。

## Risky Files

- `apps/api/src/server/app.ts`
- `apps/api/src/server/routes/admin.ts`
- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/domain/auth/*`
- `apps/web/src/App.tsx`
- `apps/web/src/shared/i18n/index.tsx`
- `apps/web/src/styles/*`

## Rollback

- 若后台 UI 有问题，可先隐藏入口，保留 admin API。
- 若审计写入影响生成，先降级为 best-effort 写入，但不能影响 provider 调用结果。
