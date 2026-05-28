---
doc_type: audit-task
audit: 2026-05-28-backend-audit-tasks
task_id: "01"
slug: backend-assets-gallery
status: completed
priority: P0
recommended_dimensions:
  - security
  - bug
  - arch-drift
completed: 2026-05-28
result: .codestable/audits/2026-05-28-backend-assets-gallery/
---

# Task 01：资产读取 + Gallery 公开访问

## 目标产物

`.codestable/audits/2026-05-28-backend-assets-gallery/`

## 路径

- `apps/api/src/server/routes/assets.ts`
- `apps/api/src/server/routes/gallery.ts`
- `apps/api/src/domain/assets/preview.ts`
- `apps/api/src/domain/assets/zip.ts`
- `apps/api/src/infrastructure/storage/asset-storage.ts`
- `apps/api/src/domain/storage/store.ts`

## 业务含义

负责资产预览、资产下载、公开 Gallery、导出 ZIP、本地文件读取和 OSS 预签名访问。

## 风险理由

资产是隐私边界核心。这里同时存在登录用户读取、管理员读取、匿名公开读取、本地文件路径和 OSS object key，越权、路径穿越、公开状态失效、签名 URL 泄露都应优先排查。

## 推荐审计维度

- `security`：资源归属校验、匿名公开例外、OSS 签名、路径校验、敏感路径暴露。
- `bug`：输出删除/改私密后的读取状态、缺失资产、预览生成失败、ZIP 部分失败。
- `arch-drift`：是否符合 `generation_outputs.is_public` 作为唯一公开开关的架构约束。

## 重点检查

- 匿名 `/api/assets/*` 是否只允许成功且公开的输出。
- owner/admin 判断是否发生在本地读取或 OSS 签名前。
- 本地路径是否被限制在 `DATA_DIR/assets`。
- OSS object key 是否被限制在配置 root-path。
- Gallery ZIP 是否会绕过单项资产权限。

## 不做

不审计 Web Gallery UI；不修复发现。
