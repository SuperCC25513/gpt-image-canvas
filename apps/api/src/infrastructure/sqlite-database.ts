import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureRuntimeStorage, runtimePaths, sqliteConfig } from "./runtime.js";
import * as schema from "./schema.js";

const DEFAULT_REGISTRATION_CREDITS = 10;
const DEFAULT_GENERATION_CREDIT_COST = 1;
const DEFAULT_CHECKIN_CREDIT = 1;
const DEFAULT_MAX_IMAGES_PER_REQUEST = 16;

export type SqliteDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface SqliteDatabaseContext {
  driver: "sqlite";
  db: SqliteDatabase;
  close: () => void;
}

export function createSqliteDatabase(): SqliteDatabaseContext {
  ensureRuntimeStorage();

  const sqlite = new Database(runtimePaths.databaseFile);
  configureSqlite(sqlite);
  migrateSqlite(sqlite);

  return {
    driver: "sqlite",
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close()
  };
}

function configureSqlite(database: Database.Database): void {
  database.pragma(`locking_mode = ${sqliteConfig.lockingMode}`);
  database.pragma("foreign_keys = ON");
  applyJournalMode(database);
}

function applyJournalMode(database: Database.Database): void {
  try {
    database.pragma(`journal_mode = ${sqliteConfig.journalMode}`);
  } catch (error) {
    if (sqliteConfig.journalMode !== "WAL" || !isSharedMemoryOpenError(error)) {
      throw error;
    }

    console.warn("SQLite WAL mode is unavailable for DATA_DIR; falling back to DELETE journal mode.");
    database.pragma("locking_mode = EXCLUSIVE");
    database.pragma("journal_mode = DELETE");
  }
}

function isSharedMemoryOpenError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "SQLITE_IOERR_SHMOPEN"
  );
}

