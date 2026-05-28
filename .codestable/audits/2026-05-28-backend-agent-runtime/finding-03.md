---
doc_type: audit-finding
audit: 2026-05-28-backend-agent-runtime
finding_id: "performance-03"
nature: performance
severity: P2
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 03：技能导入先完整读取 multipart 文件，大小限制生效过晚

## 速答

`/api/agent-skills/import` 会先让 Hono/Request 解析完整 `formData()`，再 `file.arrayBuffer()` 读完整文件，最后才在 domain 层检查 2MB 上传限制；超大上传会先占用内存。

## 关键证据

- `apps/api/src/server/routes/agent-skills.ts:96` — `let formData: FormData;` —— 准备读取 multipart body。
- `apps/api/src/server/routes/agent-skills.ts:98` — `formData = await c.req.raw.formData();` —— 整个 multipart 请求先被解析。
- `apps/api/src/server/routes/agent-skills.ts:109` — `const bytes = new Uint8Array(await file.arrayBuffer());` —— 上传文件再完整读入内存。
- `apps/api/src/server/routes/agent-skills.ts:111` — `importAgentSkillFromUpload({ ... bytes })` —— 完整 bytes 传给 domain。
- `apps/api/src/domain/agent/skill-store.ts:25` — `const MAX_SKILL_UPLOAD_BYTES = 2 * 1024 * 1024;` —— domain 层有 2MB 限制。
- `apps/api/src/domain/agent/skill-store.ts:171` — `export function importAgentSkillFromUpload(...)` —— 限制在 domain 导入入口。
- `apps/api/src/domain/agent/skill-store.ts:174` — `if (input.bytes.byteLength > MAX_SKILL_UPLOAD_BYTES)` —— 只有完整读取后才拒绝。

## 影响

已登录用户可以上传明显超过 2MB 的 multipart 文件，API 仍会先解析并分配内存，再返回错误。虽然这是本地工作站产品，不是公网硬化服务，但该路径仍可能造成单进程内存峰值，尤其 zip 文件在后续还有解压成本。

## 修复方向

在 HTTP 层检查 `Content-Length`，并使用带大小限制的 streaming multipart 解析；至少在读取 `arrayBuffer()` 前拒绝超过上限的 `File.size`。

## 建议动作

`cs-refactor`，因为修复需要调整上传处理方式和限制下沉位置。

