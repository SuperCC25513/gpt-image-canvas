# Security And Privacy Guide

变更凭据处理、提供方配置、OAuth、生成资产、日志、Docker 或本地运行时数据前阅读本文。

## Security Model

`gpt-image-canvas` 面向本地工作站使用。项目状态、生成资产、生成历史、提供方设置、Agent LLM 设置和 Codex OAuth token 记录都保存在本地运行时数据中。

The app now requires local account sign-in before creative, Gallery, asset, provider, Agent, and prompt-favorite APIs can be used. This is a local-workstation auth boundary, not a complete public-internet hardening layer; do not expose the app publicly without additional network controls, TLS, operational monitoring, and a reviewed deployment model.

## Secrets

Secrets may come from:

- `.env` or runtime environment variables.
- Initial administrator bootstrap values from `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME`.
- Local provider config stored in SQLite.
- `DATABASE_DRIVER=mysql` 时使用的 MySQL 连接凭据。
- Agent LLM config stored in SQLite.
- Codex OAuth tokens stored in SQLite.

Rules:

- Never commit `.env`, `data/`, SQLite databases, generated images, `.ralph/`, `.codex-temp/`, or build output.
- 不要把本机 MySQL 密码写入 `.env.example`、文档示例、日志或提交信息。
- 不要记录原始 API key、OAuth token 或已保存的提供方配置值。
- Read APIs should return masked secrets only.
- `ADMIN_PASSWORD` is only used when creating the admin user for the first time. If the email already exists, startup only ensures `role=admin` and `status=active`; it must not reset the stored password.
- Session cookies must be `HttpOnly`、`SameSite=Lax`、`Path=/`; the database stores only a SHA-256 hash of the session token.
- Preserve existing secret values only when the request explicitly uses a preserve flag or leaves a masked value unchanged.
- If a real key was committed, rotate it. `.gitignore` does not remove secrets from Git history.

## Local Data

Generated images can contain private user content. Treat local assets and previews as sensitive by default.

Owner fields on projects, assets, generation records/outputs, Agent conversations, and prompt favorites are part of the privacy boundary. Asset routes must authorize the owner or an admin before resolving and reading files from `DATA_DIR/assets`.

公开 Gallery 输出是唯一允许匿名读取资产的例外。公开判定必须来自 `generation_outputs` 上成功输出的 `is_public` 状态，不得只凭 asset ID、文件存在或公开广场列表缓存放行；改回私密或删除输出后匿名读取应返回 404。

When adding browser tests that save fake credentials, clear or restore local test configuration before finishing. Do not leave real-looking secrets in `data/`.

## API And Error Handling

- Validate JSON bodies and content types before using request data.
- Prefer stable error codes from shared contracts or API helpers.
- Do not pass raw upstream provider errors directly to clients if they may contain credentials or request internals.
- Do not expose filesystem paths, shell details, environment contents, or database internals through API responses.

## Docker

With real credentials present, validate Docker config with:

```sh
docker compose config --quiet --no-env-resolution
```

Avoid plain `docker compose config` because it can expand and print env values.

## Review Checklist

- Are all user inputs validated before storage or provider calls?
- Are secrets masked in API responses and UI?
- Are logs free of keys, tokens, request headers, and credential-bearing URLs?
- Are generated files written only under `DATA_DIR`?
- Are asset reads constrained to the expected asset directory?
- Does the change avoid exposing the local app publicly by default?
