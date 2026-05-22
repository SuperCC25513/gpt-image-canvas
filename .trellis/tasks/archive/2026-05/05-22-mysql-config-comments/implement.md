# 实施计划

## 检查清单

1. 加载开发前规范：
   - `trellis-before-dev`
   - `.trellis/spec/api/backend/database-guidelines.md`
   - `docs/RELIABILITY.md`
   - `docs/SECURITY.md`
2. 更新配置解析：
   - 新增 `USE_MYSQL` 布尔解析。
   - 默认 SQLite。
   - `USE_MYSQL=true` 启用 MySQL。
   - 保留或明确处理旧 `DATABASE_DRIVER` 兼容路径。
3. 更新 `.env.example`：
   - 移除 `DATABASE_DRIVER=sqlite`。
   - 增加 `USE_MYSQL=false` 或同等布尔开关说明。
   - 保留 `MYSQL_CREATE_DATABASE=false`。
4. 重构 MySQL schema 定义：
   - 为 18 张表补表注释。
   - 为所有字段补字段注释。
   - 生成带注释的 `CREATE TABLE IF NOT EXISTS`。
5. 增加已有表/字段注释迁移：
   - 表注释：`ALTER TABLE ... COMMENT = ...`。
   - 字段注释：`ALTER TABLE ... MODIFY COLUMN ... COMMENT ...`。
   - 新增兼容列时携带注释。
6. 更新文档：
   - `docs/generated/db-schema.md`
   - `docs/RELIABILITY.md`
   - `docs/SECURITY.md`
   - 如 Trellis 后端数据库规范仍写旧变量，补充项目规范更新。
7. 验证：
   - `nvm use 24.15.0`
   - `pnpm typecheck`
   - `pnpm build`
   - 若可连接测试 MySQL，使用临时非提交配置验证表和字段注释；若本机凭据不可用，记录阻塞原因。

## 回滚点

- 配置解析改动集中在 `database-config.ts`，可单独回滚。
- MySQL 注释改动集中在 `mysql-database.ts`，应避免混入业务读写改动。
- 文档改动可独立回滚，不影响运行时。

## 风险文件

- `apps/api/src/infrastructure/mysql-database.ts`：字段定义必须完整复用，避免 `MODIFY COLUMN` 改坏约束。
- `apps/api/src/infrastructure/database-config.ts`：默认值和旧配置兼容可能影响启动驱动选择。
- `.env.example`：不能放真实密码。
