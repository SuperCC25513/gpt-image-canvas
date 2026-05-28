import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CurrentUser } from "../domain/contracts.js";
import type { ImageProviderInput } from "../infrastructure/providers/image-provider.js";
import { users } from "../infrastructure/schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `generation-queue-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER ??= "redis";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.GENERATION_QUEUE_WORKER_CONCURRENCY ??= "1";
process.env.GENERATION_QUEUE_POLL_INTERVAL_MS ??= "10";

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  const [{ closeRedisClient, getRedisClient }, { closeDatabase, db }, generationQueue, generationTasks] = await Promise.all([
    import("../infrastructure/redis-runtime.js"),
    import("../infrastructure/database.js"),
    import("../domain/generation/generation-queue.js"),
    import("../domain/generation/generation-tasks.js")
  ]);
  const {
    enqueueGenerationJob,
    getGenerationQueueConfig,
    readGenerationQueueConfig,
    removeGenerationJob,
    startGenerationQueueWorker,
    stopGenerationQueueWorker
  } = generationQueue;

  const client = await getRedisClient();
  const generationIds = ["smoke-queue-a", "smoke-queue-b", "smoke-queue-c"];
  const smokeUser = userFixture();

  try {
    await cleanupQueue(client, [...generationIds, "smoke-manual", "smoke-remove"]);

    const defaults = readGenerationQueueConfig({});
    expect(defaults.workerConcurrency === 2, "default queue worker concurrency is 2");
    expect(defaults.pollIntervalMs === 250, "default queue poll interval is 250ms");

    const parsed = readGenerationQueueConfig({
      GENERATION_QUEUE_WORKER_CONCURRENCY: "3",
      GENERATION_QUEUE_POLL_INTERVAL_MS: "50"
    });
    expect(parsed.workerConcurrency === 3, "configured queue worker concurrency is accepted");
    expect(parsed.pollIntervalMs === 50, "configured queue poll interval is accepted");

    const invalid = readGenerationQueueConfig({
      GENERATION_QUEUE_WORKER_CONCURRENCY: "0",
      GENERATION_QUEUE_POLL_INTERVAL_MS: "bad-value"
    });
    expect(invalid.workerConcurrency === 2, "invalid queue worker concurrency falls back to default");
    expect(invalid.pollIntervalMs === 250, "invalid queue poll interval falls back to default");

    expect(getGenerationQueueConfig().workerConcurrency === 1, "runtime queue config honors smoke concurrency env");

    const processed: string[] = [];
    let active = 0;
    let maxActive = 0;
    startGenerationQueueWorker(async (job) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      processed.push(job.generationId);
      active -= 1;
    });

    for (const generationId of generationIds) {
      await enqueueGenerationJob({
        jobId: `job-${generationId}`,
        generationId,
        userId: "smoke-user",
        mode: "generate",
        isPublic: false,
        attempt: 1,
        maxAttempts: 1,
        enqueuedAt: new Date().toISOString()
      });
    }

    await waitUntil(() => processed.length === generationIds.length);
    await stopGenerationQueueWorker();

    expect(maxActive === 1, "queue worker does not exceed configured concurrency");
    expect(generationIds.every((generationId) => processed.includes(generationId)), "queue worker processes all jobs");
    expect((await client.lLen("generation:queue:ready")) === 0, "queue ready list is empty after processing");
    for (const generationId of generationIds) {
      expect((await client.exists(`generation:job:${generationId}`)) === 0, "processed queue job key is cleaned");
    }

    await enqueueGenerationJob({
      jobId: "job-smoke-remove",
      generationId: "smoke-remove",
      userId: "smoke-user",
      mode: "edit",
      isPublic: true,
      attempt: 1,
      maxAttempts: 1,
      enqueuedAt: new Date().toISOString()
    });
    await removeGenerationJob("smoke-remove");
    expect((await client.exists("generation:job:smoke-remove")) === 0, "removeGenerationJob deletes job key");

    seedUser(db, smokeUser);
    const manualRecord = await generationTasks.startTextToImageGenerationTask(
      imageProviderInputFixture({ clientRequestId: "smoke-manual" }),
      smokeUser
    );
    expect(manualRecord.status === "pending", "manual Redis generation starts as pending");
    expect(manualRecord.outputs.length === 0, "manual Redis generation returns before provider output");
    const manualJobRaw = await client.get("generation:job:smoke-manual");
    expect(manualJobRaw, "manual Redis generation writes a job payload");
    expect(!manualJobRaw.includes("Create a queued fixture image."), "manual Redis job payload does not include prompt text");
    const manualJob = JSON.parse(manualJobRaw);
    expect(manualJob.generationId === "smoke-manual", "manual Redis job references generation id");
    expect(manualJob.userId === smokeUser.id, "manual Redis job references user id");
    expect(manualJob.mode === "generate", "manual Redis job stores mode");
    expect(manualJob.isPublic === false, "manual Redis job stores visibility flag");
    const cancelled = await generationTasks.cancelGenerationTask(manualRecord.id, smokeUser);
    expect(cancelled?.status === "cancelled", "manual pending Redis generation can be cancelled");
    expect((await client.exists("generation:job:smoke-manual")) === 0, "cancelled pending Redis generation removes job key");
    expect((await client.lLen("generation:queue:ready")) === 0, "cancelled pending Redis generation is removed from ready list");

    console.log("generation queue smoke checks passed");
  } finally {
    await stopGenerationQueueWorker();
    await cleanupQueue(client, [...generationIds, "smoke-manual", "smoke-remove"]);
    await closeRedisClient();
    await closeDatabase();
    rmSync(dataDir, { force: true, recursive: true });
  }
}

async function cleanupQueue(
  client: Awaited<ReturnType<typeof import("../infrastructure/redis-runtime.js").getRedisClient>>,
  generationIds: string[]
): Promise<void> {
  await client.del("generation:queue:ready");
  for (const generationId of generationIds) {
    await client.del(`generation:job:${generationId}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageProviderInputFixture(overrides: Partial<ImageProviderInput> = {}): ImageProviderInput {
  return {
    originalPrompt: "Create a queued fixture image.",
    presetId: "none",
    prompt: "Create a queued fixture image.",
    size: {
      width: 1024,
      height: 1024
    },
    sizeApiValue: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    count: 1,
    ...overrides
  };
}

function userFixture(): CurrentUser {
  return {
    id: "user-generation-queue-smoke",
    name: "Generation Queue Smoke",
    email: "generation-queue-smoke@example.local",
    role: "user",
    status: "active",
    credits: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function seedUser(db: typeof import("../infrastructure/database.js").db, user: CurrentUser): void {
  db.insert(users)
    .values({
      id: user.id,
      name: user.name,
      email: user.email,
      passwordSalt: "smoke",
      passwordIterations: 1,
      passwordHash: "smoke",
      role: user.role,
      status: user.status,
      credits: user.credits,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    })
    .run();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for smoke condition.");
    }
    await delay(5);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
