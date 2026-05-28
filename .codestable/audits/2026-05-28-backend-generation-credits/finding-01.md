---
doc_type: audit-finding
audit: 2026-05-28-backend-generation-credits
finding_id: "bug-01"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：audit start 失败后，最终成功/失败路径不会补建 generation audit

## 速答

生成任务开始时的 audit 写入被设计为非阻断；但如果起始写入失败，后续成功、失败、取消路径只更新已存在 audit，不会补建缺失记录，最终会丢失这次生成的审计记录。

## 关键证据

- `apps/api/src/domain/generation/generation-tasks.ts:219` — `async function recordGenerationAuditStartSafely(...)` —— audit 起始写入走安全包装。
- `apps/api/src/domain/generation/generation-tasks.ts:225` — `try { await recordGenerationAuditStart(...) }` —— 尝试写入起始 audit。
- `apps/api/src/domain/generation/generation-tasks.ts:232` — `} catch (error) { console.warn(...) }` —— 写入失败只告警，不阻断任务。
- `apps/api/src/domain/generation/image-generation.ts:782` — `async function updateGenerationAuditSafely(record: GenerationRecord)` —— 任务完成、失败或取消后走最终 audit 更新。
- `apps/api/src/domain/admin/audit-store.ts:112` — `export async function updateGenerationAuditFromRecord(record: GenerationRecord)` —— 最终更新入口。
- `apps/api/src/domain/admin/audit-store.ts:113` — `const existing = await findAuditRow(record.id);` —— 只查已有 audit。
- `apps/api/src/domain/admin/audit-store.ts:114` — `if (!existing) { return; }` —— 缺失时直接返回，不补建。

## 影响

`docs/RELIABILITY.md` 要求 audit 写入失败不阻断 provider 调用，但成功、失败、取消和重启中断路径应尽力更新审计状态。当前实现满足“不阻断”，但不满足“最终路径尽力补齐”。如果数据库短暂故障只影响 audit start，生成本身仍会执行，最终审计列表却永久缺该记录。

## 修复方向

让 `updateGenerationAuditFromRecord` 在缺失 audit 时执行 upsert，至少用 `GenerationRecord` 中可用字段补建状态、错误摘要和 outputs；缺失的 IP/User-Agent 可以为空。

## 建议动作

`cs-issue`，因为这是 audit 完整性 bug，触发条件清晰。

