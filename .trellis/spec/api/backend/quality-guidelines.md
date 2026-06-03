# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

### 场景：ToC 只读服务状态与后台配置接口分离

#### 1. 范围 / 触发

- 触发：新增或修改面向 ToC 页面的生成服务、Agent 服务状态接口。
- 范围：服务状态可以暴露给创作页；provider、Agent LLM、API Key、Base URL、模型名、source order、Codex 登录状态等系统配置详情只能给后台管理员接口使用。

#### 2. 签名

- `GET /api/agent-config/status`
  - 权限：不要求 admin。
  - 响应类型：`AgentLlmStatusView`。
- `GET /api/agent-config`
  - 权限：必须通过 `requireAdmin`。
  - 响应类型：`AgentLlmConfigView`，secret 只能返回掩码。
- `PUT /api/agent-config`
  - 权限：必须通过 `requireAdmin`。
  - 请求类型：`SaveAgentLlmConfigRequest`。
  - 响应类型：`AgentLlmConfigView`，secret 只能返回掩码。

#### 3. 契约

- `AgentLlmStatusView` 只能包含：
  - `configured: boolean`
  - `supportsVision: boolean`
- 状态响应不得包含 raw secret、masked secret、model、baseUrl、timeoutMs、source order、Codex account。
- ToC 页面只能读取状态接口来判断可用性；后台 providers 页面才读取和保存配置详情接口。
- 配置详情接口即使路径没有 `/api/admin/*` 前缀，也必须保持 admin-only。

#### 4. 校验与错误矩阵

- 无可用 Agent LLM 配置 -> `/api/agent-config/status` 返回 `200 {"configured":false,"supportsVision":false}`。
- 有可用 Agent LLM 配置且支持视觉 -> `/api/agent-config/status` 返回 `200 {"configured":true,"supportsVision":true}`。
- 未登录访问 `/api/agent-config` -> `401`。
- 非 admin 访问 `/api/agent-config` -> `403` 或认证层定义的拒绝响应。
- admin 保存非法 payload -> `400`，不得写入半成品配置。

#### 5. Good / Base / Bad Cases

- Good：画布 Agent 头部调用 `/api/agent-config/status`，只展示“Agent 可用 / 暂不可用”和视觉理解能力。
- Base：后台 providers 页面调用 `/api/agent-config` 加载 masked 配置，并调用 `PUT /api/agent-config` 保存。
- Bad：ToC 页面调用 `/api/agent-config` 获取模型名并展示，或在缺配置时提示用户保存 API Key / 登录 Codex。

#### 6. 必需测试

- 类型检查：`pnpm typecheck` 覆盖共享契约、API 路由和前端类型守卫。
- 构建：`pnpm build` 覆盖前端路由和后端编译。
- API 回归：验证 `/api/agent-config/status` 为 `200` 且无敏感字段；验证 `/api/agent-config` 未登录返回 `401`。
- UI 回归：桌面和移动 ToC 页面不得出现配置入口、模型名、API Key、Base URL、Codex 登录等系统配置行动文案；后台 providers 页面仍保留配置能力。

#### 7. Wrong vs Correct

##### Wrong

```typescript
const response = await fetch("/api/agent-config");
const config = (await response.json()) as AgentLlmConfigView;
showModelName(config.model);
```

##### Correct

```typescript
const response = await fetch("/api/agent-config/status");
const status = (await response.json()) as AgentLlmStatusView;
showAvailability(status.configured, status.supportsVision);
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
