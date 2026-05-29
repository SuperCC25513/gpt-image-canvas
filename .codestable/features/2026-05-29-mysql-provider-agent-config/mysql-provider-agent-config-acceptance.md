---
doc_type: feature-acceptance
feature: 2026-05-29-mysql-provider-agent-config
status: accepted
summary: MySQL 模式下系统页面 provider、Codex fallback 和 Agent LLM 配置已持久化并被运行时读取。
tags: [mysql, provider, agent, config]
accepted_at: "2026-05-29"
---

# MySQL Provider And Agent Config 验收报告

> 阶段：阶段 3（验收闭环）
> 验收日期：2026-05-29
> 关联方案 doc：.codestable/features/2026-05-29-mysql-provider-agent-config/mysql-provider-agent-config-design.md

## 1. 接口契约核对

对照方案第 2.1 节名词层逐一核查：

**接口示例逐项核对**：

- [x] `PUT /api/provider-config`：`apps/api/src/server/routes/provider-config.ts` 继续接收 `SaveProviderConfigRequest`，`apps/api/src/domain/providers/provider-config.ts` 保存 `sourceOrder` 和 `localOpenAI` 后返回 `ProviderConfigResponse`；smoke 验证返回 masked key 且 runtime 能读取 raw key。
- [x] `PUT /api/agent-config`：`apps/api/src/server/routes/agent-config.ts` 继续接收 `SaveAgentLlmConfigRequest`，`apps/api/src/domain/agent/config.ts` 保存 Agent LLM 配置后返回 `AgentLlmConfigView`；smoke 验证 `configured=true` 且 `getUsableAgentLlmConfig()` 可读。
- [x] 共享契约未拆分或改名：`packages/shared/src/provider-config.ts` 仍定义 `PROVIDER_SOURCE_IDS`、`ProviderConfigResponse`、`SaveProviderConfigRequest`；`packages/shared/src/agent.ts` 仍定义 `AgentLlmConfigView`、`SaveAgentLlmConfigRequest`。

**名词层“现状 → 变化”逐项核对**：

- [x] MySQL `provider_configs`：`apps/api/src/infrastructure/mysql-database.ts` 已新增表定义、字段补齐和 `active` 默认行。
- [x] MySQL `agent_llm_configs`：`apps/api/src/infrastructure/mysql-database.ts` 已新增表定义、字段补齐和 `active` 默认行。
- [x] Provider config domain：`apps/api/src/domain/providers/provider-config.ts` 已改为 SQLite/MySQL driver-aware read/upsert，响应仍只返回 masked secret。
- [x] Agent LLM config domain：`apps/api/src/domain/agent/config.ts` 已改为 SQLite/MySQL driver-aware read/upsert，并暴露运行时 usable config。
- [x] Codex auth domain：`apps/api/src/domain/providers/codex-auth.ts` 已让 `codex_oauth_tokens.default` 在 SQLite/MySQL 中读写、删除和 refresh invalidation。

**流程图核对**：

- [x] 管理员 GET/PUT provider config → route admin guard → domain 根据 `databaseDriver` 读写 SQLite/MySQL → masked response：代码落点完整。
- [x] 管理员 GET/PUT Agent LLM config → route admin guard → domain 根据 `databaseDriver` 读写 SQLite/MySQL → Agent WebSocket await usable config：代码落点完整。
- [x] Codex login/logout/status → auth route → driver-aware token store → provider config codex availability：代码落点完整。

## 2. 行为与决策核对

**需求摘要逐项验证**：

- [x] MySQL 模式 `GET /api/provider-config` 能返回默认 source order、env source、空 local config 和 Codex session view；MySQL smoke 覆盖。
- [x] MySQL 模式 `PUT /api/provider-config` 能保存 local OpenAI key/baseUrl/model/timeout/sourceOrder；MySQL smoke 覆盖保存、再次读取和 provider selection。
- [x] MySQL 模式 Codex token 写入后 `codex.available=true`，logout 后变为 false 且 source order 保留；MySQL smoke 覆盖。
- [x] MySQL 模式 `GET /api/agent-config` / `PUT /api/agent-config` 能读写 Agent LLM 配置；MySQL smoke 覆盖 configured view 和 usable runtime config。
- [x] SQLite 模式行为保持现状；SQLite smoke 覆盖同一 provider/Agent/Codex 路径。

