import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentServerEvent, CurrentUser, GenerationPlan } from "../domain/contracts.js";
import { users } from "../infrastructure/schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `agent-generation-queue-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "redis";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.GENERATION_QUEUE_WORKER_CONCURRENCY = "1";
process.env.GENERATION_QUEUE_POLL_INTERVAL_MS = "10";

mkdirSync(dataDir, { recursive: true });

const smokeUser: CurrentUser = {
  id: "user-agent-generation-queue-smoke",
  name: "Agent Generation Queue Smoke",
  email: "agent-generation-queue-smoke@example.local",
  role: "user",
  status: "active",
  credits: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

async function main(): Promise<void> {
  const [{ executeGenerationPlan }, { closeDatabase, db }, generationQueue, imageGeneration, { closeRedisClient, getRedisClient }] =
    await Promise.all([
      import("../domain/agent/executor.js"),
      import("../infrastructure/database.js"),
      import("../domain/generation/generation-queue.js"),
      import("../domain/generation/image-generation.js"),
      import("../infrastructure/redis-runtime.js")
    ]);

  const client = await getRedisClient();
  try {
    seedUser(db, smokeUser);
    await cleanupQueue(client);

    const failedEvents: AgentServerEvent[] = [];
    const failedRun = executeGenerationPlan({
      plan: singleJobPlanFixture("plan-agent-queue-failed"),
      selectedReferences: [],
      mode: "execute",
      user: smokeUser,
      requestId: "smoke-agent-queue-failed",
      runId: "run-agent-queue-failed",
      signal: new AbortController().signal,
      isRunActive: () => true,
      sendEvent: (event) => failedEvents.push(event)
    });

    const queuedJobKey = await waitForQueuedJobKey(client);
    const queuedJobPayload = await readQueuedJobPayload(client, queuedJobKey);
    expect(queuedJobPayload.generationId, "queued Agent generation job has generation id");
    expect(queuedJobPayload.userId === smokeUser.id, "queued Agent generation job has user id");
    expect(queuedJobPayload.mode === "generate", "queued Agent generation job stores generation mode");
    expect(!JSON.stringify(queuedJobPayload).includes("Agent queued smoke image"), "queued Agent generation job does not store prompt");
    expect(
      failedEvents.some((event) => event.type === "plan_updated" && event.plan.jobs[0]?.status === "queued"),
      "Agent emits queued plan state before worker starts"
    );

    generationQueue.startGenerationQueueWorker(async (job) => {
      await imageGeneration.markGenerationRecordRunning(job.generationId, smokeUser);
      await delay(30);
      await imageGeneration.failGenerationRecord(job.generationId, "smoke worker failed", smokeUser);
    });

    const failedResult = await failedRun;
    expect(failedResult.status === "failed", "Agent Redis queue terminal failed record fails the plan");
    expect(failedResult.plan.jobs[0]?.status === "failed", "Agent Redis queue terminal failed record fails the job");
    expect(failedEvents.some((event) => event.type === "job_started"), "Agent emits job_started after queued generation runs");
    expect(failedEvents.some((event) => event.type === "job_failed"), "Agent emits job_failed for terminal failed record");
    await generationQueue.stopGenerationQueueWorker();
    expect((await client.exists(queuedJobKey)) === 0, "worker cleans processed Agent queue job key");

    await cleanupQueue(client);
    const cancelController = new AbortController();
    let cancelRunActive = true;
    const cancelledEvents: AgentServerEvent[] = [];
    const cancelledRun = executeGenerationPlan({
      plan: singleJobPlanFixture("plan-agent-queue-cancelled"),
      selectedReferences: [],
      mode: "execute",
      user: smokeUser,
      requestId: "smoke-agent-queue-cancelled",
      runId: "run-agent-queue-cancelled",
      signal: cancelController.signal,
      isRunActive: () => cancelRunActive,
      sendEvent: (event) => cancelledEvents.push(event)
    });

    const cancellableJobKey = await waitForQueuedJobKey(client);
    const cancellableJobPayload = await readQueuedJobPayload(client, cancellableJobKey);
    const cancellableGenerationId = cancellableJobPayload.generationId;
    expect(typeof cancellableGenerationId === "string", "cancellable Agent generation job has generation id");
    cancelRunActive = false;
    cancelController.abort();
    const cancelledResult = await cancelledRun;
    expect(cancelledResult.status === "cancelled", "Agent Redis queue pending cancellation cancels the plan");
    expect((await client.exists(cancellableJobKey)) === 0, "cancelled Agent pending generation removes Redis job key");
    expect((await client.lLen("generation:queue:ready")) === 0, "cancelled Agent pending generation is removed from ready list");
    const cancelledRecord = await imageGeneration.getGenerationRecord(cancellableGenerationId, smokeUser);
    expect(cancelledRecord?.status === "cancelled", "cancelled Agent pending generation marks DB record cancelled");
    expect(cancelledEvents.some((event) => event.type === "plan_updated"), "cancelled Agent run emitted plan updates");

    console.log("agent generation queue smoke checks passed");
  } finally {
    await generationQueue.stopGenerationQueueWorker();
    await cleanupQueue(client);
    await closeRedisClient();
    closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function waitForQueuedJobKey(
  client: Awaited<ReturnType<typeof import("../infrastructure/redis-runtime.js").getRedisClient>>
): Promise<string> {
  const deadline = Date.now() + 1000;
  while (Date.now() <= deadline) {
    const values = await client.lRange("generation:queue:ready", 0, -1);
    const jobKey = values.find((value) => value.startsWith("generation:job:"));
    if (jobKey) {
      return jobKey;
    }
    await delay(5);
  }
  throw new Error("Timed out waiting for queued Agent generation job.");
}

async function readQueuedJobPayload(
  client: Awaited<ReturnType<typeof import("../infrastructure/redis-runtime.js").getRedisClient>>,
  jobKey: string
): Promise<Record<string, unknown>> {
  const raw = await client.get(jobKey);
  expect(raw, "queued Agent generation job payload exists");
  const parsed = JSON.parse(raw) as unknown;
  expect(isRecord(parsed), "queued Agent generation job payload is an object");
  return parsed;
}

async function cleanupQueue(
  client: Awaited<ReturnType<typeof import("../infrastructure/redis-runtime.js").getRedisClient>>
): Promise<void> {
  const queued = await client.lRange("generation:queue:ready", 0, -1);
  await client.del("generation:queue:ready");
  for (const jobKey of queued) {
    if (jobKey.startsWith("generation:job:")) {
      await client.del(jobKey);
    }
  }
}

function singleJobPlanFixture(id: string): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id,
    title: "Agent queue smoke",
    status: "confirmed",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      stylePresetId: "none"
    },
    jobs: [
      {
        id: "queued_image",
        role: "final_image",
        prompt: "Agent queued smoke image.",
        count: 1,
        references: [],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
