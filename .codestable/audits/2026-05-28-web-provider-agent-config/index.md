---
doc_type: audit-index
audit: 2026-05-28-web-provider-agent-config
scope: image provider and Agent LLM configuration UI
created: 2026-05-28
status: active
total_findings: 4
---

# web-provider-agent-config 审计报告

## 范围

扫描 `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`，并对照 `docs/SECURITY.md`、`docs/RELIABILITY.md` 中的 provider source order、secret masking 和 Agent LLM 独立配置约束。

## 总评

共发现 4 条：2 条 `bug`、1 条 `security`、1 条 `maintainability`。最值得优先处理的是图片 provider 和 Agent LLM 配置以两个请求顺序保存，第一段已生效后第二段失败会留下半成功状态。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P1 | high | 图片 provider 和 Agent LLM 配置保存不是原子操作 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | medium | 配置响应被强转后直接应用到表单和运行状态 | [finding-02.md](finding-02.md) |
| 3 | security | P2 | low | secret 展示组件完全信任 API 返回的 masked value | [finding-03.md](finding-03.md) |
| 4 | maintainability | P2 | medium | Base URL 和 timeout 校验散落在保存函数内 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 2 | 0 | 2 |
| security | 0 | 0 | 1 | 1 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **2** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-01、finding-02 建议开 `cs-issue`，优先保证配置保存和响应解析可靠。
- **P2 有空再看**：finding-03 可和 API secret 响应测试一起做；finding-04 适合 `cs-refactor`。