**明确不做逐项核对**：

- [x] 未做 SQLite → MySQL provider/Agent/Codex 配置迁移；代码只按当前 driver 读写当前库。
- [x] 未引入 per-user provider / Agent LLM 配置；`provider_configs.active`、`agent_llm_configs.active`、`codex_oauth_tokens.default` 仍是全局单行。
- [x] 未改变 Agent conversation / skill 的 MySQL 降级语义；本 feature 只触及 Agent LLM config。
- [x] 未合并 `/api/provider-config` 和 `/api/agent-config`；两个 route 仍独立保存。
- [x] 未把 OSS、MySQL、Mail Gateway 或 Redis 凭据搬进系统页面；相关配置仍来自 runtime env。
- [x] 未改变 secret 加密/轮换策略；响应继续只返回 masked secret 或可用性状态。

**关键决策落地**：

- [x] D1：MySQL 使用同名同语义的 `provider_configs` / `agent_llm_configs` 表，已在 MySQL schema 和 docs 中落地。
- [x] D2：配置仍是全局单行，route 仍使用 `requireAdmin`，运行时读取同一组 active/default 行。
- [x] D3：MySQL 分支放在现有 provider / Agent / Codex domain service 内，调用方契约保持不变。
- [x] D4：Codex fallback 纳入本 feature，`getAuthStatus()`、logout 和 provider config codex view 均 await driver-aware token store。
- [x] D5：env provider 仍只从环境变量读取，系统页面不写 env 配置。

**编排层“现状 → 变化”逐项核对**：

- [x] Provider config route 不变，domain async 化；`image-provider-selection.ts` await `getProviderSourceOrder()` / `getLocalOpenAIImageProviderConfig()`。
- [x] Agent config route 不变，domain async 化；`websocket-session.ts` await `getUsableAgentLlmConfig()`。
- [x] Codex auth route 不变；`auth.ts` await `getAuthStatus()` / `logoutCodex()`。
- [x] Web provider 页面未改，继续使用既有 GET/PUT 契约。

**流程级约束核对**：

- [x] 错误语义：payload 校验错误仍走 `invalid_provider_config` / `invalid_agent_config`；数据库写失败已折叠为稳定 route error，不透出 raw SQL error。
- [x] 幂等性：MySQL 启动使用 `INSERT IGNORE` 初始化默认行，保存 active 行使用 `ON DUPLICATE KEY UPDATE`。
- [x] Secret 边界：API response 使用 `maskedSecret()`；smoke 验证返回值不等于 raw key。
- [x] Source order：坏 `source_order_json` 被 `readSavedSourceOrder()` 捕获并回退默认顺序，不 500。
- [x] 并发：未新增跨请求锁，仍是最后一次 admin 保存覆盖全局 active 行。
- [x] 扩展点：未在当前表追加 `user_id` 或用户级分支。

**挂载点反向核对（可卸载性）**：

- [x] MySQL schema：`apps/api/src/infrastructure/mysql-database.ts`。
- [x] Provider config domain：`apps/api/src/domain/providers/provider-config.ts`。
- [x] Agent LLM config domain：`apps/api/src/domain/agent/config.ts` 和 `apps/api/src/domain/agent/websocket-session.ts`。
- [x] Codex token store：`apps/api/src/domain/providers/codex-auth.ts` 和 `apps/api/src/server/routes/auth.ts`。
- [x] Route async/error boundary：`apps/api/src/server/routes/provider-config.ts`、`apps/api/src/server/routes/agent-config.ts`。
- [x] Smoke：`apps/api/src/smoke/provider-config-smoke.ts`、`apps/api/src/smoke/provider-config-mysql-smoke.ts`、`apps/api/package.json`。
- [x] 文档：`docs/generated/db-schema.md`、`docs/RELIABILITY.md`、`docs/product-specs/provider-configuration.md`。
- [x] 反向 grep：`provider_configs` / `agent_llm_configs` / `getProviderConfig()` / `getAgentLlmConfig()` / `getAuthStatus()` 命中均落在上述挂载点或既有 schema/docs/smoke 调用内。
- [x] 拔除沙盘推演：移除 MySQL schema additions、三个 domain 的 MySQL 分支、route await、smoke 和 docs 后，本 feature 无额外 runtime 残留；SQLite 既有路径可保留。

