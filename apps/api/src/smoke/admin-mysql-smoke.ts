import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import mysql from "mysql2/promise";

if (process.env.SMOKE_MYSQL_ADMIN !== "1") {
  throw new Error("Set SMOKE_MYSQL_ADMIN=1 to run the MySQL admin smoke.");
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
loadDotEnv({ path: resolve(repoRoot, ".env"), quiet: true });

const dataDir = resolve(repoRoot, ".codex-temp", `admin-mysql-smoke-${process.pid}-${Date.now()}`);
const databaseName = process.env.MYSQL_DATABASE?.trim() || `gic_admin_smoke_${process.pid}_${Date.now()}`;

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "true";
process.env.MYSQL_HOST = process.env.MYSQL_HOST?.trim() || "127.0.0.1";
process.env.MYSQL_PORT = process.env.MYSQL_PORT?.trim() || "3306";
process.env.MYSQL_USER = process.env.MYSQL_USER?.trim() || "root";
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? "";
process.env.MYSQL_DATABASE = databaseName;
process.env.MYSQL_CREATE_DATABASE = process.env.MYSQL_CREATE_DATABASE?.trim() || "true";
process.env.GENERATION_QUEUE_DRIVER = "inline";
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim() || "admin@example.local";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-local-admin";
process.env.ADMIN_NAME = process.env.ADMIN_NAME?.trim() || "Local Admin";

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  const [
    { closeDatabase, getMySqlPool },
    { initializeAuthFoundation },
    adminStore,
    { readAdminGenerationQueueStatus },
    redemptionStore
  ] = await Promise.all([
    import("../infrastructure/database.js"),
    import("../domain/auth/auth-store.js"),
    import("../domain/admin/admin-store.js"),
    import("../domain/generation/generation-queue-observability.js"),
    import("../domain/redemption-codes/redemption-code-store.js")
  ]);

  try {
    await initializeAuthFoundation();

    const users = await adminStore.listAdminUsers({ limit: 100 });
    expect(users.users.some((user) => user.role === "admin"), "admin user list includes bootstrap admin");

    const settings = await adminStore.readAdminSettings();
    expect(Array.isArray(settings.settings.allowedRegistrationEmailDomains), "admin settings returns registration domains");

    const audits = await adminStore.listGenerationAudits({ limit: 200 });
    expect(Array.isArray(audits.items), "generation audit list returns items");

    const queueStatus = await readAdminGenerationQueueStatus();
    expect(queueStatus.queue.driver === "inline", "queue status honors inline driver");

    const redemptionCodes = await redemptionStore.listAdminRedemptionCodes({ limit: 200 });
    expect(Array.isArray(redemptionCodes.items), "redemption code admin list returns items");

    const adminUser = users.users.find((user) => user.role === "admin");
    expect(adminUser, "admin user exists before credit transaction check");
    const transactions = await import("../domain/credits/credit-store.js").then((credits) =>
      credits.listCreditTransactionsForUser(adminUser.id, { limit: 50 })
    );
    expect(Array.isArray(transactions.items), "credit transaction list returns items");

    console.log("admin MySQL smoke checks passed");
  } finally {
    await closeDatabase();
    if (process.env.SMOKE_MYSQL_DROP_DATABASE === "1") {
      await dropDatabase(databaseName);
    }
    rmSync(dataDir, { force: true, recursive: true });
  }
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
