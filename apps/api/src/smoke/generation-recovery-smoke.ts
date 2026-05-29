import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { CurrentUser } from "../domain/contracts.js";
import type { ImageProvider, ImageProviderInput, ProviderResult } from "../infrastructure/providers/image-provider.js";
import { creditTransactions, generationAudits, users } from "../infrastructure/schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `generation-recovery-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "redis";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.GENERATION_QUEUE_WORKER_CONCURRENCY = "1";
process.env.GENERATION_QUEUE_POLL_INTERVAL_MS = "10";

mkdirSync(dataDir, { recursive: true });

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function main(): Promise<void> {
  const [{ closeRedisClient, getRedisClient }, { closeDatabase, db }, generationTasks, imageGeneration, stateBridge] =
    await Promise.all([
      import("../infrastructure/redis-runtime.js"),
      import("../infrastructure/database.js"),
      import("../domain/generation/generation-tasks.js"),
      import("../domain/generation/image-generation.js"),
      import("../domain/generation/generation-state-bridge.js")
    ]);

  const client = await getRedisClient();
  const smokeUser = userFixture();
  const generationIds = ["recover-public", "recover-private", "recover-running", "recover-terminal-guard"];

  try {
    seedUser(db, smokeUser);
    await cleanupQueue(client, generationIds);

    const publicPending = await generationTasks.startTextToImageGenerationTask(
      imageProviderInputFixture({ clientRequestId: "recover-public", isPublic: true }),
      smokeUser
    );
    await cleanupQueue(client, ["recover-public"]);
    let recovery = await stateBridge.recoverGenerationQueueState();
    expect(recovery.recoveredPending === 1, "recovery reports restored pending generation");
    expect(recovery.failedRunning === 0, "recovery reports no running interruptions");
    expect((await imageGeneration.getGenerationRecord(publicPending.id, smokeUser))?.status === "pending", "pending record stays pending");
    let publicPayload = await readQueuedJobPayload(client, "recover-public");
    expect(publicPayload.isPublic === true, "pending recovery restores public visibility from audit");
    expect(publicPayload.mode === "generate", "pending recovery preserves generation mode");
    expect(!JSON.stringify(publicPayload).includes("Recovered queued image"), "pending recovery payload does not include prompt");
    expect((await readyOccurrences(client, "recover-public")) === 1, "pending recovery writes one ready entry");

    await client.rPush("generation:queue:ready", ["generation:job:recover-public", "generation:job:recover-public"]);
    recovery = await stateBridge.recoverGenerationQueueState();
    expect(recovery.recoveredPending === 1, "duplicate recovery still sees pending generation");
    expect((await readyOccurrences(client, "recover-public")) === 1, "pending recovery deduplicates ready entries");

    await generationTasks.startTextToImageGenerationTask(
      imageProviderInputFixture({ clientRequestId: "recover-private", isPublic: true }),
      smokeUser
    );
    db.delete(generationAudits).where(eq(generationAudits.generationId, "recover-private")).run();
    await cleanupQueue(client, ["recover-private"]);
    await stateBridge.recoverGenerationQueueState();
    const privatePayload = await readQueuedJobPayload(client, "recover-private");
    expect(privatePayload.isPublic === false, "pending recovery falls back to private when audit visibility is missing");

    const running = await generationTasks.startTextToImageGenerationTask(
      imageProviderInputFixture({ clientRequestId: "recover-running", count: 2 }),
      smokeUser
    );
    await imageGeneration.markGenerationRecordRunning(running.id, smokeUser);
    const creditsAfterRunningCharge = readUserCredits(db, smokeUser.id);
    recovery = await stateBridge.recoverGenerationQueueState();
    const interrupted = await imageGeneration.getGenerationRecord(running.id, smokeUser);
    expect(recovery.failedRunning === 1, "recovery reports failed running generation");
    expect(interrupted?.status === "failed", "running generation is failed on recovery");
    expect(countGenerationAudits(db, smokeUser.id, "failed") >= 1, "running recovery updates audit status");
    expect(readUserCredits(db, smokeUser.id) === creditsAfterRunningCharge + 2, "running recovery refunds failed outputs");
    expect(countCreditTransactions(db, smokeUser.id, "generation_refund") === 1, "running recovery writes one refund");
    expect((await client.exists("generation:job:recover-running")) === 0, "running recovery removes stale Redis job key");
    await stateBridge.recoverGenerationQueueState();
    expect(countCreditTransactions(db, smokeUser.id, "generation_refund") === 1, "repeated running recovery does not duplicate refund");
    expect(readUserCredits(db, smokeUser.id) === creditsAfterRunningCharge + 2, "repeated running recovery does not add credits again");

    const cancellable = await generationTasks.startTextToImageGenerationTask(
      imageProviderInputFixture({ clientRequestId: "recover-terminal-guard" }),
      smokeUser
    );
    await imageGeneration.markGenerationRecordRunning(cancellable.id, smokeUser);
    const cancelled = await generationTasks.cancelGenerationTask(cancellable.id, smokeUser);
    expect(cancelled?.status === "cancelled", "running generation cancellation is persisted");
    const refundsAfterCancel = countCreditTransactions(db, smokeUser.id, "generation_refund");
    const cancelledAgain = await generationTasks.cancelGenerationTask(cancellable.id, smokeUser);
    expect(cancelledAgain?.status === "cancelled", "repeated cancellation keeps cancelled status");
    expect(countCreditTransactions(db, smokeUser.id, "generation_refund") === refundsAfterCancel, "repeated cancellation does not duplicate refund");
    const lateFinish = await imageGeneration.finishTextToImageGeneration(
      cancellable.id,
      imageProviderInputFixture({ clientRequestId: cancellable.id }),
      new FakeImageProvider(),
      undefined,
      smokeUser
    );
    expect(lateFinish.status === "cancelled", "late finish cannot overwrite cancelled generation");
    expect(lateFinish.outputs.length === 0, "late finish does not persist outputs for cancelled generation");
    expect(countCreditTransactions(db, smokeUser.id, "generation_refund") === refundsAfterCancel, "late finish does not duplicate refund");

    console.log("generation recovery smoke checks passed");
  } finally {
    await generationTasks.shutdownGenerationTaskManager();
    await cleanupQueue(client, generationIds);
    await closeRedisClient();
    await closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function readQueuedJobPayload(
  client: Awaited<ReturnType<typeof import("../infrastructure/redis-runtime.js").getRedisClient>>,
  generationId: string
): Promise<Record<string, unknown>> {
  const raw = await client.get(`generation:job:${generationId}`);
  expect(raw, `queued job payload exists for ${generationId}`);
  const parsed = JSON.parse(raw) as unknown;
  expect(isRecord(parsed), `queued job payload for ${generationId} is an object`);
  return parsed;
}

async function readyOccurrences(
  client: Awaited<ReturnType<typeof import("../infrastructure/redis-runtime.js").getRedisClient>>,
  generationId: string
): Promise<number> {
  const values = await client.lRange("generation:queue:ready", 0, -1);
  return values.filter((value) => value === `generation:job:${generationId}`).length;
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

function imageProviderInputFixture(overrides: Partial<ImageProviderInput> = {}): ImageProviderInput {
  return {
    originalPrompt: "Recovered queued image.",
    presetId: "none",
    prompt: "Recovered queued image.",
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

class FakeImageProvider implements ImageProvider {
  async generate(input: ImageProviderInput): Promise<ProviderResult> {
    return {
      model: "fake-image-model",
      size: input.sizeApiValue,
      images: [
        {
          b64Json: tinyPngBase64
        }
      ]
    };
  }

  async edit(): Promise<ProviderResult> {
    throw new Error("edit is not used in this smoke");
  }
}

function userFixture(): CurrentUser {
  return {
    id: "user-generation-recovery-smoke",
    name: "Generation Recovery Smoke",
    email: "generation-recovery-smoke@example.local",
    role: "user",
    status: "active",
    credits: 20,
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

function readUserCredits(db: typeof import("../infrastructure/database.js").db, userId: string): number {
  const row = db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).get();
  return row?.credits ?? 0;
}

function countCreditTransactions(
  db: typeof import("../infrastructure/database.js").db,
  userId: string,
  reason?: "generation_charge" | "generation_refund"
): number {
  const rows = db
    .select({ id: creditTransactions.id, reason: creditTransactions.reason })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .all();
  return reason ? rows.filter((row) => row.reason === reason).length : rows.length;
}

function countGenerationAudits(
  db: typeof import("../infrastructure/database.js").db,
  userId: string,
  status: "succeeded" | "partial" | "failed" | "cancelled"
): number {
  return db
    .select({ id: generationAudits.id })
    .from(generationAudits)
    .where(and(eq(generationAudits.userId, userId), eq(generationAudits.status, status)))
    .all().length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