## 3. 验收场景核对

- [x] **S1**：`USE_MYSQL=true` 且 MySQL 新库启动 → 创建 `provider_configs` / `agent_llm_configs` 表，并插入默认 active 行。
  - 证据来源：MySQL smoke 通过 `expectCount()` 验证两张表默认行。
  - 结果：通过。
- [x] **S2**：MySQL 模式 admin GET provider config → 返回默认 source order、env 状态、空 localOpenAI、Codex session view，不返回 raw secret。
  - 证据来源：MySQL smoke 初始 provider config 断言。
  - 结果：通过。
- [x] **S3**：MySQL 模式 PUT provider config 保存 local OpenAI 后，再次 GET / runtime read 能读到同一配置。
  - 证据来源：MySQL smoke 保存、masked response、runtime raw key 读取和 source order 断言。
  - 结果：通过。
- [x] **S4**：MySQL 模式保存 local OpenAI 后，provider selection 可以选中 `local-openai`。
  - 证据来源：MySQL smoke 断言 `activeSource.id === "local-openai"`。
  - 结果：通过。
- [x] **S5**：坏 `source_order_json` 回退默认 source order，不 500。
  - 证据来源：SQLite/MySQL smoke 都直接写入坏 JSON 后断言默认顺序。
  - 结果：通过。
- [x] **S6**：MySQL 模式保存 Agent LLM 后返回 `configured=true`，Agent WebSocket 不再因缺配置返回 `missing_agent_config`。
  - 证据来源：MySQL smoke 断言 `getUsableAgentLlmConfig()` 返回 raw key；`websocket-session.ts` 已 await 该 runtime config。
  - 结果：通过。
- [x] **S7**：MySQL 模式 Agent config 保存时只传 masked key 或 `preserveApiKey=true`，不覆盖 raw key。
  - 证据来源：MySQL smoke 断言 masked/preserve 保存后 raw key 仍存在，非 secret 字段可更新。
  - 结果：通过。
- [x] **S8**：MySQL 模式 Codex device login/token 写入后，provider config 中 `codex.available=true`。
  - 证据来源：MySQL smoke 直接插入等价 token row 后 provider config 断言。
  - 结果：通过。
- [x] **S9**：MySQL 模式 Codex logout 删除 token，`codex.available=false`，source order 保留。
  - 证据来源：MySQL smoke 调用 `logoutCodex()` 后 provider config 断言。
  - 结果：通过。
- [x] **S10**：SQLite 模式 provider config、Agent config、Codex login/logout 仍按现有行为通过。
  - 证据来源：SQLite provider config smoke。
  - 结果：通过。
- [x] **S11**：非 admin 仍被拒绝。
  - 证据来源：route 仍在 GET/PUT provider config、GET/PUT Agent config、Codex start/poll/logout 使用 `requireAdmin`。
  - 结果：通过。
- [x] **S12**：数据库或配置错误响应不包含 API key、OAuth token、MySQL password、OSS AK/SK、SQL 连接串或 raw SQL error。
  - 证据来源：provider/Agent PUT catch 已改为稳定错误文案；domain 和 response 继续使用 masked secret。
  - 结果：通过。

**已执行验证**：

- [x] `python3 .codestable/tools/validate-yaml.py --file .codestable/features/2026-05-29-mysql-provider-agent-config/mysql-provider-agent-config-checklist.yaml`
- [x] `pnpm --filter @gpt-image-canvas/api smoke:provider-config`
- [x] Docker MySQL 8.4 temporary container + `pnpm --filter @gpt-image-canvas/api smoke:provider-config:mysql`
- [x] `pnpm typecheck`
- [x] `pnpm build`

**浏览器验证**：

- [x] 未执行。理由：本 feature 未改 Web UI，系统页面继续使用既有 GET/PUT 契约；SQLite/MySQL smoke 覆盖同一 provider/Agent/Codex 保存读取契约。

## 4. 术语一致性