function migrateSqlite(sqlite: Database.Database): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  source_order_json TEXT NOT NULL,
  local_api_key TEXT,
  local_base_url TEXT,
  local_model TEXT,
  local_timeout_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY NOT NULL,
  allow_registration INTEGER NOT NULL DEFAULT 1,
  require_approval INTEGER NOT NULL DEFAULT 0,
  default_credits INTEGER NOT NULL DEFAULT 10,
  generation_credit_cost INTEGER NOT NULL DEFAULT 1,
  checkin_credit INTEGER NOT NULL DEFAULT 1,
  max_images_per_request INTEGER NOT NULL DEFAULT 16,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  related_generation_id TEXT,
  related_output_id TEXT,
  related_checkin_date TEXT,
  related_redemption_code_id TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_checkins (
  user_id TEXT NOT NULL REFERENCES users(id),
  checkin_date TEXT NOT NULL,
  credits_awarded INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS redemption_codes (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT,
  redeemed_by_user_id TEXT REFERENCES users(id),
  redeemed_at TEXT,
  created_by_admin_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_redemptions (
  id TEXT PRIMARY KEY NOT NULL,
  code_id TEXT NOT NULL REFERENCES redemption_codes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  credits_awarded INTEGER NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES credit_transactions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_llm_configs (
  id TEXT PRIMARY KEY NOT NULL,
  api_key TEXT,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  title TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT,
  source TEXT,
  enabled INTEGER NOT NULL,
  built_in INTEGER NOT NULL,
  is_required INTEGER NOT NULL,
  trigger_mode TEXT NOT NULL,
  trigger_keywords_json TEXT NOT NULL,
  files_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_favorite_groups (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_favorites (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES prompt_favorite_groups(id),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  media_type TEXT NOT NULL,
  asset_url TEXT NOT NULL,
  image_width INTEGER,
  image_height INTEGER,
  source_url TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_oauth_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  email TEXT,
  account_id TEXT,
  expires_at TEXT,
  refreshed_at TEXT,
  unavailable_at TEXT,
  unavailable_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  effective_prompt TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  quality TEXT NOT NULL,
  output_format TEXT NOT NULL,
  count INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  reference_asset_id TEXT REFERENCES assets(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id),
  error TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  public_title TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_audits (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_summary TEXT,
  ip_address TEXT,
  user_agent TEXT,
  outputs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_reference_assets (
  generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (generation_id, position)
);

CREATE INDEX IF NOT EXISTS generation_records_created_at_idx ON generation_records(created_at);
CREATE INDEX IF NOT EXISTS generation_records_user_id_idx ON generation_records(user_id);
CREATE INDEX IF NOT EXISTS generation_outputs_generation_id_idx ON generation_outputs(generation_id);
CREATE INDEX IF NOT EXISTS generation_outputs_user_id_idx ON generation_outputs(user_id);
CREATE INDEX IF NOT EXISTS generation_outputs_asset_id_idx ON generation_outputs(asset_id);
CREATE INDEX IF NOT EXISTS generation_outputs_public_idx ON generation_outputs(is_public, published_at);
CREATE UNIQUE INDEX IF NOT EXISTS generation_audits_generation_id_idx ON generation_audits(generation_id);
CREATE INDEX IF NOT EXISTS generation_audits_created_at_idx ON generation_audits(created_at);
CREATE INDEX IF NOT EXISTS generation_audits_user_id_idx ON generation_audits(user_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_generation_id_idx ON generation_reference_assets(generation_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_asset_id_idx ON generation_reference_assets(asset_id);
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS assets_user_id_idx ON assets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_generation_reason_idx ON credit_transactions(related_generation_id, reason);
CREATE INDEX IF NOT EXISTS user_checkins_user_id_idx ON user_checkins(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS redemption_codes_code_idx ON redemption_codes(code);
CREATE INDEX IF NOT EXISTS redemption_codes_status_idx ON redemption_codes(status);
CREATE INDEX IF NOT EXISTS redemption_codes_redeemed_by_user_id_idx ON redemption_codes(redeemed_by_user_id);
CREATE INDEX IF NOT EXISTS redemption_codes_created_at_idx ON redemption_codes(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS credit_redemptions_code_id_idx ON credit_redemptions(code_id);
CREATE INDEX IF NOT EXISTS credit_redemptions_user_id_idx ON credit_redemptions(user_id);
CREATE INDEX IF NOT EXISTS credit_redemptions_transaction_id_idx ON credit_redemptions(transaction_id);
CREATE INDEX IF NOT EXISTS agent_conversations_updated_at_idx ON agent_conversations(updated_at);
CREATE INDEX IF NOT EXISTS agent_conversations_user_id_idx ON agent_conversations(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_slug_idx ON agent_skills(slug);
CREATE INDEX IF NOT EXISTS prompt_favorite_groups_user_id_idx ON prompt_favorite_groups(user_id);
CREATE INDEX IF NOT EXISTS prompt_favorites_user_id_idx ON prompt_favorites(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_favorites_user_source_idx ON prompt_favorites(user_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS prompt_favorites_group_id_idx ON prompt_favorites(group_id);
CREATE INDEX IF NOT EXISTS prompt_favorites_last_used_at_idx ON prompt_favorites(last_used_at);
`);

  ensureColumn(sqlite, "projects", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "assets", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "generation_records", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "generation_outputs", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "generation_outputs", "is_public", "is_public INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "generation_outputs", "published_at", "published_at TEXT");
  ensureColumn(sqlite, "generation_outputs", "public_title", "public_title TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS generation_outputs_public_idx ON generation_outputs(is_public, published_at)");
  ensureColumn(sqlite, "generation_audits", "generation_id", "generation_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "generation_audits", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "generation_audits", "user_name", "user_name TEXT");
  ensureColumn(sqlite, "generation_audits", "user_email", "user_email TEXT");
  ensureColumn(sqlite, "generation_audits", "mode", "mode TEXT NOT NULL DEFAULT 'generate'");
  ensureColumn(sqlite, "generation_audits", "prompt", "prompt TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "generation_audits", "is_public", "is_public INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "generation_audits", "status", "status TEXT NOT NULL DEFAULT 'running'");
  ensureColumn(sqlite, "generation_audits", "error_summary", "error_summary TEXT");
  ensureColumn(sqlite, "generation_audits", "ip_address", "ip_address TEXT");
  ensureColumn(sqlite, "generation_audits", "user_agent", "user_agent TEXT");
  ensureColumn(sqlite, "generation_audits", "outputs_json", "outputs_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(sqlite, "generation_audits", "created_at", "created_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "generation_audits", "updated_at", "updated_at TEXT NOT NULL DEFAULT ''");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS generation_audits_generation_id_idx ON generation_audits(generation_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS generation_audits_created_at_idx ON generation_audits(created_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS generation_audits_user_id_idx ON generation_audits(user_id)");
  ensureColumn(sqlite, "app_settings", "generation_credit_cost", `generation_credit_cost INTEGER NOT NULL DEFAULT ${DEFAULT_GENERATION_CREDIT_COST}`);
  ensureColumn(sqlite, "app_settings", "checkin_credit", `checkin_credit INTEGER NOT NULL DEFAULT ${DEFAULT_CHECKIN_CREDIT}`);
  ensureColumn(sqlite, "app_settings", "max_images_per_request", `max_images_per_request INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_IMAGES_PER_REQUEST}`);
  ensureColumn(sqlite, "credit_transactions", "related_redemption_code_id", "related_redemption_code_id TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions(user_id)");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_generation_reason_idx ON credit_transactions(related_generation_id, reason)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS user_checkins_user_id_idx ON user_checkins(user_id)");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS redemption_codes_code_idx ON redemption_codes(code)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS redemption_codes_status_idx ON redemption_codes(status)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS redemption_codes_redeemed_by_user_id_idx ON redemption_codes(redeemed_by_user_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS redemption_codes_created_at_idx ON redemption_codes(created_at)");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS credit_redemptions_code_id_idx ON credit_redemptions(code_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS credit_redemptions_user_id_idx ON credit_redemptions(user_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS credit_redemptions_transaction_id_idx ON credit_redemptions(transaction_id)");
  ensureColumn(sqlite, "agent_conversations", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "prompt_favorite_groups", "user_id", "user_id TEXT");
  ensureColumn(sqlite, "prompt_favorites", "user_id", "user_id TEXT");
  sqlite.exec("DROP INDEX IF EXISTS prompt_favorites_source_idx");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS prompt_favorites_user_source_idx ON prompt_favorites(user_id, source_type, source_id)");
  ensureColumn(sqlite, "codex_oauth_tokens", "access_token", "access_token TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "refresh_token", "refresh_token TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "id_token", "id_token TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "email", "email TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "account_id", "account_id TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "expires_at", "expires_at TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "refreshed_at", "refreshed_at TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "unavailable_at", "unavailable_at TEXT");
  ensureColumn(sqlite, "codex_oauth_tokens", "unavailable_reason", "unavailable_reason TEXT");
  ensureColumn(
    sqlite,
    "provider_configs",
    "source_order_json",
    "source_order_json TEXT NOT NULL DEFAULT '[\"env-openai\",\"local-openai\",\"codex\"]'"
  );
  ensureColumn(sqlite, "provider_configs", "local_api_key", "local_api_key TEXT");
  ensureColumn(sqlite, "provider_configs", "local_base_url", "local_base_url TEXT");
  ensureColumn(sqlite, "provider_configs", "local_model", "local_model TEXT");
  ensureColumn(sqlite, "provider_configs", "local_timeout_ms", "local_timeout_ms INTEGER");
  ensureColumn(sqlite, "agent_llm_configs", "api_key", "api_key TEXT");
  ensureColumn(sqlite, "agent_llm_configs", "base_url", "base_url TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "agent_llm_configs", "model", "model TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "agent_llm_configs", "timeout_ms", "timeout_ms INTEGER NOT NULL DEFAULT 60000");
  ensureColumn(sqlite, "agent_llm_configs", "supports_vision", "supports_vision INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "agent_skills", "slug", "slug TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "agent_skills", "name", "name TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "agent_skills", "description", "description TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "agent_skills", "version", "version TEXT");
  ensureColumn(sqlite, "agent_skills", "source", "source TEXT");
  ensureColumn(sqlite, "agent_skills", "enabled", "enabled INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "agent_skills", "built_in", "built_in INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "agent_skills", "is_required", "is_required INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "agent_skills", "trigger_mode", "trigger_mode TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn(sqlite, "agent_skills", "trigger_keywords_json", "trigger_keywords_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(sqlite, "agent_skills", "files_json", "files_json TEXT NOT NULL DEFAULT '{}'");

  backfillGenerationReferenceAssets(sqlite);
  ensureProviderConfigRow(sqlite);
  ensureAgentLlmConfigRow(sqlite);
  ensureAppSettingsRow(sqlite);
  ensurePromptFavoriteDefaultGroup(sqlite);
}

function ensureColumn(sqlite: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function backfillGenerationReferenceAssets(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT OR IGNORE INTO generation_reference_assets (generation_id, asset_id, position, created_at)
    SELECT generation_records.id, generation_records.reference_asset_id, 0, generation_records.created_at
    FROM generation_records
    WHERE generation_records.reference_asset_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM assets
        WHERE assets.id = generation_records.reference_asset_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM generation_reference_assets
        WHERE generation_reference_assets.generation_id = generation_records.id
      )
  `);
}

function ensureProviderConfigRow(sqlite: Database.Database): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO provider_configs (id, source_order_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run("active", JSON.stringify(["env-openai", "local-openai", "codex"]), now, now);
}

function ensureAgentLlmConfigRow(sqlite: Database.Database): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO agent_llm_configs
        (id, api_key, base_url, model, timeout_ms, supports_vision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("active", null, "", "", 60000, 0, now, now);
}

function ensureAppSettingsRow(sqlite: Database.Database): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO app_settings
        (id, allow_registration, require_approval, default_credits, generation_credit_cost, checkin_credit, max_images_per_request, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "default",
      1,
      0,
      DEFAULT_REGISTRATION_CREDITS,
      DEFAULT_GENERATION_CREDIT_COST,
      DEFAULT_CHECKIN_CREDIT,
      DEFAULT_MAX_IMAGES_PER_REQUEST,
      now,
      now
    );
}

function ensurePromptFavoriteDefaultGroup(sqlite: Database.Database): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO prompt_favorite_groups (id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run("default", "常用", 0, now, now);
}
