import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `generation-queue-observability-inline-smoke-${process.pid}-${Date.now()}`);

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "inline";

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  const [{ readAdminGenerationQueueStatus }, { closeDatabase }, { closeRedisClient }] = await Promise.all([
    import("../domain/generation/generation-queue-observability.js"),
    import("../infrastructure/database.js"),
    import("../infrastructure/redis-runtime.js")
  ]);

  try {
    const status = await readAdminGenerationQueueStatus();
    expect(status.redis.status === "disabled", "inline observability reports Redis disabled");
    expect(status.queue.driver === "inline", "inline observability reports inline queue driver");
    expect(status.queue.readyLength === undefined, "inline observability does not read Redis ready length");
    expect(status.provider.activePermits === 0, "inline observability exposes inline active permits");
    expect(status.retry.maxAttempts === status.retry.maxRetries + 1, "retry attempts derive from max retries");
    console.log("generation queue observability inline smoke checks passed");
  } finally {
    await closeRedisClient();
    await closeDatabase();
    rmSync(dataDir, { force: true, recursive: true });
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
