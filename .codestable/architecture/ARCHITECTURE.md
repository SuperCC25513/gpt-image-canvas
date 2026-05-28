# GPT Image Canvas 架构总入口

> 状态：骨架（待填充）
> 创建日期：2026-05-21

## 1. 项目简介

GPT Image Canvas 是一个面向本地工作站的 AI 图像画布，支持文生图、参考图生成、多步 Agent 规划、生成资产管理、Gallery 公开展示和本地账号体系。

## 2. 核心概念 / 术语表

- **本地账号**：应用内账号，用于保护画布、Gallery 管理、资产、提供方配置、Agent 和后台管理能力。
- **自助注册**：未登录用户通过注册页创建本地账号的入口，受系统设置控制。
- **注册邮箱后缀支持列表**：后台系统设置中的邮箱域名白名单，只影响自助注册。列表非空时只允许精确匹配的邮箱域名注册；管理员显式保存空列表时表示不限制邮箱域名。
- **系统设置**：保存在 `app_settings` 的本地运行时配置，包括注册开关、审批策略、默认积分和注册邮箱后缀支持列表。

## 3. 子系统 / 模块索引

- **共享契约层**：`packages/shared/src/auth.ts` 和 `packages/shared/src/admin.ts` 定义前后端共用的认证、后台设置字段、默认注册邮箱域名和错误码。
- **认证域服务**：`apps/api/src/domain/auth/auth-store.ts` 负责读取注册策略、校验自助注册条件、创建用户和发放默认积分。
- **后台管理域服务**：`apps/api/src/domain/admin/admin-store.ts` 负责读取和更新系统设置，并在保存前规范化注册邮箱后缀支持列表。
- **持久化层**：SQLite 和 MySQL 的 `app_settings.allowed_registration_email_domains_json` 保存注册邮箱后缀支持列表。
- **Web 注册入口**：`apps/web/src/App.tsx` 展示当前支持的注册邮箱后缀，并把后端错误码映射为本地化提示。
- **Web 后台系统设置**：`apps/web/src/features/admin/AdminPage.tsx` 提供注册策略和邮箱后缀列表编辑入口。

## 4. 关键架构决定

- 注册策略集中在 `app_settings`，而不是分散在环境变量或前端配置里。当前纳入该策略的字段包括 `allowRegistration`、`requireApproval`、`defaultCredits` 和 `allowedRegistrationEmailDomains`。
- 注册邮箱后缀支持列表以 JSON 字符串持久化，API 层和共享契约层统一暴露为 `string[]`。SQLite 新库使用默认 JSON，MySQL 因 `TEXT` 默认值限制在应用启动和初始化时写入默认值。
- 默认注册邮箱后缀支持列表为 `126.com`、`139.com`、`163.com`、`189.cn`、`aliyun.com`、`gmail.com`、`qq.com`。
- 缺失字段、`NULL` 或无法解析的 JSON 都回退默认列表，避免旧库升级或坏数据把注册入口意外放开。
- 管理员显式保存空列表表示“不限制邮箱域名”，这是一个有意配置，不等同于字段缺失。

## 5. 已知约束 / 硬边界

- 注册邮箱后缀支持列表只限制新的自助注册，不影响已有用户登录、管理员账号 bootstrap、Codex OAuth 或提供方账号邮箱。
- 域名匹配只做邮箱 `@` 后部分的精确匹配；不支持通配符、正则、子域继承、MX 查询、邮箱验证码、一次性邮箱检测或黑名单策略。
- `allowRegistration=false` 是更高优先级的总开关。关闭自助注册后，不管邮箱域名是否在支持列表内，都应返回注册关闭语义。
- 域名检查发生在邮箱查重之前，避免对不支持域名泄露该邮箱是否已注册。
