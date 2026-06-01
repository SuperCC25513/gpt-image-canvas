---
doc_type: explore
type: question
date: "2026-05-29"
slug: sqlite-journal-locking-mode
topic: SQLITE_JOURNAL_MODE 和 SQLITE_LOCKING_MODE 环境变量的作用
scope: SQLite runtime config, local .env defaults, Docker Compose overrides
keywords: [sqlite, wal, journal_mode, locking_mode, docker-compose]
status: active
confidence: high
---

## 问题与范围

问题：`.env` 中的 `SQLITE_JOURNAL_MODE=WAL` 和 `SQLITE_LOCKING_MODE=NORMAL` 有什么作用？

范围：只看当前仓库如何读取和应用这两个变量，以及本地运行和 Docker Compose 下默认值为什么不同。

## 速答

这两个变量只在 SQLite 模式下影响数据库文件的底层锁和日志策略，不改变业务表结构，也不改变 MySQL 模式。

- `SQLITE_JOURNAL_MODE` 会落到 SQLite `PRAGMA journal_mode`。本地默认 `WAL`，读写并发体验更好，但需要 SQLite shared-memory 辅助文件；Docker Desktop 绑定挂载下可能出现 shared-memory 打开失败，所以 Compose 默认用 `DELETE`。
- `SQLITE_LOCKING_MODE` 会落到 SQLite `PRAGMA locking_mode`。本地默认 `NORMAL`，更适合普通本机开发；Compose 默认 `EXCLUSIVE`，让容器内 SQLite 连接独占数据库文件，减少绑定挂载上的锁/共享内存问题。
- 你贴的值是显式设置 `WAL/NORMAL`。如果 `.env` 里真写了这两个值，Docker Compose 的 `${VAR:-DELETE}` / `${VAR:-EXCLUSIVE}` 会被覆盖；想让“本地 WAL/NORMAL、Compose DELETE/EXCLUSIVE”同时成立，应把这两个变量留空或不在启动 Compose 的环境中设置。

## 关键证据

1. `.env.example:71-73` 说明本地留空走 WAL，Compose 默认走 DELETE + EXCLUSIVE，并给出这两个变量。
2. `apps/api/src/infrastructure/runtime.ts:35-57` 限定合法 journal mode 和 locking mode，并在空值或非法值时分别回退到 `WAL` 和 `NORMAL`。
3. `apps/api/src/infrastructure/runtime.ts:77-79` 把 `process.env.SQLITE_JOURNAL_MODE` 和 `process.env.SQLITE_LOCKING_MODE` 解析进 `sqliteConfig`。
4. `apps/api/src/infrastructure/sqlite-database.ts:35-43` 启动 SQLite 后执行 `locking_mode = ...` 和 `journal_mode = ...`。
5. `apps/api/src/infrastructure/sqlite-database.ts:45-51` 在 WAL 因 `SQLITE_IOERR_SHMOPEN` 不可用时，自动降级为 `locking_mode = EXCLUSIVE` + `journal_mode = DELETE`。
6. `docker-compose.yml:31-32` 和 `docker-compose.yml:45-46` 说明 Compose 对绑定挂载的 `/app/data` 默认设置 `DELETE/EXCLUSIVE`。
7. `README.md:194` 明确写出 Compose 默认 `DELETE/EXCLUSIVE` 是为了避开 Docker Desktop bind mount 上的 SQLite shared-memory 错误。

## 细节展开

`WAL` 是 SQLite 的 write-ahead log 模式。它通常让读操作和写操作更少互相阻塞，适合本地单机开发。但 WAL 会在数据库旁边使用 `-wal` 和 `-shm` 一类辅助文件；其中 shared-memory 文件在 Docker Desktop 的 bind mount 场景下更容易触发 `SQLITE_IOERR_SHMOPEN`。

`DELETE` 是传统 rollback journal 模式。事务提交后 journal 文件会被删除。它没有 WAL 对 shared-memory 文件的同类依赖，因此 Compose 把它作为绑定挂载数据目录的默认值。

`NORMAL` locking mode 使用 SQLite 常规锁生命周期，适合本地应用、脚本、数据库查看工具等不同时长期独占文件的场景。

`EXCLUSIVE` locking mode 会让 SQLite 连接更倾向独占数据库文件。它适合“只有一个 API 容器负责访问这个 SQLite 文件”的 Docker Compose 场景，但不适合同时让本地 `pnpm dev`、Docker、数据库 GUI 等多个进程访问同一个 `data/gpt-image-canvas.sqlite`。

## 未决问题

无。当前代码和文档口径一致：本地偏向 `WAL/NORMAL`，Compose 偏向 `DELETE/EXCLUSIVE`；但实际值以启动进程拿到的环境变量为准。

## 后续建议

如果要同时支持本地和 Compose，保持 `.env` 中这两个变量为空，比显式写 `WAL/NORMAL` 更贴合注释意图。

## 相关文档

- `README.md`
- `docs/RELIABILITY.md`
- `docs/generated/db-schema.md`
