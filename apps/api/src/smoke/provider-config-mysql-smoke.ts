import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

if (process.env.SMOKE_MYSQL_PROVIDER_CONFIG !== "1") {
  throw new Error("Set SMOKE_MYSQL_PROVIDER_CONFIG=1 to run the MySQL provider config smoke.");
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `provider-config-mysql-smoke-${process.pid}-${Date.now()}`);
const databaseName = process.env.MYSQL_DATABASE?.trim() || `gic_provider_config_smoke_${process.pid}_${Date.now()}`;

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "true";
process.env.MYSQL_HOST = process.env.MYSQL_HOST?.trim() || "127.0.0.1";
process.env.MYSQL_PORT = process.env.MYSQL_PORT?.trim() || "3306";
process.env.MYSQL_USER = process.env.MYSQL_USER?.trim() || "root";
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? "";
process.env.MYSQL_DATABASE = databaseName;
process.env.MYSQL_CREATE_DATABASE = process.env.MYSQL_CREATE_DATABASE?.trim() || "true";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_BASE_URL;

mkdirSync(dataDir, { recursive: true });

interface CountRow extends RowDataPacket {
  count: number;
}

async function main(): Promise<void> {
  const [{ closeDatabase, getMySqlPool }, providerConfig, agentConfig, codexAuth] = await Promise.all([
    import("../infrastructure/database.js"),
    import("../domain/providers/provider-config.js"),
    import("../domain/agent/config.js"),
    import("../domain/providers/codex-auth.js")
  ]);
  const pool = getMySqlPool();

  try {
    await expectCount(pool, "provider_configs", 1, "provider default active row exists");
    await expectCount(pool, "agent_llm_configs", 1, "agent default active row exists");

    const initialProvider = await providerConfig.getProviderConfig();
    expect(initialProvider.sourceOrder.join(",") === "env-openai,local-openai,codex", "provider source order defaults");
    expect(!initialProvider.localOpenAI.apiKey.hasSecret, "provider local key starts empty");

    const savedProvider = await providerConfig.saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      localOpenAI: {
        apiKey: "sk-mysql-provider-secret",
        baseUrl: "https://provider.example/v1",
        model: "gpt-image-2",
        timeoutMs: 120000
      }
    });
    expect(savedProvider.localOpenAI.apiKey.hasSecret, "saved provider key is present");
    expect(savedProvider.localOpenAI.apiKey.value !== "sk-mysql-provider-secret", "provider key is masked");
    expect(savedProvider.activeSource?.id === "local-openai", "local provider becomes active");
    expect((await providerConfig.getLocalOpenAIImageProviderConfig())?.apiKey === "sk-mysql-provider-secret", "runtime provider reads raw key");

    await providerConfig.saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      localOpenAI: {
        apiKey: savedProvider.localOpenAI.apiKey.value,
        baseUrl: "https://provider.example/v1",
        model: "gpt-image-2",
        timeoutMs: 90000
      }
    });
    expect((await providerConfig.getLocalOpenAIImageProviderConfig())?.apiKey === "sk-mysql-provider-secret", "masked provider key preserves raw key");

    await pool.execute("UPDATE provider_configs SET source_order_json = ? WHERE id = ?", ["not-json", "active"]);
    expect((await providerConfig.getProviderSourceOrder()).join(",") === "env-openai,local-openai,codex", "bad provider source JSON falls back");

    const initialAgent = await agentConfig.getAgentLlmConfig();
    expect(!initialAgent.configured, "agent config starts unconfigured");

    const savedAgent = await agentConfig.saveAgentLlmConfig({
      apiKey: "sk-mysql-agent-secret",
      baseUrl: "https://agent.example/v1",
      model: "gpt-5",
      timeoutMs: 60000,
      supportsVision: true
    });
    expect(savedAgent.configured, "saved agent config is configured");
    expect(savedAgent.apiKey.value !== "sk-mysql-agent-secret", "agent key is masked");
    expect((await agentConfig.getUsableAgentLlmConfig())?.apiKey === "sk-mysql-agent-secret", "runtime agent config reads raw key");

    await agentConfig.saveAgentLlmConfig({
      apiKey: savedAgent.apiKey.value,
      preserveApiKey: true,
      baseUrl: "https://agent.example/v1",
      model: "gpt-5",
      timeoutMs: 45000,
      supportsVision: false
    });
    const preservedAgent = await agentConfig.getUsableAgentLlmConfig();
    expect(preservedAgent?.apiKey === "sk-mysql-agent-secret", "masked agent key preserves raw key");
    expect(preservedAgent?.timeoutMs === 45000, "agent non-secret fields update");

    const now = new Date().toISOString();
    await pool.execute(
      `INSERT INTO codex_oauth_tokens
        (id, access_token, refresh_token, id_token, email, account_id, expires_at, refreshed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "default",
        "codex-access-token",
        "codex-refresh-token",
        "codex-id-token",
        "codex@example.com",
        "account-1",
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        now,
        now,
        now
      ]
    );
    const codexSource = (await providerConfig.getProviderConfig()).sources.find((source) => source.id === "codex");
    expect(codexSource?.available, "provider config sees codex token");

    const logout = await codexAuth.logoutCodex();
    expect(logout.ok, "codex logout succeeds");
    const loggedOutCodex = (await providerConfig.getProviderConfig()).sources.find((source) => source.id === "codex");
    expect(loggedOutCodex?.available === false, "codex logout clears availability");

    console.log("provider config MySQL smoke checks passed");
  } finally {
    await closeDatabase();
    if (process.env.SMOKE_MYSQL_DROP_DATABASE === "1") {
      await dropDatabase(databaseName);
    }
    rmSync(dataDir, { force: true, recursive: true });
  }
}

async function expectCount(pool: Pool, tableName: string, expected: number, message: string): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/u.test(tableName)) {
    throw new Error("Invalid smoke table name.");
  }
  const [rows] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`);
  expect(rows[0]?.count === expected, message);
}

async function dropDatabase(name: string): Promise<void> {
  if (!/^[A-Za-z0-9_$]+$/u.test(name)) {
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number.parseInt(process.env.MYSQL_PORT ?? "3306", 10),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
  } finally {
    await connection.end();
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
