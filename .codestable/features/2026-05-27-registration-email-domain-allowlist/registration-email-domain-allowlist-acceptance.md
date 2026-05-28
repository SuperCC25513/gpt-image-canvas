# 注册邮箱后缀支持列表验收报告

> 验收日期：2026-05-27
> 对应设计：`registration-email-domain-allowlist-design.md`
> 对应需求：`registration-email-domain-allowlist`

## 1. 接口契约核对

- 已通过 `AuthSettings.allowedRegistrationEmailDomains` 和 `AdminSettings.allowedRegistrationEmailDomains` 暴露统一字段。
- 已在共享契约中定义默认 7 项邮箱后缀、规范化函数、JSON 解析回退函数和 `email_domain_not_allowed` 错误码。
- `/api/admin/settings` 的 GET/PATCH 已支持 `allowedRegistrationEmailDomains: string[]`；无效域名会返回 `invalid_admin_settings`。
- 注册失败时，不支持邮箱域名返回 `403 + email_domain_not_allowed`。

## 2. 行为与决策核对

- 默认支持列表为 `126.com`、`139.com`、`163.com`、`189.cn`、`aliyun.com`、`gmail.com`、`qq.com`。
- 管理员保存时会去空行、去重、转小写，并允许用户输入带 `@` 的域名。
- 管理员显式保存空列表表示“不限制邮箱域名”。
- 字段缺失、`NULL` 或坏 JSON 回退默认 7 项，不会误判为不限制。
- 注册编排顺序为：注册总开关、邮箱域名支持列表、邮箱查重、用户创建、默认积分。

## 3. 验收场景核对

- 默认配置下，`user@qq.com` 可继续进入注册流程。
- 默认配置下，`user@example.com` 在创建用户前被拒绝，并返回 `email_domain_not_allowed`。
- `allowRegistration=false` 时，邮箱域名即使被支持也返回 `registration_disabled`。
- 后台把列表保存为空后，合法邮箱格式不再受域名限制。
- 后台保存 `@QQ.COM` 和重复项后回显为规范化结果 `qq.com`。
- 旧库字段为 `NULL` 或坏 JSON 时，`/api/auth/me` 和注册校验都按默认 7 项执行。

## 4. 术语一致性

- 产品和文档统一使用“注册邮箱后缀支持列表”描述管理员可配置能力。
- 实现层字段统一为 `allowedRegistrationEmailDomains`。
- 数据库字段统一为 `allowed_registration_email_domains_json`。
- 错误码统一为 `email_domain_not_allowed`。

## 5. 架构归并

- 已回写 `.codestable/architecture/ARCHITECTURE.md`，补充系统设置、认证域服务、后台管理域服务、持久化字段、Web 注册入口和后台系统设置的职责。
- 已记录关键边界：该列表只限制新自助注册，不影响已有登录、管理员 bootstrap、Codex OAuth 或提供方账号邮箱。
- 已记录空列表、缺失字段和坏数据的不同语义。

## 6. requirement 回写

- 已将 `.codestable/requirements/registration-email-domain-allowlist.md` 从 `draft` 更新为 `current`。
- 已把实现 feature 记录到 `implemented_by`。
- 已把 `registration-email-domain-allowlist` 从 `VISION.md` 的 `draft` 移到 `current`。

## 7. roadmap 回写

- 本需求不是从 roadmap 条目拆出，当前没有 roadmap 回写项。

## 8. attention.md 候选盘点

- 已用 `cs-note` 写入 `.codestable/attention.md`：依赖临时 SQLite 的 smoke 测试需要显式设置 `USE_MYSQL=false`，否则本机 `.env` 如果配置了 `USE_MYSQL=true`，测试会连到 MySQL 或全局运行库。

## 9. 遗留

- 未新增邮箱验证码、MX 查询、一次性邮箱检测、黑名单、通配符、正则或子域继承，符合设计边界。
- 本功能仍是本地工作站账号边界的一部分，不构成公网部署安全方案。
- 构建通过但 Vite 仍有既有 chunk size warning，和本功能无直接关系。
