---
doc_type: audit-index
audit: 2026-05-28-backend-assets-gallery
scope: Backend asset routes, Gallery routes, asset storage adapters, preview generation, ZIP export, and Gallery storage queries.
created: 2026-05-28
status: remediated
total_findings: 3
---

# backend-assets-gallery 审计报告

## 范围

本次审计覆盖后端资产读取和 Gallery 公开访问链路：

- `apps/api/src/server/routes/assets.ts`
- `apps/api/src/server/routes/gallery.ts`
- `apps/api/src/domain/assets/preview.ts`
- `apps/api/src/domain/assets/zip.ts`
- `apps/api/src/infrastructure/storage/asset-storage.ts`
- `apps/api/src/domain/storage/store.ts`
- `apps/api/src/domain/generation/image-generation.ts`

对照文档：

- `.codestable/architecture/ARCHITECTURE.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`

## 总评

共发现 3 条问题：`performance` 2 条，`bug` 1 条；严重度为 P1 1 条、P2 2 条。公开读取的主权限模型整体符合当前约束：匿名资产读取依赖 `generation_outputs.status = succeeded` 和 `generation_outputs.is_public = 1`，私有读取走 owner/admin 判断，路由在读取本地文件或签 OSS URL 前会先调用权限检查。主要风险集中在 Gallery ZIP 导出容量控制、OSS 对象可用性校验和预览生成并发。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | performance | P1 | medium | Gallery 导出没有业务上限，OSS 模式会把全部资产读入内存 | [finding-01.md](finding-01.md) |
| 2 | bug | P2 | medium | OSS 访问 URL 和 metadata 只信数据库记录，无法发现对象缺失 | [finding-02.md](finding-02.md) |
| 3 | performance | P2 | medium | 预览生成缺少单飞控制，并发请求会重复执行 Sharp/OSS 写入 | [finding-03.md](finding-03.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 0 | 1 | 1 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 1 | 1 | 2 |
| maintainability | 0 | 0 | 0 | 0 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **0** | **1** | **2** | **3** |

## 下一步建议

- **P1 本迭代修**：Finding 01，建议走 `cs-refactor`，给 Gallery 导出增加请求上限，并让 OSS 导出避免一次性缓存所有对象。
- **P2 有空再看**：Finding 02 建议走 `cs-issue`，补齐 OSS object 可用性语义；Finding 03 建议走 `cs-refactor`，给预览生成增加 single-flight 或等价去重。

