# GPT Image Canvas Image Release

## Config Discovery

- Deployment shape: one Docker image, one container, one HTTP port.
- Container port: `8787`.
- Health check: `GET /health`; `GET /api/health` remains available for existing clients.
- Frontend serving: API serves `apps/web/dist`; `/api/*` misses return JSON 404 before SPA fallback.
- Non-sensitive files copied into the image:
  - `prompt-pool-data/prompts-all.json` -> `/app/prompt-pool-data/prompts-all.json`
  - `prompt-pool-data/summary.json` -> `/app/prompt-pool-data/summary.json`
- Runtime config files required in the container: none beyond bundled Prompt Pool JSON above.
- Database migration material: MySQL schema is embedded in `apps/api/src/infrastructure/mysql-database.ts` and runs on startup. `MYSQL_CREATE_DATABASE=false` expects the database to already exist; tables, indexes, and comments are ensured by the app user.
- Secrets are injected only by environment variables or runtime storage. Do not write real secrets into this directory.

## Required Runtime Environment

Core:

- `HOST=0.0.0.0`
- `PORT=8787`
- `DATA_DIR=/app/data`
- `PROMPT_POOL_DIR=/app/prompt-pool-data`
- `REDIS_URL`
- `GENERATION_QUEUE_DRIVER=redis`

Production MySQL + OSS:

- `USE_MYSQL=true`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD` secret
- `MYSQL_DATABASE`
- `MYSQL_CONNECTION_LIMIT`
- `MYSQL_CREATE_DATABASE=false`
- `OSS_ENDPOINT`
- `OSS_BUCKET_NAME`
- `OSS_ACCESS_KEY_ID` secret
- `OSS_ACCESS_KEY_SECRET` secret
- `OSS_EXPIRE`
- `OSS_UPLOAD_MAX`
- `OSS_ROOT_PATH`
- `OSS_INTERNAL`

Provider and registration:

- `OPENAI_API_KEY` secret, optional when another provider path is used.
- `OPENAI_BASE_URL`, optional.
- `OPENAI_IMAGE_MODEL`, optional.
- `OPENAI_IMAGE_TIMEOUT_MS`, optional.
- `CODEX_RESPONSES_MODEL`, optional.
- `CODEX_RESPONSES_BASE_URL`, optional.
- `CODEX_AUTH_ISSUER`, optional.
- `CODEX_REFRESH_TOKEN_URL`, optional.
- `CODEX_AUTH_TIMEOUT_MS`, optional.
- `CODEX_IMAGE_TIMEOUT_MS`, optional.
- `MAIL_GATEWAY_BASE_URL`, required for registration email verification; production internal URL is `http://cc-base:9000`.
- `MAIL_GATEWAY_API_KEY` secret, required for registration email verification.
- `MAIL_GATEWAY_TIMEOUT_MS`, optional.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` secret, and `ADMIN_NAME`, optional first-admin bootstrap values. Set all three together.

## Build And Push

```sh
VERSION=gpt-image-cc-YYYYMMDD-NNN docker-config/release-image.sh
```

Omit `VERSION` to publish the next free `gpt-image-cc-YYYYMMDD-NNN` tag for today.

Defaults:

- `PLATFORM=linux/amd64`
- Public push registry: `crpi-9jyz42cz1n1dtzno.cn-hangzhou.personal.cr.aliyuncs.com/supercc25513/cc`
- VPC pull registry: `crpi-9jyz42cz1n1dtzno-vpc.cn-hangzhou.personal.cr.aliyuncs.com/supercc25513/cc`

The script refuses `latest` and refuses to overwrite an existing remote tag.
