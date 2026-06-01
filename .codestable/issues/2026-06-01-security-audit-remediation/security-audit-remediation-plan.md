---
doc_type: issue-analysis
issue: 2026-06-01-security-audit-remediation
status: confirmed
severity: P1
root_cause_type: security-hardening
path: standard
created: 2026-06-01
tags:
  - security
  - audit
  - remediation
  - robustness
---

# 安全审计修复方案

## 1. 输入范围

本方案来自 2026-06-01 对网页端项目的授权安全审计，覆盖：

- 前端 Web：`apps/web`
- API 服务：`apps/api`
- 共享契约：`packages/shared`
- 配置、鉴权、会话、上传、provider 配置、本地存储、Docker、环境变量示例

本方案只定义修复方向和验收要求，不直接修改业务代码，不读取、打印或外传真实 secret。

## 2. 修复目标

- 先消除会造成权限绕过、凭据滥用、资源耗尽或弱部署默认值的 P1 风险。
- 在不破坏本地优先产品模型的前提下，提高 Docker、Provider、自定义 Agent Skill 等可选能力的安全边界。
- 修复时保持 SQLite / MySQL、开发模式 / Docker 模式、普通用户 / 管理员三组边界行为可预测。
- 所有错误响应继续使用稳定错误码和安全文案，不泄露 provider key、OAuth token、路径、上游响应或数据库细节。

## 3. 分批修复计划

| 批次 | 严重级别 | 覆盖问题 | 主要修复动作 |
|---|---|---|---|
| A. Agent Skill 写权限收敛 | P1 | 普通登录用户可创建、导入、修改全局 Agent Skill，影响所有用户的 Agent 规划行为 | 后端写接口改为 admin-only；前端非管理员隐藏或禁用写入口；保留普通用户只读能力。 |
| B. 登录失败限速 | P1 | `/api/auth/login` 没有失败尝试限速，存在密码爆破和 CPU 资源滥用风险 | 增加 email + IP 维度失败窗口、短暂锁定和成功后清理；不泄露账号是否存在。 |
| C. JSON 请求体提前限流 | P1 | `readJson` 先完整读取 `request.text()`，再由各 parser 校验业务大小，超大 JSON 可先消耗内存 | 在读取前检查 `Content-Length`，读取时做流式字节上限；按路由传入明确上限；超限返回 413。 |
| D. Docker 与默认管理员凭据安全默认值 | P1（需验证） | `.env.example` 带默认 admin 密码，Docker 默认对所有网卡暴露端口；复制示例后可能形成弱部署 | 移除可直接登录的默认密码或启动拒绝 `change-me-*`；Compose 默认绑定 localhost，公开部署必须显式配置。 |
| E. Provider / Agent LLM base URL 出站边界 | P2（需验证） | 管理员可配置任意 OpenAI-compatible `baseUrl`，若管理员会话被盗可能转发密钥到内网或恶意主机 | 增加 URL 策略校验：默认仅允许 HTTPS 公网地址；显式 dev flag 才允许 localhost；阻断私网、link-local、metadata IP。 |
| F. 安全响应头 | P2 | API 静态站点未统一设置 CSP、frame、nosniff、referrer、permissions 等头 | 在 Hono app 入口添加安全头中间件，按项目真实资源来源配置 CSP。 |
| G. 依赖漏洞升级 | P2 | `pnpm audit --prod` 报告 `@anthropic-ai/sdk` 与 `uuid` 传递依赖中等风险 | 升级直接依赖或覆盖传递依赖，确认 lockfile、构建和 Agent smoke 不回退。 |

## 4. 详细修复方案

### A. Agent Skill 写权限收敛

**影响范围**：

- `apps/api/src/server/routes/agent-skills.ts:41`、`:62`、`:83`
- `apps/api/src/domain/agent/skill-store.ts:102`、`:131`
- `apps/web/src/features/canvas/CanvasApp.tsx:7106`
- `apps/web/src/features/agent/AgentSkillDialog.tsx`

**修复动作**：

1. 将 `POST /api/agent-skills`、`PUT /api/agent-skills/:id`、`POST /api/agent-skills/import` 从 `requireAuth` 改为 `requireAdmin`。
2. `GET /api/agent-skills` 和 `GET /api/agent-skills/:id` 保持登录用户可读，保证普通用户仍能看到 Agent 计划实际使用的 Skill。
3. 前端 `AgentSkillDialog` 增加只读模式：普通用户可查看 Skill 内容、触发关键词和启用状态，但不能保存、导入、reset factory 或切换 enabled。
4. 对 built-in / required skill 保持现有保护：required skill 仍不可禁用，built-in slug 仍不可改；新增 admin-only 不应改变这些领域规则。
5. MySQL 模式当前不支持 Skill 持久化编辑，仍返回 `agent_skill_unsupported_storage`，不要因为权限改造误报为 403。

