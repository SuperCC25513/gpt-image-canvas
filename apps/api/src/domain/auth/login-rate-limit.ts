import { createHash } from "node:crypto";
import { getRedisClient, redisRuntimeUsesRedis } from "../../infrastructure/redis-runtime.js";
import { AuthDomainError } from "./auth-errors.js";

const LOGIN_FAILURE_WINDOW_SECONDS = 10 * 60;
const LOGIN_LOCK_SECONDS = 5 * 60;
const EMAIL_FAILURE_LIMIT = 5;
const IP_FAILURE_LIMIT = 50;

interface LoginRateLimitContext {
  email: string;
  ipAddress?: string;
}

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

const memoryCounters = new Map<string, MemoryCounter>();
const memoryLocks = new Map<string, number>();

export async function assertLoginAllowed(context: LoginRateLimitContext): Promise<void> {
  const keys = loginRateLimitKeys(context);
  if (await isLocked(keys.emailLockKey)) {
    throw loginRateLimited();
  }
  if (keys.ipLockKey && (await isLocked(keys.ipLockKey))) {
    throw loginRateLimited();
  }
}

export async function recordLoginFailure(context: LoginRateLimitContext): Promise<void> {
  const keys = loginRateLimitKeys(context);
  const emailFailures = await incrementFailures(keys.emailCounterKey);
  if (emailFailures >= EMAIL_FAILURE_LIMIT) {
    await lockKey(keys.emailLockKey);
  }

  if (!keys.ipCounterKey || !keys.ipLockKey) {
    return;
  }

  const ipFailures = await incrementFailures(keys.ipCounterKey);
  if (ipFailures >= IP_FAILURE_LIMIT) {
    await lockKey(keys.ipLockKey);
  }
}

export async function recordLoginSuccess(context: LoginRateLimitContext): Promise<void> {
  const keys = loginRateLimitKeys(context);
  await clearKey(keys.emailCounterKey);
  await clearKey(keys.emailLockKey);
}

function loginRateLimitKeys(context: LoginRateLimitContext): {
  emailCounterKey: string;
  emailLockKey: string;
  ipCounterKey?: string;
  ipLockKey?: string;
} {
  const emailHash = stableHash(context.email);
  const ipHash = context.ipAddress ? stableHash(context.ipAddress) : undefined;
  return {
    emailCounterKey: `auth:login:fail:email:${emailHash}`,
    emailLockKey: `auth:login:lock:email:${emailHash}`,
    ipCounterKey: ipHash ? `auth:login:fail:ip:${ipHash}` : undefined,
    ipLockKey: ipHash ? `auth:login:lock:ip:${ipHash}` : undefined
  };
}

async function isLocked(key: string): Promise<boolean> {
  if (redisRuntimeUsesRedis()) {
    try {
      const client = await getRedisClient();
      return Boolean(await client.exists(key));
    } catch {
      return isMemoryLocked(key);
    }
  }

  return isMemoryLocked(key);
}

async function incrementFailures(key: string): Promise<number> {
  if (redisRuntimeUsesRedis()) {
    try {
      const client = await getRedisClient();
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, LOGIN_FAILURE_WINDOW_SECONDS);
      }
      return count;
    } catch {
      return incrementMemoryFailures(key);
    }
  }

  return incrementMemoryFailures(key);
}

async function lockKey(key: string): Promise<void> {
  if (redisRuntimeUsesRedis()) {
    try {
      const client = await getRedisClient();
      await client.set(key, "1", { EX: LOGIN_LOCK_SECONDS });
      return;
    } catch {
      lockMemoryKey(key);
      return;
    }
  }

  lockMemoryKey(key);
}

async function clearKey(key: string): Promise<void> {
  if (redisRuntimeUsesRedis()) {
    try {
      const client = await getRedisClient();
      await client.del(key);
    } catch {
      // Best-effort cleanup; fall through to memory cleanup for inline/test fallback.
    }
  }

  memoryCounters.delete(key);
  memoryLocks.delete(key);
}

function isMemoryLocked(key: string): boolean {
  cleanupExpiredMemoryState();
  const lockedUntil = memoryLocks.get(key);
  return typeof lockedUntil === "number" && lockedUntil > Date.now();
}

function incrementMemoryFailures(key: string): number {
  cleanupExpiredMemoryState();
  const now = Date.now();
  const existing = memoryCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(key, {
      count: 1,
      expiresAt: now + LOGIN_FAILURE_WINDOW_SECONDS * 1000
    });
    return 1;
  }

  existing.count += 1;
  return existing.count;
}

function lockMemoryKey(key: string): void {
  memoryLocks.set(key, Date.now() + LOGIN_LOCK_SECONDS * 1000);
}

function cleanupExpiredMemoryState(): void {
  const now = Date.now();
  for (const [key, value] of memoryCounters) {
    if (value.expiresAt <= now) {
      memoryCounters.delete(key);
    }
  }
  for (const [key, lockedUntil] of memoryLocks) {
    if (lockedUntil <= now) {
      memoryLocks.delete(key);
    }
  }
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function loginRateLimited(): AuthDomainError {
  return new AuthDomainError("auth_rate_limited", "登录尝试过于频繁，请稍后再试。", 429);
}
