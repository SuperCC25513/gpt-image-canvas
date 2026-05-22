# 积分扣费与每日签到设计

## Architecture

本任务在用户身份完成后执行。积分作为用户生成能力的前置约束，必须在数据库事务里完成扣费和退款。

边界：

- `creditStore`：余额、流水、预扣、退款、注册赠送、签到。
- `settingsStore`：注册送积分、每张图消耗、签到奖励、单次生成上限。
- 生成入口：调用 provider 前预扣；失败路径退款。
- Web 用户状态：显示余额、签到状态、积分不足提示。

## Data Model

`users`：

- `credits` 作为当前余额。

`app_settings`：

- `default_credits`：默认 10。
- `generation_credit_cost`：默认 1。
- `checkin_credit`：默认 1。
- `max_images_per_request`：沿用现有生成上限，默认按产品配置。

`credit_transactions`：

- `id`
- `user_id`
- `delta`
- `reason`
- `related_generation_id`
- `related_output_id`
- `related_checkin_date`
- `admin_note`
- `created_at`

`user_checkins`：

- `user_id`
- `checkin_date`
- `credits_awarded`
- `created_at`
- 主键或唯一约束：`user_id + checkin_date`

## Generation Charging

流程：

1. 解析请求 count。
2. 读取 `generation_credit_cost`。
3. 计算 `cost = count * generation_credit_cost`。
4. 事务内检查余额并预扣。
5. 写扣费流水，关联 generation id。
6. 调用 provider。
7. 全部失败则全额退款。
8. 部分失败则按失败输出数量退款。
9. 退款写流水。

积分不足时不调用 provider，返回稳定错误码。

## Checkin

- `POST /api/checkin`：登录用户每日签到。
- 重复签到返回当前状态，不重复发积分。
- 签到成功写 `user_checkins` 和积分流水。
- `/api/auth/me` 返回余额和当天签到状态。

## Web UX

- 顶部或用户菜单显示余额。
- 生成按钮附近显示预计消耗。
- 积分不足时打开积分/签到提示。
- 签到入口显示今日是否已签到。

## Safety

- 所有余额变更必须有流水。
- 余额不能变成负数。
- 失败退款必须幂等，避免重复退款。
- 管理员调分由后台任务实现，本任务只提供底层能力或保留接口。