**业务鲁棒性约束**：

- 普通创作者不能修改全局规划策略，但不能因此看不懂 Agent 为什么按某些 Skill 生成计划。
- 管理员操作失败时保持当前稳定错误码，不把数据库或 zip 解析细节暴露给前端。
- 前端禁用只是体验层，后端权限是最终边界。

**建议测试**：

- API smoke：普通用户调用 3 个写接口返回 403；管理员可创建、更新、导入。
- API smoke：普通用户仍可 list/detail。
- UI browser：普通用户打开 Agent Skill 弹窗为只读；管理员仍能编辑和导入。
- MySQL smoke：MySQL 模式下管理员写接口仍返回 501，不退化为数据库异常。

### B. 登录失败限速

**影响范围**：

- `apps/api/src/server/routes/auth.ts:68`
- `apps/api/src/domain/auth/auth-store.ts:165`
- `apps/api/src/domain/auth/registration-email-verification.ts:52`（已有 cooldown 可作为行为参照）
- `packages/shared/src/auth.ts`

**修复动作**：

1. 新增登录失败计数存储。最低可先用进程内 TTL map，若面向 Docker / 多进程部署，应优先使用数据库表或 Redis，避免每个进程各自计数。
2. 计数维度至少包含 normalized email 和客户端 IP 摘要；任一维度超限都短暂锁定。
3. 锁定响应使用稳定错误码，例如 `auth_rate_limited`，HTTP 429；文案不区分账号是否存在。
4. 成功登录后清理对应 email 的失败窗口；不存在用户和密码错误都进入相同失败计数路径。
5. PBKDF2 校验前应先执行粗粒度限速，避免攻击者用大量密码尝试放大 CPU 成本。

**业务鲁棒性约束**：

- 本地用户输错几次密码不应被永久锁死；锁定应短、可恢复，并给出稍后重试文案。
- 管理员 bootstrap 和已有用户激活逻辑不能被限速状态误伤。
- 代理或 Docker 环境下不要盲目信任伪造的 `X-Forwarded-For`；可复用现有 IP 摘要规则，但需记录该边界。

**建议测试**：

- smoke：同一 email 连续错误达到阈值后返回 429。
- smoke：不存在 email 与存在 email 密码错误都返回同类稳定错误，不泄露账号枚举。
- smoke：成功登录清理失败计数。
- 单元测试：TTL 过期后允许再次尝试。

### C. JSON 请求体提前限流

**影响范围**：

- `apps/api/src/server/http/json.ts:3`
- `apps/api/src/server/http/validation.ts:48`
- `apps/api/src/server/routes/project.ts:23`
- 所有调用 `readJson(c.req.raw)` 的 API 路由

**修复动作**：

1. 将 `readJson` 改为接收 `maxBytes` 参数，并在读取前检查 `Content-Length`。
2. `Content-Length` 缺失或不可信时，通过 `request.body.getReader()` 分块读取并累计字节数，超过上限立即取消读取并返回 413。
3. 为不同路由定义明确上限：
   - 项目 snapshot：沿用 `MAX_PROJECT_SNAPSHOT_BYTES = 100MB`。
   - 图片生成 / 编辑 JSON：按 reference data URL 业务上限估算，保留现有每张参考图 50MB 的合法空间，但不能无界。
   - 登录、注册、provider 配置、Agent 配置、收藏、后台小表单：使用小上限，例如 64KB 到 1MB。
4. 将错误码固定为 `request_body_too_large` 或现有兼容错误码，并统一 HTTP 413。
5. 不在日志里打印请求体内容，只记录 content-length / transfer-encoding / content-type 这类摘要。

**业务鲁棒性约束**：

- 不能把合法大画布保存误杀；项目保存和普通 JSON 表单必须分开配置上限。
- 参考图编辑的 data URL 体积可能明显大于最终图片 bytes，需要按 base64 膨胀预留空间。
- 读取失败、超限和 JSON 格式错误应区分错误码，方便前端给出可恢复提示。

**建议测试**：

- 单元测试：`Content-Length` 大于上限时不读取 body，返回 413。
- 单元测试：chunked body 超过上限时中止读取，返回 413。
- smoke：项目保存接近 100MB 仍走原业务校验；超过 100MB 返回 413。
- smoke：登录小接口发送 2MB JSON 返回 413。

### D. Docker 与默认管理员凭据安全默认值

