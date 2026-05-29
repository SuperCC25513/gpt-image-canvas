# GPT Image Canvas 架构总入口

> 状态：骨架（待填充）
> 创建日期：2026-05-21

## 1. 项目简介

GPT Image Canvas 是一个面向本地工作站的 AI 图像画布，支持文生图、参考图生成、多步 Agent 规划、生成资产管理、Gallery 公开展示和本地账号体系。

## 2. 核心概念 / 术语表

- **本地账号**：应用内账号，用于保护画布、Gallery 管理、资产、提供方配置、Agent 和后台管理能力。
- **自助注册**：未登录用户通过注册页创建本地账号的入口，受系统设置控制。
- **注册邮箱后缀支持列表**：后台系统设置中的邮箱域名白名单，只影响自助注册。列表非空时只允许精确匹配的邮箱域名注册；管理员显式保存空列表时表示不限制邮箱域名。
- **注册邮箱验证码**：发送到注册邮箱的一次性 6 位数字短码。用户必须用同邮箱未过期验证码完成自助注册。
- **验证挑战**：`registration_email_verifications` 中保存的注册验证码状态，包含邮箱、验证码 HMAC、过期时间、发送冷却和失败尝试次数；不保存明文验证码。
- **邮件网关**：cc-base Mail Gateway 内部 HTTP API。当前应用只调用 `POST /v1/emails/send` 发送 `verification_code` 邮件，并通过 `X-Api-Key` 鉴权；具体邮件服务商凭据留在网关内。
- **系统设置**：保存在 `app_settings` 的本地运行时配置，包括注册开关、审批策略、默认积分和注册邮箱后缀支持列表。
- **Redis runtime**：API 进程内统一的 Redis 连接、配置读取、健康检查和关闭入口，支撑生成调度的短期运行态，包括当前 provider permit 和后续队列 / 重试状态。
- **queue driver**：生成调度运行模式，取值 `redis` 或 `inline`。`redis` 是默认运行模式；`inline` 只用于测试或显式本地调试。
- **生成调度运行态**：后续 provider permit、队列、attempt、取消标记等短期协调状态。Redis 承载运行态，数据库仍是生成记录、输出、审计、资产和积分流水的事实来源。
- **全局 provider 并发数**：整个应用同一时刻允许打到当前图片 provider 的 provider API 请求总数。它不是单任务并发、单用户并发或 worker 数；当前闸门由 `provider-global-semaphore` 落地。
- **provider permit**：一次图片 provider API 调用执行前获得的短期租约；完成、失败或取消后释放，进程崩溃时依赖 TTL 自动过期。
- **provider retry policy**：单图 provider call 失败后的统一错误分类、指数退避和最终失败摘要策略。可恢复错误会重试，不可恢复错误直接失败收敛。
- **provider attempt**：一次重新进入 `runProviderCall()` 的 provider 调用尝试；retry sleep 期间不持有 provider permit。
- **generation queue job**：Redis 中的一条生成任务运行态，指向 DB 中的 `generation_records.id`。当前为 generation 级 job，不保存 prompt、reference bytes 或完整 provider input。
- **generation queue worker**：API 进程内后台消费者，从 Redis ready 队列取 generation job，重建 provider input，并复用现有 finish 流程完成 outputs、审计和退款。
- **generation state bridge**：API 启动时连接 DB generation record、Redis queue job、audit 和 credit transaction 的一致性恢复边界。它恢复 pending job、失败收敛 interrupted running record，并保证退款幂等。
- **generation queue observability**：后台管理员读取的生成调度快照，聚合 Redis health、ready queue 长度、worker 状态、provider permit 使用量、retry 配置、DB 状态计数和最近失败摘要。
- **Agent generation scheduler adapter**：Agent executor 和 generation queue / provider scheduler 之间的适配层。Redis driver 且没有 provider override 时走 generation queue；inline 或测试 provider override 时走 direct path。
- **scheduled Agent generation**：Agent plan job 触发的一次 DB generation record。Redis 模式下它先是 `pending` record + queue job，worker 执行后变为 `running` / terminal，再由 Agent executor 回写 plan job。

## 3. 子系统 / 模块索引

