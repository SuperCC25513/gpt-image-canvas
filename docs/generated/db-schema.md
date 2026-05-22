# 数据库 Schema

本文档记录当前持久化表结构。SQLite schema 定义在 `apps/api/src/infrastructure/schema.ts`，MySQL 建表 SQL 定义在 `apps/api/src/infrastructure/mysql-database.ts`。

最后检查：2026-05-22。

## 驱动行为

- 默认不设置 `DATABASE_DRIVER` 时使用 SQLite，数据文件为 `DATA_DIR/gpt-image-canvas.sqlite`。
- 设置 `DATABASE_DRIVER=mysql` 时只连接 MySQL，不读取 SQLite 数据，也不执行 SQLite 到 MySQL 的迁移。
- MySQL 配置来自环境变量：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_CONNECTION_LIMIT`、`MYSQL_CREATE_DATABASE`。
- 生成图片文件仍只写入 `DATA_DIR/assets`。数据库中的 `assets.relative_path` 只保存相对路径。
- 新库不创建云存储配置表，也不创建云资产备份字段。

## SQLite / MySQL 类型差异

- SQLite 文本列使用 `text`，MySQL 对主键和索引字段使用 `VARCHAR`，对快照、prompt、JSON 内容使用 `TEXT`/`LONGTEXT`。
- SQLite 布尔值使用 `integer` 的 `0/1`，MySQL 使用 `TINYINT` 的 `0/1`。
- 两种驱动都用 ISO 字符串保存时间，排序依赖 ISO 字符串的字典序。
- 两种驱动都包含用户、会话、系统设置、积分流水、每日签到、生成审计和私有数据 `user_id` 归属字段。

## `users`

Stores local account identities and password hashes.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `name` | text | Required display name. |
| `email` | text | Required normalized email; unique index. |
| `password_salt` | text | Required password salt. |
| `password_iterations` | integer | Required PBKDF2 iteration count. |
| `password_hash` | text | Required password hash. |
| `role` | text | Required user role (`user` or `admin`). |
| `status` | text | Required user status (`active`, `pending`, or `disabled`). |
| `credits` | integer | Required current credit balance. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `sessions`

Stores browser session token hashes.

| Column | Type | Notes |
| --- | --- | --- |
| `token_hash` | text | Primary key; SHA-256 of the cookie token. |
| `user_id` | text | Required owner user ID. |
| `expires_at` | text | Required ISO expiry timestamp. |
| `created_at` | text | Required ISO timestamp. |
| `last_seen_at` | text | Optional ISO timestamp updated during use. |

## `app_settings`

Stores minimal registration settings.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key; current row is `default`. |
| `allow_registration` | integer | Required boolean flag stored as integer; defaults to `1`. |
| `require_approval` | integer | Required boolean flag stored as integer; defaults to `0`. |
| `default_credits` | integer | Required default credits for registered users. |
| `generation_credit_cost` | integer | Required credits charged per requested output; defaults to `1`. |
| `checkin_credit` | integer | Required daily check-in reward; defaults to `1`. |
| `max_images_per_request` | integer | Required per-request generation count limit; defaults to `16`. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `credit_transactions`

Stores the immutable audit trail for every credit balance change.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Required owner user ID. |
| `delta` | integer | Required signed balance change. |
| `reason` | text | Required reason (`registration_bonus`, `daily_checkin`, `generation_charge`, `generation_refund`, or `admin_adjustment`). |
| `related_generation_id` | text | Optional generation id for charge/refund entries. |
| `related_output_id` | text | Optional output id reserved for per-output adjustments. |
| `related_checkin_date` | text | Optional local date key for check-in entries. |
| `admin_note` | text | Optional administrator note for manual adjustments. |
| `created_at` | text | Required ISO timestamp. |

唯一索引：`credit_transactions_generation_reason_idx` 覆盖 `related_generation_id` 和 `reason`，保证同一生成记录的扣费或退款流水幂等。

## `user_checkins`

Stores daily check-in rewards.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | text | Required owner user ID. |
| `checkin_date` | text | Required local date key (`YYYY-MM-DD`). |
| `credits_awarded` | integer | Required reward amount granted for this check-in. |
| `created_at` | text | Required ISO timestamp. |

主键或唯一约束：`user_id + checkin_date`，保证同一用户每天只能签到一次。

## `projects`

Stores the saved tldraw project snapshot.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `name` | text | Required project name. |
| `snapshot_json` | text | Required serialized project snapshot. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `assets`

Stores generated and reference asset metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `file_name` | text | Required stored filename. |
| `relative_path` | text | Required path relative to `DATA_DIR`. |
| `mime_type` | text | Required asset MIME type. |
| `width` | integer | Required image width. |
| `height` | integer | Required image height. |
| `created_at` | text | Required ISO timestamp. |

## `provider_configs`

Stores image provider source order and local OpenAI-compatible settings.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `source_order_json` | text | Required serialized provider source order. |
| `local_api_key` | text | Optional local API key. |
| `local_base_url` | text | Optional OpenAI-compatible base URL. |
| `local_model` | text | Optional image model. |
| `local_timeout_ms` | integer | Optional image timeout in milliseconds. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `agent_llm_configs`

Stores Agent planning model configuration.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `api_key` | text | Optional Agent LLM API key. |
| `base_url` | text | Required OpenAI-compatible base URL. |
| `model` | text | Required planning model. |
| `timeout_ms` | integer | Required timeout in milliseconds. |
| `supports_vision` | integer | Required boolean flag stored as integer. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `agent_skills`

Stores local-first Agent planning skills, including built-in seeded skills and user-created/imported skills.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `slug` | text | Required stable skill slug; unique index. |
| `name` | text | Required display name. |
| `description` | text | Required summary shown in the Skill Library. |
| `version` | text | Optional skill version. |
| `source` | text | Optional source URL or source note. |
| `enabled` | integer | Required boolean flag stored as integer. |
| `built_in` | integer | Required boolean flag for seeded skills. |
| `is_required` | integer | Required boolean flag; required skills cannot be disabled. |
| `trigger_mode` | text | Required trigger mode (`always` or `auto`). |
| `trigger_keywords_json` | text | Required serialized keyword array for user-defined auto triggers. |
| `files_json` | text | Required serialized map of `SKILL.md` and optional `references/**` text files. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `agent_conversations`

Stores local Agent conversation history and resumable context snapshots.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `title` | text | Required conversation title shown in history. |
| `messages_json` | text | Required serialized Agent transcript. |
| `context_json` | text | Required serialized resumable Agent context. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp; indexed for latest-first history. |

## `prompt_favorite_groups`

Stores per-user prompt favorite folders.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `name` | text | Required group name. |
| `sort_order` | integer | Required ordering value. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `prompt_favorites`

Stores per-user favorite prompt references.

唯一索引：`prompt_favorites_user_source_idx` 覆盖 `user_id`、`source_type` 和 `source_id`，允许不同用户独立收藏同一条提示词池项目。

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `source_type` | text | Required source type. |
| `source_id` | text | Required source ID. |
| `group_id` | text | Required reference to `prompt_favorite_groups.id`. |
| `title` | text | Required title. |
| `prompt` | text | Required prompt text. |
| `model` | text | Required model label. |
| `media_type` | text | Required media type. |
| `asset_url` | text | Required source asset URL. |
| `image_width` | integer | Optional image width. |
| `image_height` | integer | Optional image height. |
| `source_url` | text | Optional source URL. |
| `use_count` | integer | Required use count. |
| `last_used_at` | text | Optional ISO timestamp. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `codex_oauth_tokens`

Stores local Codex OAuth session state.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `access_token` | text | Optional access token. |
| `refresh_token` | text | Optional refresh token. |
| `id_token` | text | Optional ID token. |
| `email` | text | Optional account email. |
| `account_id` | text | Optional account ID. |
| `expires_at` | text | Optional token expiry timestamp. |
| `refreshed_at` | text | Optional refresh timestamp. |
| `unavailable_at` | text | Optional unavailable timestamp. |
| `unavailable_reason` | text | Optional unavailable reason. |
| `created_at` | text | Required ISO timestamp. |
| `updated_at` | text | Required ISO timestamp. |

## `generation_records`

Stores one generation request and its overall status.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `mode` | text | Required generation mode. |
| `prompt` | text | Required user prompt. |
| `effective_prompt` | text | Required prompt after preset composition. |
| `preset_id` | text | Required style preset ID. |
| `width` | integer | Required output width. |
| `height` | integer | Required output height. |
| `quality` | text | Required image quality. |
| `output_format` | text | Required output format. |
| `count` | integer | Required requested output count. |
| `status` | text | Required generation status. |
| `error` | text | Optional generation error. |
| `reference_asset_id` | text | Optional legacy reference to `assets.id`. |
| `created_at` | text | Required ISO timestamp. |

## `generation_outputs`

Stores individual output status and asset linkage for a generation.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key. |
| `user_id` | text | Optional owner user ID. |
| `generation_id` | text | Required reference to `generation_records.id`; cascades on delete. |
| `status` | text | Required output status. |
| `asset_id` | text | Optional reference to `assets.id`. |
| `error` | text | Optional output error. |
| `is_public` | integer / tinyint | Required output-level public flag; defaults to private. |
| `published_at` | text / varchar | Optional ISO timestamp set when an output is public. |
| `public_title` | text | Optional public display title for the output. |
| `created_at` | text | Required ISO timestamp. |

## `generation_audits`

Stores request-level admin audit metadata for generation requests.

唯一索引：`generation_audits_generation_id_idx` 覆盖 `generation_id`，保证同一生成请求只有一条审计记录。

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text / varchar | Primary key. |
| `generation_id` | text / varchar | Required generation record ID. |
| `user_id` | text / varchar | Optional requesting user ID snapshot. |
| `user_name` | text | Optional requesting user display-name snapshot. |
| `user_email` | text / varchar | Optional requesting user email snapshot. |
| `mode` | text / varchar | Required generation mode. |
| `prompt` | text / longtext | Required original user prompt. |
| `is_public` | integer / tinyint | Required request/output public flag. |
| `status` | text / varchar | Required generation status snapshot. |
| `error_summary` | text | Optional sanitized error summary. |
| `ip_address` | text / varchar | Optional request IP summary from forwarded headers. |
| `user_agent` | text | Optional sanitized User-Agent summary. |
| `outputs_json` | text / longtext | Required serialized output references used as fallback audit linkage. |
| `created_at` | text / varchar | Required ISO timestamp. |
| `updated_at` | text / varchar | Required ISO timestamp. |

## `generation_reference_assets`

Stores multiple reference assets used by one generation.

| Column | Type | Notes |
| --- | --- | --- |
| `generation_id` | text | Required reference to `generation_records.id`; cascades on delete. |
| `asset_id` | text | Required reference to `assets.id`. |
| `position` | integer | Required reference ordering. |
| `created_at` | text | Required ISO timestamp. |

## Relations

- `projects.user_id`、`assets.user_id`、`generation_records.user_id`、`generation_outputs.user_id`、`agent_conversations.user_id`、`prompt_favorite_groups.user_id`、`prompt_favorites.user_id` store the owner ID used by API authorization.
- `generation_records` has many `generation_outputs`.
- `generation_records` has many `generation_reference_assets`.
- `generation_audits.generation_id` records the generation request id and is joined with `generation_outputs` by admin audit queries.
- `generation_records.reference_asset_id` optionally references `assets.id`.
- `generation_outputs.generation_id` references `generation_records.id` with cascade delete.
- `generation_outputs.asset_id` optionally references `assets.id`.
- `generation_reference_assets.generation_id` references `generation_records.id` with cascade delete.
- `generation_reference_assets.asset_id` references `assets.id`.
- `credit_transactions.user_id` and `user_checkins.user_id` reference the owner user for balance audit and daily reward enforcement.