**影响范围**：

- `.env.example:58`
- `.env.example:59`
- `docker-compose.yml:27`
- `docker-compose.yml:43`
- `docs/SECURITY.md`
- `docs/RELIABILITY.md`

**修复动作**：

1. 将 `.env.example` 中 `ADMIN_PASSWORD=change-me-local-admin` 改为留空或明显不可用占位。
2. API 启动时若检测到 `ADMIN_PASSWORD` 等于 `change-me-*`、`password`、`admin` 等弱示例值，应拒绝 bootstrap 新管理员并输出安全文案。
3. Docker Compose 端口默认改为 `127.0.0.1:${PORT:-8787}:${PORT:-8787}`；需要公网暴露时通过显式变量配置 bind 地址。
4. 文档补充：项目认证边界是本地工作站，不是公网部署模型；公开部署必须配 TLS、网络访问控制、强管理员密码、监控与反向代理安全配置。
5. 保留 `HOST=0.0.0.0` 作为容器内监听地址，只收紧宿主机端口发布，避免破坏容器网络。

**业务鲁棒性约束**：

- 本地首次运行仍要容易理解怎么创建管理员；不要因为示例留空导致用户不知道要配置哪几个变量。
- `ADMIN_PASSWORD` 只用于首次创建管理员；已有管理员不应因示例值检查被重置密码或锁死。
- Docker 开发者仍可通过显式 `BIND_ADDRESS=0.0.0.0` 之类变量选择局域网访问，但这必须是有意识动作。

**建议测试**：

- 启动测试：弱示例密码首次 bootstrap 被拒绝。
- 启动测试：已有管理员存在时不会重置密码。
- Docker config：`docker compose config --quiet --no-env-resolution` 通过且不打印 secret。
- 文档检查：公开部署说明不要求用户运行会展开 secret 的命令。

### E. Provider / Agent LLM base URL 出站边界

**影响范围**：

- `apps/api/src/server/http/validation.ts:650`
- `apps/api/src/server/http/validation.ts:773`
- `apps/api/src/infrastructure/providers/image-provider.ts:123`
- `apps/api/src/domain/agent/planner.ts:548`
- `apps/api/src/domain/providers/provider-config.ts`
- `apps/api/src/domain/agent/config.ts`

**修复动作**：

1. 新增共享 URL 校验 helper，用于图片 provider 和 Agent LLM config。
2. 默认只接受 `https://`，拒绝明文 `http://`、非 HTTP(S) scheme、空 host、userinfo、路径穿透式异常 URL。
3. 默认拒绝 loopback、private CIDR、link-local、multicast、metadata IP、`.local` 等本地解析目标；域名需要在发起请求前或保存时做解析校验，避免显式 IP 之外的私网目标。
4. 增加显式本地开发开关，例如 `ALLOW_LOCAL_PROVIDER_BASE_URL=true`，只在本地开发或受控内网中允许 `http://127.0.0.1` / `http://localhost`。
5. 对被拒绝的 URL 返回稳定错误码，不保存配置，不发起 provider 请求，不把已保存 key 发送到新 URL。
6. 对 provider 返回的图片 URL 下载路径也复用出站 URL 保护，防止恶意兼容 provider 返回内网 URL 触发服务端下载。

**业务鲁棒性约束**：

- OpenAI-compatible 是项目核心能力，不能硬编码只允许官方 OpenAI；应支持用户显式配置可信公网兼容服务。
- 许多开发者本地调试会使用 `localhost` 代理，必须提供明确 dev flag，而不是把本地调试彻底封死。
- 只要 URL 未通过校验，就不能保存新 base URL 后继续保留旧 API key 与新 host 组合。

**建议测试**：

- 单元测试：允许 `https://api.openai.com/v1` 和其他公网 HTTPS。
- 单元测试：拒绝 `http://169.254.169.254`、`http://127.0.0.1`、`http://10.0.0.1`、`file://...`、带 userinfo 的 URL。
- smoke：未开 dev flag 时保存 localhost provider config 失败；开 flag 后本地开发代理可用。
- smoke：provider 返回私网图片 URL 时下载被拒绝且不泄露 URL 内凭据。

### F. 安全响应头

**影响范围**：

- `apps/api/src/server/app.ts:35`
- 构建后由 API 静态服务的 `apps/web` 页面

**修复动作**：