- `provider source order`：design、shared contract、provider config domain、architecture 文档一致。
- `env-openai` / `local-openai` / `codex`：shared `PROVIDER_SOURCE_IDS`、默认 source order、smoke 和 docs 一致。
- `Environment OpenAI-compatible config`：代码只读 `OPENAI_*`，architecture/docs 均声明系统页面不写 env。
- `Local OpenAI-compatible config`：domain、docs、requirement 均指向系统页面保存的本地 provider 配置。
- `Agent LLM config`：shared contract、domain、architecture、requirement 均指向独立 Agent 规划模型配置。
- `Codex fallback`：provider source、Codex auth domain、architecture/docs 均指向同一 OAuth session 状态。
- `配置行`：architecture 已记录 `provider_configs.active`、`agent_llm_configs.active`、`codex_oauth_tokens.default`；代码和 smoke 均按该约定实现。
- 防冲突：未新增 generation scheduler 并发/重试策略、per-user provider、OSS/MySQL/Redis/Mail Gateway 系统页面配置等混淆命名。

## 5. 架构归并

- [x] `.codestable/architecture/ARCHITECTURE.md`：已加入 provider source order、Environment/Local OpenAI-compatible config、Agent LLM config、Codex fallback、配置行等术语。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已加入 Provider config domain、Codex auth domain、Agent LLM config domain，以及 SQLite/MySQL 都保存 `provider_configs.active`、`agent_llm_configs.active`、`codex_oauth_tokens.default` 的持久化说明。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录 admin-only 全局工作站配置、SQLite/MySQL 共享配置契约、无自动迁移、env provider 只读、坏 source order JSON 回退默认、API 只返回 masked secret。
- [x] `.codestable/architecture/ARCHITECTURE.md`：已记录硬边界：不支持 per-user provider/Agent/Codex 配置，系统页面不配置 OSS/MySQL/Redis/Mail Gateway 凭据。
- [x] `docs/generated/db-schema.md`：已移除 provider/Agent config SQLite-only 口径，补充 SQLite/MySQL 类型差异和切换 MySQL 不迁移配置的说明。
- [x] `docs/RELIABILITY.md`：已说明 MySQL 模式保存 provider/Agent/Codex 配置，不读取 SQLite 数据，不迁移旧配置。
- [x] `docs/product-specs/provider-configuration.md`：已说明系统页面契约在 SQLite/MySQL 模式一致，切换 MySQL 后需要重新保存 provider/Agent 设置或重新登录 Codex。

## 6. requirement 回写

- [x] 方案 frontmatter `requirement: null`，但本 feature 新增了管理员可感知的系统配置能力，已执行 backfill。
- [x] 新增 `.codestable/requirements/system-provider-configuration.md`，状态为 `current`，记录系统页面配置图片 provider、Agent 模型和 Codex fallback 的用户故事、边界和变更日志。
- [x] `.codestable/requirements/VISION.md` 已把 `system-provider-configuration` 加入 current 能力索引。

## 7. roadmap 回写

- [x] 非 roadmap 起头。方案 frontmatter 没有 `roadmap` / `roadmap_item` 字段，不需要更新 roadmap items 或主文档。

## 8. attention.md 候选盘点

- [x] 无新候选。本 feature 没暴露新的每个后续 feature 都会反复踩到的环境或工作流坑。
- [x] 已有注意事项仍有效：依赖临时 SQLite 的 smoke 测试要显式设置 `USE_MYSQL=false`，避免本机 `.env` 启用 MySQL 时连到全局运行库。

## 9. 遗留

- 后续优化点：`apps/web/src/features/provider-config/ProviderConfigDialog.tsx` 仍偏大，可另走 `cs-refactor` 拆分 provider、Agent 和 Codex 面板。
- 后续优化点：`apps/api/src/domain/providers/codex-auth.ts` 同时包含 OAuth 编排和 token persistence，后续若扩展 token 安全策略可拆 token store。
- 已知限制：不迁移 SQLite 旧配置到 MySQL；切换数据库后需要管理员重新保存 provider/Agent 设置并重新登录 Codex fallback。
- 已知限制：仍是 admin-only 全局工作站配置，不支持 per-user provider 或 Agent 模型。
- 已知限制：系统页面不配置 OSS、MySQL、Redis、Mail Gateway 或其他部署凭据。
- 实现阶段顺手发现：provider/Agent config route 原先会把保存异常转成 `error.message`，验收时已收敛为稳定错误文案，避免 DB/SQL 细节外泄。
