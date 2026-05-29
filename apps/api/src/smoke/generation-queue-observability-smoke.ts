import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { users, generationAudits, generationOutputs, generationRecords } from "../infrastructure/schema.js";
import type { SqliteDatabase } from "../infrastructure/sqlite-database.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `generation-queue-observability-smoke-${process.pid}-${Date.now()}`);
const adminEmail = "queue-admin@example.com";
const adminPassword = "password123";

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "redis";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.GENERATION_QUEUE_WORKER_CONCURRENCY = "1";
process.env.GENERATION_QUEUE_POLL_INTERVAL_MS = "10";
process.env.GENERATION_PROVIDER_GLOBAL_CONCURRENCY = "2";
process.env.ADMIN_EMAIL = adminEmail;
process.env.ADMIN_PASSWORD = adminPassword;
process.env.ADMIN_NAME = "Queue Smoke Admin";

mkdirSync(dataDir, { recursive: true });

interface RequestApp {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

interface JsonResult {
  response: Response;
  body: unknown;
}

async function main(): Promise<void> {
  const [{ app }, { closeDatabase, db }, { closeRedisClient, getRedisClient }, generationQueue, generationTasks, providerScheduler] =
    await Promise.all([
      import("../index.js"),
      import("../infrastructure/database.js"),
      import("../infrastructure/redis-runtime.js"),
      import("../domain/generation/generation-queue.js"),
      import("../domain/generation/generation-tasks.js"),
      import("../domain/generation/provider-scheduler.js")
    ]);
  const client = await getRedisClient();
  let unblockProviderCall: (() => void) | undefined;

  try {
    await generationTasks.shutdownGenerationTaskManager();
    await client.del(["generation:queue:ready", "generation:job:observability-ready", "generation:provider:permits"]);
    seedGenerationSummary(db);
    await generationQueue.enqueueGenerationJob({
      jobId: "job-observability-ready",
      generationId: "observability-ready",
      userId: "user-observability",
      mode: "generate",
      isPublic: false,
      attempt: 1,
      maxAttempts: 1,
      enqueuedAt: new Date().toISOString()
    });

    const providerCall = providerScheduler.runProviderCall({
      generationId: "observability-running",
      outputId: "observability-output-running",
      outputIndex: 0,
      mode: "generate",
      call: async () =>
        new Promise<string>((resolve) => {
          unblockProviderCall = () => resolve("ok");
        })
    });
    await waitUntil(async () => (await client.zCard("generation:provider:permits")) === 1);

    const unauthenticated = await requestJson(app, "/api/admin/generation-queue");
    expect(unauthenticated.response.status === 401, "unauthenticated queue status is rejected");

    const regularUser = await register(app, {
      name: "Queue Regular User",
      email: `queue-regular-${Date.now()}@qq.com`,
      password: "password123"
    });
    expect(regularUser.response.status === 201, "regular user can register");
    const regularLogin = await requestJson(app, "/api/auth/login", {
      body: {
        email: userEmail(regularUser.body),
        password: "password123"
      },
      method: "POST"
    });
    const regularCookie = sessionCookie(regularLogin.response);
    const forbidden = await requestJson(app, "/api/admin/generation-queue", { cookie: regularCookie });
    expect(forbidden.response.status === 403, "non-admin queue status is rejected");

    const adminLogin = await requestJson(app, "/api/auth/login", {
      body: {
        email: adminEmail,
        password: adminPassword
      },
      method: "POST"
    });
    const cookie = sessionCookie(adminLogin.response);
    expect(Boolean(cookie), "admin login returns session cookie");

    const queueStatus = await requestJson(app, "/api/admin/generation-queue", { cookie });
    expect(queueStatus.response.status === 200, "admin queue status returns 200");
    expect(queueField(queueStatus.body, "redis", "status") === "ok", "Redis status is ok");
    expect(queueField(queueStatus.body, "queue", "driver") === "redis", "queue driver is redis");
    expect(queueField(queueStatus.body, "queue", "readyLength") === 1, "ready queue length is exposed");
    expect(queueField(queueStatus.body, "provider", "activePermits") === 1, "active provider permits are exposed");
    expect(queueField(queueStatus.body, "provider", "availablePermits") === 1, "available provider permits are exposed");
    expect(queueField(queueStatus.body, "retry", "maxAttempts") === 3, "retry max attempts is exposed");
    expect(databaseCount(queueStatus.body, "pending") === 1, "pending count is exposed");
    expect(databaseCount(queueStatus.body, "running") === 1, "running count is exposed");
    expect(databaseCount(queueStatus.body, "failed") === 1, "failed count is exposed");
    expect(outputCount(queueStatus.body, "failed") === 1, "failed output count is exposed");
    expect(recentFailures(queueStatus.body).length === 3, "recent failures are exposed");

    const serialized = JSON.stringify(queueStatus.body);
    expect(!serialized.includes("redis://"), "queue status does not expose Redis URL");
    expect(!serialized.includes("sensitive prompt"), "queue status does not expose prompts");
    expect(!serialized.includes("generation:job:"), "queue status does not expose Redis job keys");

    unblockProviderCall?.();
    await providerCall;
    expect((await client.zCard("generation:provider:permits")) === 0, "provider permit is released after smoke");

    console.log("generation queue observability smoke checks passed");
  } finally {
    unblockProviderCall?.();
    await client.del(["generation:queue:ready", "generation:job:observability-ready", "generation:provider:permits"]);
    await generationTasks.shutdownGenerationTaskManager();
    await closeRedisClient();
    await closeDatabase();
    rmSync(dataDir, { force: true, recursive: true });
  }
}

function seedGenerationSummary(db: SqliteDatabase): void {
  const now = new Date().toISOString();
  db.insert(users)
    .values({
      id: "user-observability",
      name: "Observability User",
      email: "observability-user@example.local",
      passwordSalt: "salt",
      passwordIterations: 1,
      passwordHash: "hash",
      role: "user",
      status: "active",
      credits: 10,
      createdAt: now,
      updatedAt: now
    })
    .run();

  for (const status of ["pending", "running", "failed", "partial", "cancelled", "succeeded"] as const) {
    db.insert(generationRecords)
      .values({
        id: `observability-${status}`,
        userId: "user-observability",
        mode: "generate",
        prompt: `sensitive prompt ${status}`,
        effectivePrompt: `sensitive prompt ${status}`,
        presetId: "none",
        width: 1024,
        height: 1024,
        quality: "auto",
        outputFormat: "png",
        count: 1,
        status,
        error: status === "failed" ? "stable failure summary" : null,
        referenceAssetId: null,
        createdAt: now
      })
      .run();
  }

  db.insert(generationOutputs)
    .values([
      {
        id: "observability-output-failed",
        userId: "user-observability",
        generationId: "observability-failed",
        status: "failed",
        assetId: null,
        error: "stable output failure",
        isPublic: 0,
        publishedAt: null,
        publicTitle: null,
        createdAt: now
      },
      {
        id: "observability-output-succeeded",
        userId: "user-observability",
        generationId: "observability-succeeded",
        status: "succeeded",
        assetId: null,
        error: null,
        isPublic: 0,
        publishedAt: null,
        publicTitle: null,
        createdAt: now
      }
    ])
    .run();

  for (const status of ["failed", "partial", "cancelled"] as const) {
    db.insert(generationAudits)
      .values({
        id: `audit-observability-${status}`,
        generationId: `observability-${status}`,
        userId: "user-observability",
        userName: "Observability User",
        userEmail: "observability-user@example.local",
        mode: "generate",
        prompt: `sensitive prompt ${status}`,
        isPublic: 0,
        status,
        errorSummary: status === "cancelled" ? null : `stable ${status} summary`,
        ipAddress: null,
        userAgent: null,
        outputsJson: "[]",
        createdAt: now,
        updatedAt: now
      })
      .run();
  }
}

async function register(app: RequestApp, body: { name: string; email: string; password: string }): Promise<JsonResult> {
  return requestJson(app, "/api/auth/register", {
    body,
    method: "POST"
  });
}

async function requestJson(
  app: RequestApp,
  path: string,
  options: { body?: unknown; cookie?: string; method?: string } = {}
): Promise<JsonResult> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }

  const response = await app.request(path, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET"
  });
  const body = (await response.json().catch(() => undefined)) as unknown;
  return { response, body };
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for smoke condition.");
    }
    await delay(5);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionCookie(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function userEmail(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.user) || typeof body.user.email !== "string") {
    throw new Error("Missing user email in response.");
  }
  return body.user.email;
}

function queueField(body: unknown, section: string, field: string): unknown {
  return isRecord(body) && isRecord(body[section]) ? body[section][field] : undefined;
}

function databaseCount(body: unknown, status: string): unknown {
  return isRecord(body) && isRecord(body.database) && isRecord(body.database.records) ? body.database.records[status] : undefined;
}

function outputCount(body: unknown, status: string): unknown {
  return isRecord(body) && isRecord(body.database) && isRecord(body.database.outputs) ? body.database.outputs[status] : undefined;
}

function recentFailures(body: unknown): unknown[] {
  return isRecord(body) && isRecord(body.database) && Array.isArray(body.database.recentFailures)
    ? body.database.recentFailures
    : [];
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
