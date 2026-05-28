---
doc_type: audit-finding
audit: 2026-05-28-backend-persistence-sqlite-mysql
finding_id: "bug-01"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: fixed
---

# Finding 01：旧 `generation_audits` 表补 `generation_id` 后立即建唯一索引，可能让已有多条 audit 的 SQLite 库启动失败

## 速答

SQLite 迁移给旧 `generation_audits` 表新增 `generation_id TEXT NOT NULL DEFAULT ''` 后，马上创建 `generation_id` 唯一索引；如果旧表已有多条 audit，所有新列都是空字符串，唯一索引会冲突并导致启动迁移失败。

## 关键证据

- `apps/api/src/infrastructure/sqlite-database.ts:359` — `ensureColumn(sqlite, "generation_audits", "generation_id", "generation_id TEXT NOT NULL DEFAULT ''");` —— 旧表补列时所有既有行默认都是 `""`。
- `apps/api/src/infrastructure/sqlite-database.ts:373` — `CREATE UNIQUE INDEX IF NOT EXISTS generation_audits_generation_id_idx ON generation_audits(generation_id)` —— 补列后立即创建唯一索引。
- `apps/api/src/infrastructure/sqlite-database.ts:442` — `function ensureColumn(...)` —— 只检查列是否存在，不做数据回填。
- `apps/api/src/infrastructure/sqlite-database.ts:448` — `sqlite.exec(\`ALTER TABLE ... ADD COLUMN ${definition}\`)` —— 添加列后没有按旧审计记录回填唯一值。
- `apps/api/src/infrastructure/mysql-database.ts:384` — MySQL schema 也要求 `generation_id` 为 `VARCHAR(191) NOT NULL`。
- `apps/api/src/infrastructure/mysql-database.ts:528` — `await ensureMySqlColumn(pool, "generation_audits", "generation_id");` —— MySQL 旧表也会补该列。
- `apps/api/src/infrastructure/mysql-database.ts:555` — `await ensureMySqlUniqueIndex(pool, "generation_audits", "generation_audits_generation_id_idx", "generation_id");` —— MySQL 同样后续建唯一索引。

## 影响

新库没有问题，因为 `CREATE TABLE IF NOT EXISTS generation_audits` 已包含 `generation_id`。风险在升级旧库：只要旧 `generation_audits` 已存在且有两条以上记录，SQLite 启动迁移会因唯一索引冲突失败；MySQL 旧表补 `NOT NULL` 列和唯一索引也需要明确回填策略。结果是应用无法启动，且问题出现在持久化初始化阶段。

## 修复方向

迁移分三步：先添加可空/非唯一 `generation_id`，按可用旧字段回填真实 generation id 或迁移为兼容占位唯一值，再创建唯一索引；无法回填的历史行应明确归档或跳过，不应全部默认空字符串。

## 建议动作

`cs-issue`，因为这是旧库升级阻断型 bug，需要用带历史 audit 的临时库验证。
