---
doc_type: audit-finding
audit: 2026-05-28-backend-redemption-credit-ledger
finding_id: "bug-03"
nature: bug
severity: P2
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 03：MySQL 每日签到并发首次请求可能撞唯一键并返回通用错误

## 速答

MySQL 签到流程先 `SELECT ... FOR UPDATE` 查当天记录；如果记录不存在，随后直接插入 `(user_id, checkin_date)` 主键。两个首次签到请求在部分 MySQL 隔离级别或配置下可能同时看不到记录，后提交者撞主键后被当成未知错误处理，而不是稳定返回“今天已签到”。

## 关键证据

- `apps/api/src/domain/credits/credit-store.ts:186` — MySQL 签到路径获取连接并开启事务。
- `apps/api/src/domain/credits/credit-store.ts:190` — `SELECT credits_awarded ... WHERE user_id = ? AND checkin_date = ? FOR UPDATE` —— 先查已有签到记录。
- `apps/api/src/domain/credits/credit-store.ts:198` — `if (existingRows[0]) { ... return checkedInToday: true ... }` —— 已存在时是幂等响应。
- `apps/api/src/domain/credits/credit-store.ts:211` — `INSERT INTO user_checkins (user_id, checkin_date, credits_awarded, created_at)` —— 不存在时直接插入主键。
- `apps/api/src/infrastructure/mysql-database.ts:124` — `PRIMARY KEY (user_id, checkin_date)` —— 并发重复插入会触发唯一键。
- `apps/api/src/domain/credits/credit-store.ts:247` — `} catch (error) { await connection.rollback(); throw error; }` —— 唯一键错误没有转成“已签到”。
- `apps/api/src/server/routes/auth.ts:64` — `/api/checkin` 路由调用 `checkInUser`。
- `apps/api/src/server/routes/auth.ts:72` — `catch (error) { return authErrorJson(error); }` —— 只会把 `CreditDomainError` 转成领域错误；数据库唯一键不是该类型。

## 影响

正常用户快速双击、浏览器重试或移动网络重复提交时，首次签到可能一个成功、一个收到通用认证请求失败/400，而不是稳定的已签到状态。账务不会双发，因为主键会挡住重复插入，但用户体验和客户端重试语义不稳定。

## 修复方向

把 `user_checkins` 插入改成 upsert/insert-ignore 后重新读取状态，或捕获 duplicate key 并返回已有签到记录；SQLite 路径也可统一成同一幂等模式。

## 建议动作

`cs-issue`，因为这是并发幂等 bug，适合用重复签到请求测试验证。
