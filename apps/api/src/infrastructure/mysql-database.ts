import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { ensureRuntimeStorage } from "./runtime.js";
import type { MySqlDatabaseConfig } from "./database-config.js";

export interface MySqlDatabaseContext {
  driver: "mysql";
  pool: Pool;
  close: () => Promise<void>;
}

const tableOptions = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function createMySqlDatabase(config: MySqlDatabaseConfig): Promise<MySqlDatabaseContext> {
  ensureRuntimeStorage();

  if (config.createDatabase) {
    await ensureDatabase(config);
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    multipleStatements: false
  });

  await migrateMySql(pool);

  return {
    driver: "mysql",
    pool,
    close: () => pool.end()
  };
}

async function ensureDatabase(config: MySqlDatabaseConfig): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: "utf8mb4",
    multipleStatements: false
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(config.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_$]+$/u.test(value)) {
    throw new Error("MYSQL_DATABASE may only contain letters, numbers, underscores, and dollar signs.");
  }

  return `\`${value}\``;
}

async function migrateMySql(pool: Pool): Promise<void> {
  for (const statement of schemaStatements()) {
    await pool.query(statement);
  }

  await ensureOwnerColumns(pool);
  await backfillGenerationReferenceAssets(pool);
  await ensureProviderConfigRow(pool);
  await ensureAgentLlmConfigRow(pool);
  await ensureAppSettingsRow(pool);
  await ensurePromptFavoriteDefaultGroup(pool);
}

function schemaStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email VARCHAR(254) NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INT NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL,
      credits INT NOT NULL DEFAULT 0,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      UNIQUE KEY users_email_idx (email)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      expires_at VARCHAR(32) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      last_seen_at VARCHAR(32),
      KEY sessions_user_id_idx (user_id),
      KEY sessions_expires_at_idx (expires_at)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      allow_registration TINYINT NOT NULL DEFAULT 1,
      require_approval TINYINT NOT NULL DEFAULT 0,
      default_credits INT NOT NULL DEFAULT 0,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      name TEXT NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      KEY projects_user_id_idx (user_id)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS assets (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type VARCHAR(191) NOT NULL,
      width INT NOT NULL,
      height INT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      KEY assets_user_id_idx (user_id)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS provider_configs (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      source_order_json TEXT NOT NULL,
      local_api_key TEXT,
      local_base_url TEXT,
      local_model TEXT,
      local_timeout_ms INT,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS agent_llm_configs (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      api_key TEXT,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      timeout_ms INT NOT NULL,
      supports_vision TINYINT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS agent_conversations (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      title TEXT NOT NULL,
      messages_json LONGTEXT NOT NULL,
      context_json LONGTEXT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      KEY agent_conversations_user_id_idx (user_id),
      KEY agent_conversations_updated_at_idx (updated_at)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS agent_skills (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      slug VARCHAR(191) NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      version TEXT,
      source TEXT,
      enabled TINYINT NOT NULL,
      built_in TINYINT NOT NULL,
      is_required TINYINT NOT NULL,
      trigger_mode VARCHAR(32) NOT NULL,
      trigger_keywords_json TEXT NOT NULL,
      files_json LONGTEXT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      UNIQUE KEY agent_skills_slug_idx (slug)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS prompt_favorite_groups (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      name TEXT NOT NULL,
      sort_order INT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      KEY prompt_favorite_groups_user_id_idx (user_id)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS prompt_favorites (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      source_type VARCHAR(64) NOT NULL,
      source_id VARCHAR(191) NOT NULL,
      group_id VARCHAR(191) NOT NULL,
      title TEXT NOT NULL,
      prompt LONGTEXT NOT NULL,
      model TEXT NOT NULL,
      media_type VARCHAR(32) NOT NULL,
      asset_url TEXT NOT NULL,
      image_width INT,
      image_height INT,
      source_url TEXT,
      use_count INT NOT NULL DEFAULT 0,
      last_used_at VARCHAR(32),
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      KEY prompt_favorites_user_id_idx (user_id),
      UNIQUE KEY prompt_favorites_user_source_idx (user_id, source_type, source_id),
      KEY prompt_favorites_group_id_idx (group_id),
      KEY prompt_favorites_last_used_at_idx (last_used_at),
      CONSTRAINT prompt_favorites_group_fk FOREIGN KEY (group_id) REFERENCES prompt_favorite_groups(id)
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS codex_oauth_tokens (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      email TEXT,
      account_id TEXT,
      expires_at VARCHAR(32),
      refreshed_at VARCHAR(32),
      unavailable_at VARCHAR(32),
      unavailable_reason TEXT,
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS generation_records (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      mode VARCHAR(32) NOT NULL,
      prompt LONGTEXT NOT NULL,
      effective_prompt LONGTEXT NOT NULL,
      preset_id VARCHAR(191) NOT NULL,
      width INT NOT NULL,
      height INT NOT NULL,
      quality VARCHAR(32) NOT NULL,
      output_format VARCHAR(32) NOT NULL,
      count INT NOT NULL,
      status VARCHAR(32) NOT NULL,
      error TEXT,
      reference_asset_id VARCHAR(191),
      created_at VARCHAR(32) NOT NULL,
      KEY generation_records_user_id_idx (user_id),
      KEY generation_records_created_at_idx (created_at),
      KEY generation_records_reference_asset_idx (reference_asset_id),
      CONSTRAINT generation_records_reference_asset_fk FOREIGN KEY (reference_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS generation_outputs (
      id VARCHAR(191) PRIMARY KEY NOT NULL,
      user_id VARCHAR(191),
      generation_id VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL,
      asset_id VARCHAR(191),
      error TEXT,
      created_at VARCHAR(32) NOT NULL,
      KEY generation_outputs_user_id_idx (user_id),
      KEY generation_outputs_generation_id_idx (generation_id),
      KEY generation_outputs_asset_id_idx (asset_id),
      CONSTRAINT generation_outputs_generation_fk FOREIGN KEY (generation_id) REFERENCES generation_records(id) ON DELETE CASCADE,
      CONSTRAINT generation_outputs_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
    ) ${tableOptions}`,
    `CREATE TABLE IF NOT EXISTS generation_reference_assets (
      generation_id VARCHAR(191) NOT NULL,
      asset_id VARCHAR(191) NOT NULL,
      position INT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      PRIMARY KEY (generation_id, position),
      KEY generation_reference_assets_generation_id_idx (generation_id),
      KEY generation_reference_assets_asset_id_idx (asset_id),
      CONSTRAINT generation_reference_assets_generation_fk FOREIGN KEY (generation_id) REFERENCES generation_records(id) ON DELETE CASCADE,
      CONSTRAINT generation_reference_assets_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)
    ) ${tableOptions}`
  ];
}

async function ensureOwnerColumns(pool: Pool): Promise<void> {
  await ensureMySqlColumn(pool, "projects", "user_id", "VARCHAR(191)");
  await ensureMySqlColumn(pool, "assets", "user_id", "VARCHAR(191)");
  await ensureMySqlColumn(pool, "generation_records", "user_id", "VARCHAR(191)");
  await ensureMySqlColumn(pool, "generation_outputs", "user_id", "VARCHAR(191)");
  await ensureMySqlColumn(pool, "agent_conversations", "user_id", "VARCHAR(191)");
  await ensureMySqlColumn(pool, "prompt_favorite_groups", "user_id", "VARCHAR(191)");
  await ensureMySqlColumn(pool, "prompt_favorites", "user_id", "VARCHAR(191)");
  await ensureMySqlIndex(pool, "projects", "projects_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "assets", "assets_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "generation_records", "generation_records_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "generation_outputs", "generation_outputs_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "agent_conversations", "agent_conversations_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "prompt_favorite_groups", "prompt_favorite_groups_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "prompt_favorites", "prompt_favorites_user_id_idx", "user_id");
  await ensurePromptFavoritesUserSourceIndex(pool);
}

async function ensureMySqlColumn(pool: Pool, tableName: string, columnName: string, definition: string): Promise<void> {
  const [rows] = await pool.execute<Array<{ columnName: string } & RowDataPacket>>(
    `SELECT COLUMN_NAME AS columnName
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  if (rows.length > 0) {
    return;
  }

  await pool.query(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`);
}

async function ensureMySqlIndex(pool: Pool, tableName: string, indexName: string, columnName: string): Promise<void> {
  const [rows] = await pool.execute<Array<{ indexName: string } & RowDataPacket>>(
    `SELECT INDEX_NAME AS indexName
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  if (rows.length > 0) {
    return;
  }

  await pool.query(`CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${quoteIdentifier(columnName)})`);
}

async function ensurePromptFavoritesUserSourceIndex(pool: Pool): Promise<void> {
  if (await mySqlIndexExists(pool, "prompt_favorites", "prompt_favorites_source_idx")) {
    await pool.query(
      `ALTER TABLE ${quoteIdentifier("prompt_favorites")}
       DROP INDEX ${quoteIdentifier("prompt_favorites_source_idx")}`
    );
  }

  if (await mySqlIndexExists(pool, "prompt_favorites", "prompt_favorites_user_source_idx")) {
    return;
  }

  await pool.query(
    `CREATE UNIQUE INDEX ${quoteIdentifier("prompt_favorites_user_source_idx")}
     ON ${quoteIdentifier("prompt_favorites")}
       (${quoteIdentifier("user_id")}, ${quoteIdentifier("source_type")}, ${quoteIdentifier("source_id")})`
  );
}

async function mySqlIndexExists(pool: Pool, tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.execute<Array<{ indexName: string } & RowDataPacket>>(
    `SELECT INDEX_NAME AS indexName
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function backfillGenerationReferenceAssets(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT IGNORE INTO generation_reference_assets (generation_id, asset_id, position, created_at)
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

async function ensureProviderConfigRow(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO provider_configs (id, source_order_json, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    ["active", JSON.stringify(["env-openai", "local-openai", "codex"]), now, now]
  );
}

async function ensureAgentLlmConfigRow(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO agent_llm_configs
      (id, api_key, base_url, model, timeout_ms, supports_vision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["active", null, "", "", 60000, 0, now, now]
  );
}

async function ensureAppSettingsRow(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO app_settings
      (id, allow_registration, require_approval, default_credits, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["default", 1, 0, 0, now, now]
  );
}

async function ensurePromptFavoriteDefaultGroup(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO prompt_favorite_groups (id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    ["default", "常用", 0, now, now]
  );
}
