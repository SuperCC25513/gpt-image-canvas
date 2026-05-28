import { createClient } from "redis";

export type GenerationQueueDriver = "redis" | "inline";

export interface RedisRuntimeConfig {
  url: string;
  queueDriver: GenerationQueueDriver;
  connectTimeoutMs: number;
}

export type RedisHealthStatus = "ok" | "disabled" | "unavailable";

export class RedisRuntimeError extends Error {
  constructor(message = "Redis runtime is unavailable.") {
    super(message);
    this.name = "RedisRuntimeError";
  }
}

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5000;

type RedisRuntimeClient = ReturnType<typeof createClient>;

const redisRuntimeConfig = readRedisRuntimeConfig(process.env);
let redisClient: RedisRuntimeClient | undefined;
let redisClientPromise: Promise<RedisRuntimeClient> | undefined;

export function readRedisRuntimeConfig(env: NodeJS.ProcessEnv): RedisRuntimeConfig {
  const queueDriver = parseGenerationQueueDriver(env.GENERATION_QUEUE_DRIVER);
  return {
    url: nonEmptyString(env.REDIS_URL) ?? DEFAULT_REDIS_URL,
    queueDriver,
    connectTimeoutMs: parsePositiveInteger(env.REDIS_CONNECT_TIMEOUT_MS, DEFAULT_REDIS_CONNECT_TIMEOUT_MS)
  };
}

export function getRedisRuntimeConfig(): RedisRuntimeConfig {
  return redisRuntimeConfig;
}

export function redisRuntimeUsesRedis(): boolean {
  return redisRuntimeConfig.queueDriver === "redis";
}

export async function getRedisClient(): Promise<RedisRuntimeClient> {
  if (!redisRuntimeUsesRedis()) {
    throw new RedisRuntimeError("Redis runtime is disabled by GENERATION_QUEUE_DRIVER=inline.");
  }

  if (redisClient?.isReady) {
    return redisClient;
  }
  if (redisClientPromise) {
    return redisClientPromise;
  }

  const client = createClient({
    url: redisRuntimeConfig.url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: redisRuntimeConfig.connectTimeoutMs,
      reconnectStrategy: false
    }
  });
  client.on("error", () => {
    // Errors are intentionally redacted at the runtime boundary.
  });

  redisClient = client;
  redisClientPromise = client
    .connect()
    .then(() => client)
    .catch((error: unknown) => {
      if (redisClient === client) {
        redisClient = undefined;
      }
      redisClientPromise = undefined;
      client.destroy();
      throw toRedisRuntimeError(error);
    });

  return redisClientPromise;
}

export async function assertRedisReady(): Promise<void> {
  if (!redisRuntimeUsesRedis()) {
    return;
  }

  try {
    const client = await getRedisClient();
    await client.ping();
  } catch (error) {
    throw toRedisRuntimeError(error);
  }
}

export async function checkRedisHealth(): Promise<RedisHealthStatus> {
  if (!redisRuntimeUsesRedis()) {
    return "disabled";
  }

  try {
    await assertRedisReady();
    return "ok";
  } catch {
    return "unavailable";
  }
}

export async function closeRedisClient(): Promise<void> {
  const client = redisClient;
  redisClient = undefined;
  redisClientPromise = undefined;

  if (!client) {
    return;
  }

  if (!client.isOpen) {
    client.destroy();
    return;
  }

  try {
    await client.close();
  } catch {
    client.destroy();
  }
}

function parseGenerationQueueDriver(value: string | undefined): GenerationQueueDriver {
  return value?.trim().toLowerCase() === "inline" ? "inline" : "redis";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function toRedisRuntimeError(error: unknown): RedisRuntimeError {
  if (error instanceof RedisRuntimeError) {
    return error;
  }
  return new RedisRuntimeError();
}
