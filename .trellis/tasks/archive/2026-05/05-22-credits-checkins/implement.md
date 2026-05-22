# 积分扣费与每日签到实施计划

## Ordered Checklist

- [x] 确认 `.trellis/tasks/05-22-user-auth-ownership` 已完成。
- [x] shared 增加 credits、checkin、积分不足错误码类型。
- [x] 增加 app settings 字段：注册积分、生成单价、签到奖励。
- [x] 增加 `credit_transactions` 和 `user_checkins`。
- [x] 注册流程接入注册送积分和流水。
- [x] `/api/auth/me` 返回余额和今日签到状态。
- [x] 新增 `POST /api/checkin`。
- [x] 生成入口增加事务预扣。
- [x] 生成失败路径增加全额退款。
- [x] 部分失败路径增加按输出数量退款。
- [x] Web 显示余额、预计消耗、签到入口。
- [x] Web 显示积分不足稳定提示。
- [x] 更新文档：积分规则、事务要求、验证步骤。

## Validation

- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] 新注册用户获得默认积分。
- [x] 每日签到第一次成功，第二次不加积分。
- [x] 积分不足时不调用 provider。
- [x] 生成成功扣费正确。
- [x] 全部失败退款正确。
- [x] 部分失败退款正确。
- [x] 所有余额变更都有流水。
- [x] 运行 `pnpm dev`，用内置浏览器验证余额和签到。

## Risky Files

- `apps/api/src/domain/generation/image-generation.ts`
- `apps/api/src/server/routes/images.ts`
- `apps/api/src/server/http/validation.ts`
- `apps/api/src/domain/auth/*`
- `apps/web/src/features/canvas/*`
- `apps/web/src/shared/i18n/index.tsx`

## Rollback

- 若扣费影响生成稳定性，先用设置将 `generation_credit_cost=0` 暂停扣费。
- 不删除积分流水表；回滚代码后保留审计数据。
