import { randomUUID } from "node:crypto";
import { getRedisClient, redisRuntimeUsesRedis } from "../../infrastructure/redis-runtime.js";

export type ProviderCallMode = "generate" | "edit";

export interface ProviderSchedulerConfig {
  globalConcurrency: number;
  permitTtlMs: number;
}

export interface ProviderSchedulerSnapshot {
  configuredConcurrency: number;
  activePermits?: number;
  availablePermits?: number;
  permitTtlMs: number;
}

export interface ProviderCallInput<T> {
  generationId: string;
  outputId: string;
  outputIndex: number;
  mode: ProviderCallMode;
  signal?: AbortSignal;
  call: (signal?: AbortSignal) => Promise<T>;
}

export class ProviderSchedulerError extends Error {
  constructor(message = "Provider scheduler is unavailable.") {
    super(message);
    this.name = "ProviderSchedulerError";
  }
}

interface ProviderPermit {
  release: () => Promise<void>;
}

const DEFAULT_PROVIDER_GLOBAL_CONCURRENCY = 2;
const DEFAULT_PROVIDER_PERMIT_TTL_MS = 30 * 60 * 1000;
const PROVIDER_PERMIT_RETRY_DELAY_MS = 100;
const PROVIDER_PERMITS_KEY = "generation:provider:permits";

const ACQUIRE_PROVIDER_PERMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local permitId = ARGV[3]
local redisTime = redis.call("TIME")
local nowMs = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", nowMs)
local current = redis.call("ZCARD", key)
if current < limit then
  redis.call("ZADD", key, nowMs + ttlMs, permitId)
  redis.call("PEXPIRE", key, ttlMs)
  return 1
end
return 0
`;

const COUNT_PROVIDER_PERMITS_SCRIPT = `
local key = KEYS[1]
local redisTime = redis.call("TIME")
local nowMs = redisTime[1] * 1000 + math.floor(redisTime[2] / 1000)
redis.call("ZREMRANGEBYSCORE", key, "-inf", nowMs)
return redis.call("ZCARD", key)
`;

const providerSchedulerConfig = readProviderSchedulerConfig(process.env);
let inlineActivePermits = 0;

export function readProviderSchedulerConfig(env: NodeJS.ProcessEnv): ProviderSchedulerConfig {
  return {
    globalConcurrency: parsePositiveInteger(env.GENERATION_PROVIDER_GLOBAL_CONCURRENCY, DEFAULT_PROVIDER_GLOBAL_CONCURRENCY),
    permitTtlMs: parsePositiveInteger(env.GENERATION_PROVIDER_PERMIT_TTL_MS, DEFAULT_PROVIDER_PERMIT_TTL_MS)
  };
}

export function getProviderSchedulerConfig(): ProviderSchedulerConfig {
  return providerSchedulerConfig;
}

export async function runProviderCall<T>(input: ProviderCallInput<T>): Promise<T> {
  const permit = await acquireProviderPermit(input);
  try {
    throwIfAborted(input.signal);
    return await input.call(input.signal);
  } finally {
    await releaseProviderPermitSafely(permit);
  }
}

export async function getProviderSchedulerSnapshot(
  options: { readRedisMetrics?: boolean } = {}
): Promise<ProviderSchedulerSnapshot> {
  const activePermits =
    redisRuntimeUsesRedis() && options.readRedisMetrics !== false
      ? await countRedisProviderPermits()
      : redisRuntimeUsesRedis()
        ? undefined
        : inlineActivePermits;

  return {
    configuredConcurrency: providerSchedulerConfig.globalConcurrency,
    activePermits,
    availablePermits:
      activePermits === undefined ? undefined : Math.max(0, providerSchedulerConfig.globalConcurrency - activePermits),
    permitTtlMs: providerSchedulerConfig.permitTtlMs
  };
}

async function acquireProviderPermit(input: ProviderCallInput<unknown>): Promise<ProviderPermit> {
  if (redisRuntimeUsesRedis()) {
    return acquireRedisProviderPermit(input);
  }

  return acquireInlineProviderPermit(input.signal);
}

async function countRedisProviderPermits(): Promise<number> {
  try {
    const client = await getRedisClient();
    const count = await client.eval(COUNT_PROVIDER_PERMITS_SCRIPT, {
      keys: [PROVIDER_PERMITS_KEY],
      arguments: []
    });
    return numericRedisResult(count);
  } catch (error) {
    throw toProviderSchedulerError(error);
  }
}

async function acquireInlineProviderPermit(signal: AbortSignal | undefined): Promise<ProviderPermit> {
  return waitForProviderPermit(signal, async () => {
    if (inlineActivePermits >= providerSchedulerConfig.globalConcurrency) {
      return undefined;
    }

    inlineActivePermits += 1;
    let released = false;
    return {
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        inlineActivePermits = Math.max(0, inlineActivePermits - 1);
      }
    };
  });
}

async function acquireRedisProviderPermit(input: ProviderCallInput<unknown>): Promise<ProviderPermit> {
  return waitForProviderPermit(input.signal, async () => {
    const client = await getRedisClient();
    const permitId = randomUUID();
    const acquired = await client.eval(ACQUIRE_PROVIDER_PERMIT_SCRIPT, {
      keys: [PROVIDER_PERMITS_KEY],
      arguments: [
        String(providerSchedulerConfig.globalConcurrency),
        String(providerSchedulerConfig.permitTtlMs),
        permitId
      ]
    });

    if (!isAcquirePermitSuccess(acquired)) {
      return undefined;
    }

    return {
      release: async () => {
        await client.zRem(PROVIDER_PERMITS_KEY, permitId);
      }
    };
  });
}

async function waitForProviderPermit(
  signal: AbortSignal | undefined,
  tryAcquire: () => Promise<ProviderPermit | undefined>
): Promise<ProviderPermit> {
  while (true) {
    throwIfAborted(signal);
    try {
      const permit = await tryAcquire();
      if (permit) {
        return permit;
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw toProviderSchedulerError(error);
    }
    await delay(PROVIDER_PERMIT_RETRY_DELAY_MS, signal);
  }
}

async function releaseProviderPermitSafely(permit: ProviderPermit): Promise<void> {
  try {
    await permit.release();
  } catch (error) {
    console.warn(`Provider scheduler permit release failed: ${errorToMessage(error)}`);
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isAcquirePermitSuccess(value: unknown): boolean {
  return value === 1 || value === "1";
}

function numericRedisResult(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toProviderSchedulerError(error: unknown): ProviderSchedulerError {
  if (error instanceof ProviderSchedulerError) {
    return error;
  }
  return new ProviderSchedulerError();
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "unknown error";
}
