---
doc_type: audit-index
audit: 2026-05-28-web-simple-generation-flow
scope: simple prompt-to-image and reference edit page
created: 2026-05-28
status: active
total_findings: 4
---

# web-simple-generation-flow 审计报告

## 范围

扫描 `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx`、`apps/web/src/shared/imageValidation.ts` 和 `apps/web/src/shared/generationCounts.ts`。重点看 prompt-to-image、参考图编辑、本地引用读取、生成轮询、公开状态和输入校验。

## 总评

共发现 4 条：2 条 `performance`、1 条 `security`、1 条 `bug`。最值得优先处理的是简易生成页把所有输出硬编码为公开，与产品隐私原则存在张力；其次是参考图以 data URL 形式常驻 React state，较大图片会明显放大内存压力。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P1 | medium | 简易生成硬编码公开发布，用户没有私密选项 | [finding-01.md](finding-01.md) |
| 2 | performance | P1 | medium | 参考图以 data URL 存在 React state，内存放大明显 | [finding-02.md](finding-02.md) |
| 3 | performance | P2 | medium | 轮询等待函数反复注册 abort listener 且正常完成不移除 | [finding-03.md](finding-03.md) |
| 4 | bug | P2 | medium | 生成轮询没有最大等待时间或最大次数 | [finding-04.md](finding-04.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 0 | 1 | 1 |
| security | 0 | 1 | 0 | 1 |
| performance | 0 | 1 | 1 | 2 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **2** | **2** | **4** |

## 下一步建议

- **P1 本迭代修**：finding-01 建议开 `cs-issue` 对齐公开/私密产品语义；finding-02 建议走 `cs-refactor` 降低引用图内存。
- **P2 有空再看**：finding-03、finding-04 可以一起处理生成轮询生命周期。
