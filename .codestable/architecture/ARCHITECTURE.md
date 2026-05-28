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
- **Redis runtime**：API 进程内统一的 Redis 连接、配置读取、健康检查和关闭入口，当前用于支撑后续生成调度，不直接实现队列、重试或 provider 并发闸门。
- **queue driver**：生成调度运行模式，取值 `redis` 或 `inline`。`redis` 是默认运行模式；`inline` 只用于测试或显式本地调试。
- **生成调度运行态**：后续 provider permit、队列、attempt、取消标记等短期协调状态。Redis 承载运行态，数据库仍是生成记录、输出、审计、资产和积分流水的事实来源。
- **全局 provider 并发数**：整个应用同一时刻允许打到当前图片 provider 的 provider API 请求总数。它不是单任务并发、单用户并发或 worker 数；具体闸门由 `provider-global-semaphore` 落地。

## 3. 子系统 / 模块索引

- **共享契约层**：`packages/shared/src/auth.ts` 和 `packages/shared/src/admin.ts` 定义前后端共用的认证、后台设置字段、默认注册邮箱域名和错误码。
- **认证域服务**：`apps/api/src/domain/auth/auth-store.ts` 负责读取注册策略、校验自助注册条件、创建用户和发放默认积分。
- **后台管理域服务**：`apps/api/src/domain/admin/admin-store.ts` 负责读取和更新系统设置，并在保存前规范化注册邮箱后缀支持列表。
- **持久化层**：SQLite 和 MySQL 的 `app_settings.allowed_registration_email_domains_json` 保存注册邮箱后缀支持列表。
- **Redis runtime 基础设施**：`apps/api/src/infrastructure/redis-runtime.ts` 负责解析 `REDIS_URL`、`GENERATION_QUEUE_DRIVER`、`REDIS_CONNECT_TIMEOUT_MS`，创建 node-redis singleton client，提供 `assertRedisReady()`、`checkRedisHealth()` 和 `closeRedisClient()`。
- **API 启动与健康检查**：`apps/api/src/server/app.ts` 在创建 app 时执行 Redis readiness；`apps/api/src/server/routes/core.ts` 的 `/api/health` 返回 `checks.redis=ok|disabled|unavailable`，Redis 不可用时返回 503。
- **进程生命周期**：`apps/api/src/index.ts` 在 shutdown 中关闭 Agent WebSocket、Redis client 和数据库连接，避免 dev/watch 或 smoke 测试残留句柄。
- **生成 Provider 调度规划**：`.codestable/roadmap/generation-provider-scheduler/` 记录 Redis runtime、全局 provider 并发闸门、队列、重试、状态桥和 Agent 接入的拆分；当前已完成 Redis runtime 底座。
- **Web 注册入口**：`apps/web/src/App.tsx` 展示当前支持的注册邮箱后缀，并把后端错误码映射为本地化提示。
- **Web 后台系统设置**：`apps/web/src/features/admin/AdminPage.tsx` 提供注册策略和邮箱后缀列表编辑入口。

## 4. 关键架构决定

- 注册策略集中在 `app_settings`，而不是分散在环境变量或前端配置里。当前纳入该策略的字段包括 `allowRegistration`、`requireApproval`、`defaultCredits` 和 `allowedRegistrationEmailDomains`。
- 注册邮箱后缀支持列表以 JSON 字符串持久化，API 层和共享契约层统一暴露为 `string[]`。SQLite 新库使用默认 JSON，MySQL 因 `TEXT` 默认值限制在应用启动和初始化时写入默认值。
- 默认注册邮箱后缀支持列表为 `126.com`、`139.com`、`163.com`、`189.cn`、`aliyun.com`、`gmail.com`、`qq.com`。
- 缺失字段、`NULL` 或无法解析的 JSON 都回退默认列表，避免旧库升级或坏数据把注册入口意外放开。
- 管理员显式保存空列表表示“不限制邮箱域名”，这是一个有意配置，不等同于字段缺失。
- Redis 是生成调度的必需运行依赖。默认 `REDIS_URL` 是 `redis://127.0.0.1:6379`；Docker Compose 使用内部 `redis://redis:6379`。
- `GENERATION_QUEUE_DRIVER=redis` 是默认模式。Redis 不可用时 API readiness 或 health 必须失败，不能静默回退到旧的无限 provider 并发路径。
- `GENERATION_QUEUE_DRIVER=inline` 只用于测试或显式本地调试，smoke 测试需要主动设置该值以避免依赖本机 Redis。
- Redis 只保存生成调度运行态。生成记录、输出、审计、资产、积分交易和本地账号数据继续保存在数据库或资产存储中。
- `/api/health` 可以暴露 Redis 状态枚举，但不能暴露 `REDIS_URL`、密码、Redis 主机拓扑或原始连接错误。

## 5. 已知约束 / 硬边界

- 注册邮箱后缀支持列表只限制新的自助注册，不影响已有用户登录、管理员账号 bootstrap、Codex OAuth 或提供方账号邮箱。
- 域名匹配只做邮箱 `@` 后部分的精确匹配；不支持通配符、正则、子域继承、MX 查询、邮箱验证码、一次性邮箱检测或黑名单策略。
- `allowRegistration=false` 是更高优先级的总开关。关闭自助注册后，不管邮箱域名是否在支持列表内，都应返回注册关闭语义。
- 域名检查发生在邮箱查重之前，避免对不支持域名泄露该邮箱是否已注册。
- 本地无密码 Redis 只适合绑定本机或受控 Docker/内网网络，不得公网暴露；远程 Redis 的 ACL/TLS/网络隔离属于独立部署安全工作。
- 当前 Redis runtime foundation 不实现 provider semaphore、generation queue、worker、retry、取消恢复或 Redis key 协议；这些由 `generation-provider-scheduler` 后续子 feature 实现。
- 后续生成调度模块必须复用 `redis-runtime.ts` 的 runtime API，不应重新解析 Redis env 或创建独立 Redis client。
- 只有完成 `provider-global-semaphore` 后，系统才真正限制“整个应用同时打到唯一 provider 的请求总数”。
