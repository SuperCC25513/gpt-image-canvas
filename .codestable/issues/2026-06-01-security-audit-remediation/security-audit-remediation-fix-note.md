---
doc_type: issue-fix-note
issue: 2026-06-01-security-audit-remediation
status: fixed
severity: P1
path: standard
fixed: 2026-06-01
tags:
  - security
  - audit
  - remediation
  - robustness
---

# 安全审计修复记录

## 1. 修复范围

本次按 `security-audit-remediation-plan.md` 执行安全加固，覆盖 Agent Skill 写权限、登录失败限速、JSON 请求体提前限流、Docker/env 安全默认值、Provider/Agent LLM 出站 URL 边界、安全响应头和依赖漏洞升级。

## 2. 关键改动

- Agent Skill 写接口收敛为 admin-only：`POST /api/agent-skills`、`PUT /api/agent-skills/:id`、`POST /api/agent-skills/import` 需要管理员；普通登录用户仍可 list/detail 查看当前规划 Skill。
- Agent Skill 前端弹窗增加普通用户只读态：非管理员可查看 Skill、文件和触发规则，但不能创建、上传、保存、reset factory 或切换启用状态。
- 登录失败限速增加 email + IP 摘要维度：Redis 模式优先写 Redis，inline/test 模式回退进程内 TTL；不存在账号和密码错误统一计数，连续失败后返回 `auth_rate_limited`。
- `readJson` 增加 route-aware body limit：读取前检查 `Content-Length`，读取流时累计字节数，超限返回 413 `request_body_too_large`；项目保存和参考图编辑使用更高上限，小表单使用默认 1MB。
- Provider/Agent LLM `baseUrl` 增加出站 URL 校验：默认仅允许公网 HTTPS；loopback HTTP 必须显式设置 `ALLOW_LOCAL_PROVIDER_BASE_URL=true`；阻断私网、link-local、metadata、`.local` 和带 userinfo 的 URL。
- Provider 返回图片 URL 下载复用出站 URL 校验，避免兼容 provider 诱导服务端下载内网资源。
- API app 增加基础安全响应头：CSP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy` 和 `Permissions-Policy`。
- `.env.example` 移除可直接登录的默认管理员凭据；新管理员 bootstrap 会拒绝 `change-me-*` 等弱示例密码。
- Docker Compose 默认端口发布收敛到 `127.0.0.1`，通过 `DOCKER_BIND_ADDRESS` 显式选择外部暴露。
- 升级 `@langchain/anthropic` 到 `^1.4.0`、`deepagents` 到 `^1.10.2`，并用 pnpm override 将传递 `uuid` 提升到 `^11.1.1`。
- 更新 `docs/SECURITY.md`、`docs/RELIABILITY.md` 和前端 i18n，记录新安全边界和错误码。

## 3. 业务鲁棒性说明

- 保留本地优先模型：未把项目改造成公网多租户平台；Docker 默认更安全，但仍允许显式公开绑定。
- 保留普通创作者可解释性：普通用户不能改全局 Agent Skill，但仍能查看当前 Skill 内容。
- 保留 provider 灵活性：公网 OpenAI-compatible HTTPS 继续可用，本地 loopback 代理通过显式 dev flag 可用。
- 保留大画布和参考图能力：项目 snapshot 和参考图编辑没有使用小表单上限，避免误杀合法工作流。
- 限速不锁死正常用户：失败窗口和锁定都是 TTL；成功登录清理 email 维度失败状态。

## 4. 验证

- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:security-hardening`：通过。
- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:provider-config`：通过。
- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:planner`：通过。
- `USE_MYSQL=false pnpm --filter @gpt-image-canvas/api smoke:executor`：通过。
- `pnpm audit --prod --registry=https://registry.npmjs.org`：通过，No known vulnerabilities found。
- `pnpm typecheck`：通过。
- `pnpm build`：通过；Vite 仍提示既有大 chunk warning，不影响构建完成。
- 构建后本地启动：`DATA_DIR=.codex-temp/security-start-smoke USE_MYSQL=false GENERATION_QUEUE_DRIVER=inline HOST=127.0.0.1 PORT=18787 pnpm start`，通过。
- HTTP 冒烟：`GET /` 返回构建后 HTML；`GET /api/config` 返回 JSON，均带 CSP、`X-Frame-Options`、`nosniff` 等安全头。

## 5. 后续观察

- 当前出站 URL 校验阻断显式私网 IP、`.local` 和 loopback 默认路径；若未来要支持受控内网 provider，应另起方案定义 allowlist，而不是直接放开私网。
- CSP 当前为业务兼容保留 `style-src 'unsafe-inline'`，因为前端运行时和组件库存在内联样式需求；后续若要进一步收紧，建议单独做 CSP 兼容性任务。