1. 在创建 Hono app 后、注册路由前添加安全头中间件。
2. 建议默认头：
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: no-referrer`
   - `X-Frame-Options: DENY` 或 CSP `frame-ancestors 'none'`
   - `Permissions-Policy` 关闭非必要能力
   - `Content-Security-Policy` 覆盖 scripts、styles、images、connect、frame-ancestors
3. CSP 需要按真实业务来源配置：
   - `img-src` 允许 `'self'`、`data:`、`blob:`，以及已知的 GitHub raw prompt pool 图片来源和 OSS signed URL 来源。
   - `connect-src` 允许 `'self'`、开发模式下 Vite / WebSocket，本地 API 与 Agent WebSocket。
   - 不使用 `unsafe-inline`，除非现有构建产物必须；如必须，应记录原因并尽量用 nonce/hash 替代。
4. 对 API JSON 响应和静态 HTML 都应用基础安全头；对下载 ZIP / 图片响应不应破坏内容类型。

**业务鲁棒性约束**：

- CSP 不能阻断 Canvas 图片预览、Gallery、Prompt Pool 远端示例图、OSS 预签名图片和 Agent WebSocket。
- 开发模式和生产静态服务的头策略可以不同，但生产默认必须安全。

**建议测试**：

- browser：构建后首页响应带安全头。
- browser：Canvas、本地资产预览、Gallery、Prompt Pool 图片正常显示。
- browser：Agent WebSocket 连接不被 CSP 阻断。
- 单元或集成：`/api/*` JSON 响应也带 `nosniff` 等基础头。

### G. 依赖漏洞升级

**影响范围**：

- `apps/api/package.json:34`
- `apps/api/package.json:38`
- `pnpm-lock.yaml`

**修复动作**：

1. 处理 `@langchain/anthropic@1.3.28` 引入的 `@anthropic-ai/sdk@0.90.0` 中等风险，目标是升级到包含 `@anthropic-ai/sdk >=0.91.1` 的版本。
2. 处理 `deepagents@1.9.0` 引入的 `uuid@10.0.0` 中等风险，目标是升级或 override 到 `uuid >=11.1.1`。
3. 优先升级直接依赖；若上游尚未发布兼容版本，再使用 `pnpm.overrides`，并记录后续移除条件。
4. 变更后确认 Agent planner / executor 行为未被 LangChain 或 deepagents 版本变化破坏。

**业务鲁棒性约束**：

- Agent 计划输出 JSON 契约不能因模型 SDK 变化变松；需要保留现有 plan guard 和 smoke。
- 依赖升级只处理安全风险，不顺手重写 Agent 架构。

**建议测试**：

- `pnpm audit --prod --registry=https://registry.npmjs.org`
- `pnpm --filter @gpt-image-canvas/api smoke:planner`
- `pnpm --filter @gpt-image-canvas/api smoke:executor`
- `pnpm typecheck`
- `pnpm build`

## 5. 建议执行顺序

1. 先修 A、B、C：它们分别覆盖权限、认证爆破、请求体资源耗尽，是最直接的 P1 风险。
2. 再修 D：把 Docker 和 `.env.example` 默认值收紧，避免修完代码后仍以弱默认值部署。
3. 再修 E：Provider URL 策略需要兼顾 OpenAI-compatible 灵活性和本地代理调试，建议单独评审。
4. 再修 F：加安全头后必须做浏览器回归，防止 CSP 误伤图片、WebSocket 和 OSS 预签名 URL。
5. 最后修 G：依赖升级独立提交，便于出现兼容问题时回滚或定位。

## 6. 总体验收标准

- 普通用户不能修改全局 Agent Skill；管理员路径和 MySQL unsupported 行为保持可预期。
- 登录接口对连续失败尝试有 429 限速，不泄露账号是否存在。
- 大 JSON 请求在进入完整 body 解析前被 413 拒绝；项目 snapshot 与参考图合法请求不被误杀。
- Docker 默认只发布到 localhost；示例管理员密码不能形成可直接登录的弱账户。
- Provider / Agent LLM base URL 默认阻断 SSRF 高风险目标，显式 dev flag 可恢复本地代理调试。
- 构建后页面和 API 响应带基础安全头，业务图片和 WebSocket 不受影响。
- `pnpm audit --prod --registry=https://registry.npmjs.org` 不再报告本轮两条中等依赖漏洞。
- 最终运行 `pnpm typecheck` 和 `pnpm build`；涉及 UI/CSP 的批次需要启动应用做浏览器验证。

## 7. 不纳入本轮

- 不把本地优先项目改造成完整公网多租户安全平台。
- 不引入强制 SSO、OAuth 管理员体系或外部 WAF。
- 不重写 Agent 规划架构、Provider 抽象或 Gallery 资产模型。
- 不修改真实 `.env`、不打印真实 secret、不运行会展开 secret 的 Docker 命令。