- **共享契约层**：`packages/shared/src/auth.ts` 和 `packages/shared/src/admin.ts` 定义前后端共用的认证、后台设置字段、默认注册邮箱域名、注册验证码请求/响应和错误码。
- **认证域服务**：`apps/api/src/domain/auth/auth-store.ts` 负责读取注册策略、校验自助注册条件、消费验证码挑战、创建用户和发放默认积分；`apps/api/src/domain/auth/registration-email-verification.ts` 负责验证码生成、HMAC、发送冷却、尝试次数和 Mail Gateway 调用。
- **后台管理域服务**：`apps/api/src/domain/admin/admin-store.ts` 负责读取和更新系统设置，并在保存前规范化注册邮箱后缀支持列表。
- **持久化层**：SQLite 和 MySQL 的 `app_settings.allowed_registration_email_domains_json` 保存注册邮箱后缀支持列表，`registration_email_verifications` 保存注册验证码挑战状态。
- **Redis runtime 基础设施**：`apps/api/src/infrastructure/redis-runtime.ts` 负责解析 `REDIS_URL`、`GENERATION_QUEUE_DRIVER`、`REDIS_CONNECT_TIMEOUT_MS`，创建 node-redis singleton client，提供 `assertRedisReady()`、`checkRedisHealth()` 和 `closeRedisClient()`。
- **Provider scheduler**：`apps/api/src/domain/generation/provider-scheduler.ts` 负责解析 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY`、`GENERATION_PROVIDER_PERMIT_TTL_MS`，并用 `runProviderCall()` 包住所有 `provider.generate` / `provider.edit` 单图调用。`GENERATION_QUEUE_DRIVER=redis` 时使用 Redis sorted set + Lua 原子 acquire；`inline` 时只使用进程内 semaphore。
- **Provider retry policy**：`apps/api/src/domain/generation/provider-retry-policy.ts` 负责解析 `GENERATION_PROVIDER_MAX_RETRIES`、`GENERATION_PROVIDER_RETRY_BASE_MS`、`GENERATION_PROVIDER_RETRY_MAX_MS`，并用 `runProviderCallWithRetry()` 包住单图 provider call。429、408、5xx、连接超时和临时网络中断会退避重试，missing provider/API key、400 参数错误、参考图非法和取消不重试。
- **Generation queue**：`apps/api/src/domain/generation/generation-queue.ts` 负责 `generation:queue:ready` ready list、`generation:job:{generationId}` job payload、worker polling 和 worker 生命周期。`apps/api/src/domain/generation/generation-tasks.ts` 在 Redis driver 下创建 pending record 并入队，inline driver 下保留旧 background task。
- **Generation state bridge**：`apps/api/src/domain/generation/generation-state-bridge.ts` 在 Redis driver 启动时先失败收敛 `running` generation、清理 stale Redis job，再从 DB pending record + audit visibility 恢复 queue job；缺失 audit visibility 时按 private 恢复。
- **Generation queue observability**：`apps/api/src/domain/generation/generation-queue-observability.ts` 为后台读取 `/api/admin/generation-queue` 聚合 queue runtime、provider scheduler、retry policy、Redis health 和 DB summary；`apps/web/src/features/admin/AdminPage.tsx` 在生成审计页展示该摘要。
- **Agent generation scheduler adapter**：`apps/api/src/domain/agent/generation-scheduler-adapter.ts` 负责让 Agent 生成在 Redis/no provider override 时调用 `startTextToImageGenerationTask` / `startReferenceImageGenerationTask` 入队，并轮询 DB generation record 到 terminal；inline 或 fake provider path 继续调用 direct `run*GenerationTask`。
- **API 启动与健康检查**：`apps/api/src/server/app.ts` 在创建 app 时执行 Redis readiness；`apps/api/src/server/routes/core.ts` 的 `/api/health` 返回 `checks.redis=ok|disabled|unavailable`，Redis 不可用时返回 503。
- **进程生命周期**：`apps/api/src/index.ts` 在 shutdown 中关闭 Agent WebSocket、generation queue worker、Redis client 和数据库连接，避免 dev/watch 或 smoke 测试残留句柄。
- **生成 Provider 调度规划**：`.codestable/roadmap/generation-provider-scheduler/` 记录 Redis runtime、全局 provider 并发闸门、队列、重试、状态桥和 Agent 接入的拆分；当前已完成 Redis runtime 底座、全局 provider 并发闸门、手动生成 Redis 队列 worker、provider retry policy 和 Agent queue adapter。
- **Web 注册入口**：`apps/web/src/App.tsx` 展示当前支持的注册邮箱后缀，提供“发送验证码 → 填码注册”的自助注册流程，并把后端错误码映射为本地化提示。
- **Web 后台系统设置**：`apps/web/src/features/admin/AdminPage.tsx` 提供注册策略和邮箱后缀列表编辑入口。

## 4. 关键架构决定

- 注册策略集中在 `app_settings`，而不是分散在环境变量或前端配置里。当前纳入该策略的字段包括 `allowRegistration`、`requireApproval`、`defaultCredits` 和 `allowedRegistrationEmailDomains`。
- 注册邮箱后缀支持列表以 JSON 字符串持久化，API 层和共享契约层统一暴露为 `string[]`。SQLite 新库使用默认 JSON，MySQL 因 `TEXT` 默认值限制在应用启动和初始化时写入默认值。
- 默认注册邮箱后缀支持列表为 `126.com`、`139.com`、`163.com`、`189.cn`、`aliyun.com`、`gmail.com`、`qq.com`。
- 缺失字段、`NULL` 或无法解析的 JSON 都回退默认列表，避免旧库升级或坏数据把注册入口意外放开。
- 管理员显式保存空列表表示“不限制邮箱域名”，这是一个有意配置，不等同于字段缺失。
- 自助注册必须先通过邮箱验证码门禁。`POST /api/auth/registration-email-verifications` 只发送验证码；`POST /api/auth/register` 只消费同邮箱有效验证码后才进入创建用户、注册送积分和会话创建流程。
- 注册验证码只保存 HMAC 哈希，不保存明文。当前 HMAC secret 复用 `MAIL_GATEWAY_API_KEY`；邮件网关地址和 key 来自 `MAIL_GATEWAY_BASE_URL`、`MAIL_GATEWAY_API_KEY`、`MAIL_GATEWAY_TIMEOUT_MS`，不写入系统设置或后台 UI。
- 邮件网关错误统一折叠为本地稳定错误码，不能向前端暴露网关 URL、API key、provider 原始错误或内部拓扑。
- Redis 是生成调度的必需运行依赖。默认 `REDIS_URL` 是 `redis://127.0.0.1:6379`；Docker Compose 使用内部 `redis://redis:6379`。
- `GENERATION_QUEUE_DRIVER=redis` 是默认模式。Redis 不可用时 API readiness 或 health 必须失败，不能静默回退到旧的无限 provider 并发路径。
- `GENERATION_QUEUE_DRIVER=inline` 只用于测试或显式本地调试，smoke 测试需要主动设置该值以避免依赖本机 Redis。
- `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 限制整个应用 / API 运行集群同时打到当前图片 provider 的 provider API 请求总数，不是单任务、单用户或 worker 并发。默认值为 `2`。
- provider scheduler 是图片 provider 调用的唯一闸门入口。手动文生图、参考图编辑和 Agent 生成最终都通过 `image-generation.ts` 的单图输出函数进入 `runProviderCall()`。
- provider retry policy 包在单图 provider call 外侧；每次 retry attempt 都重新进入 `runProviderCall()`，因此 retry 也受 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 限制。
- `GENERATION_PROVIDER_MAX_RETRIES` 默认值为 `2`，表示首轮失败后最多额外重试 2 次；`GENERATION_PROVIDER_RETRY_BASE_MS` 默认 `1000`，`GENERATION_PROVIDER_RETRY_MAX_MS` 默认 `30000`。
- provider retry 只重试 429、408、5xx、连接超时和临时网络中断。缺少 provider、缺少 API key、400 参数错误、参考图非法和用户取消直接失败，不做空转重试。
- retryable 错误耗尽后，生成 output / record / audit 写稳定失败摘要，不透出上游原始错误体、Bearer token、OpenAI-style key 或 provider credential。
- `GENERATION_QUEUE_WORKER_CONCURRENCY` 限制每个 API 进程同时消费的手动 generation queue job 数，不是 provider API 并发限制；provider API 并发仍只由 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 控制。
- Redis 模式下，手动文生图和参考图编辑请求只负责预扣积分、创建 `pending` generation record、记录 audit start 并 enqueue job；worker 消费后把 record 推到 `running` 并执行现有 finish 流程。
- Redis 模式下，API 启动先执行 generation state bridge，再启动 queue worker。DB 中仍为 `pending` 的 generation 会被幂等恢复到 ready queue；DB 中遗留 `running` 的 generation 会按 interrupted failed 收敛、审计更新并退款。
- Redis 模式下，Agent 生成在未传 provider override 时也创建 `pending` generation record 并复用同一 generation queue；Agent plan job 保持 `queued`，直到 DB record 变为 `running` 或 terminal 时才映射为 `running` / 完成状态。
- 后台生成审计页通过 `/api/admin/generation-queue` 展示只读调度快照：Redis 状态、ready queue 长度、worker 运行状态、provider permit 使用量、retry 配置、DB status 计数、output 成败计数和最近失败摘要。
- `AGENT_JOB_CONCURRENCY` 只限制单个 Agent run 同时提交或等待的 plan jobs，不是 provider API 并发限制；真实 provider API 并发仍由 `GENERATION_PROVIDER_GLOBAL_CONCURRENCY` 统一控制。
- Agent 的 provider override path 和 `GENERATION_QUEUE_DRIVER=inline` 是测试 / 本地调试路径，保留 direct 同步执行语义，不提供 Redis queue 语义。
- Redis 只保存生成调度运行态。生成记录、输出、审计、资产、积分交易和本地账号数据继续保存在数据库或资产存储中。
- provider permit 在 Redis 中只保存短期随机 permit id 和过期分数；不得把 prompt、API key、reference image bytes、generation record、audit、credit transaction、generation id、output id 或用户输入写进 permit member。
- generation queue job 在 Redis 中只保存 generation id、user id、mode、visibility flag、attempt 计数和 enqueue time 等路由元数据；worker 必须从 DB/asset storage 重新读取生成事实和参考图资产。
- generation queue observability 响应只包含枚举、数字、generation id、稳定失败摘要和时间戳；不得暴露 `REDIS_URL`、Redis host、raw Redis error、prompt、reference bytes、provider credential、Redis job key 或完整 Redis payload。
- cancelled / failed 等终态 generation record 是 DB 事实边界；晚到的 finish 流程不能覆盖终态，也不能为终态 record 落库新 outputs。
- `/api/health` 可以暴露 Redis 状态枚举，但不能暴露 `REDIS_URL`、密码、Redis 主机拓扑或原始连接错误。

## 5. 已知约束 / 硬边界

- 注册邮箱后缀支持列表只限制新的自助注册，不影响已有用户登录、管理员账号 bootstrap、Codex OAuth 或提供方账号邮箱。
- 域名匹配只做邮箱 `@` 后部分的精确匹配；不支持通配符、正则、子域继承、MX 查询、一次性邮箱检测或黑名单策略。
- 当前只做注册邮箱验证码，不做登录 MFA、忘记密码、修改邮箱、邀请注册或邮件订阅通知。
- `allowRegistration=false` 是更高优先级的总开关。关闭自助注册后，不管邮箱域名是否在支持列表内，都应返回注册关闭语义。
- 域名检查发生在邮箱查重之前，避免对不支持域名泄露该邮箱是否已注册。
- 注册验证码发送和最终注册都会先检查 `allowRegistration` 与邮箱后缀支持列表；不支持域名或关闭注册时不调用邮件网关。
- 本地无密码 Redis 只适合绑定本机或受控 Docker/内网网络，不得公网暴露；远程 Redis 的 ACL/TLS/网络隔离属于独立部署安全工作。
- 后续生成调度模块必须复用 `redis-runtime.ts` 的 runtime API，不应重新解析 Redis env 或创建独立 Redis client。
- `GENERATION_QUEUE_DRIVER=inline` 下的 provider scheduler 只限制当前 API 进程，不提供跨进程或跨机器全局保证；真实全局闸门依赖 `GENERATION_QUEUE_DRIVER=redis`。
- `GENERATION_QUEUE_DRIVER=inline` 下，手动生成仍使用旧进程内 background task；Redis generation queue worker 只在 `redis` driver 下启用。
- 当前已实现 generation 级 Redis queue worker、provider call 级 retry policy、Agent queue adapter、generation 级启动恢复和后台队列可观测性，但还没有 per-output Redis job、delayed retry queue、processing list、Agent run 重启恢复、用户排队位次或 ETA；这些仍需单独设计。
