import { getRedisClient, redisRuntimeUsesRedis } from "../../infrastructure/redis-runtime.js";

export type GenerationQueueMode = "generate" | "edit";

export interface GenerationQueueConfig {
  workerConcurrency: number;
  pollIntervalMs: number;
}

export interface GenerationQueueJob {
  jobId: string;
  generationId: string;
  userId: string;
  mode: GenerationQueueMode;
  isPublic: boolean;
  attempt: number;
  maxAttempts: number;
  enqueuedAt: string;
}

export type GenerationQueueProcessor = (job: GenerationQueueJob, signal: AbortSignal) => Promise<void>;

export class GenerationQueueError extends Error {
  constructor(message = "Generation queue is unavailable.") {
    super(message);
    this.name = "GenerationQueueError";
  }
}

const DEFAULT_GENERATION_QUEUE_WORKER_CONCURRENCY = 2;
const DEFAULT_GENERATION_QUEUE_POLL_INTERVAL_MS = 250;
const GENERATION_QUEUE_READY_KEY = "generation:queue:ready";
const GENERATION_JOB_KEY_PREFIX = "generation:job:";

const generationQueueConfig = readGenerationQueueConfig(process.env);

let workerAbortController: AbortController | undefined;
let workerPromises: Array<Promise<void>> = [];

export function readGenerationQueueConfig(env: NodeJS.ProcessEnv): GenerationQueueConfig {
  return {
    workerConcurrency: parsePositiveInteger(env.GENERATION_QUEUE_WORKER_CONCURRENCY, DEFAULT_GENERATION_QUEUE_WORKER_CONCURRENCY),
    pollIntervalMs: parsePositiveInteger(env.GENERATION_QUEUE_POLL_INTERVAL_MS, DEFAULT_GENERATION_QUEUE_POLL_INTERVAL_MS)
  };
}

export function getGenerationQueueConfig(): GenerationQueueConfig {
  return generationQueueConfig;
}

export function generationQueueUsesRedis(): boolean {
  return redisRuntimeUsesRedis();
}

export async function enqueueGenerationJob(job: GenerationQueueJob): Promise<void> {
  if (!generationQueueUsesRedis()) {
    throw new GenerationQueueError("Generation queue is disabled by GENERATION_QUEUE_DRIVER=inline.");
  }

  try {
    const client = await getRedisClient();
    const jobKey = generationJobKey(job.generationId);
    await client.set(jobKey, JSON.stringify(job));
    await client.rPush(GENERATION_QUEUE_READY_KEY, jobKey);
  } catch (error) {
    throw toGenerationQueueError(error);
  }
}

export async function removeGenerationJob(generationId: string): Promise<void> {
  if (!generationQueueUsesRedis()) {
    return;
  }

  try {
    const client = await getRedisClient();
    const jobKey = generationJobKey(generationId);
    await client.del(jobKey);
    await client.lRem(GENERATION_QUEUE_READY_KEY, 0, jobKey);
  } catch (error) {
    console.warn(`Generation queue job removal failed: ${errorToMessage(error)}`);
  }
}

export function startGenerationQueueWorker(processor: GenerationQueueProcessor): void {
  if (!generationQueueUsesRedis() || workerAbortController) {
    return;
  }

  const controller = new AbortController();
  workerAbortController = controller;
  workerPromises = Array.from({ length: generationQueueConfig.workerConcurrency }, (_, index) =>
    generationQueueWorkerLoop(index, processor, controller.signal)
  );
}

export async function stopGenerationQueueWorker(): Promise<void> {
  const controller = workerAbortController;
  if (!controller) {
    return;
  }

  workerAbortController = undefined;
  controller.abort();
  await Promise.allSettled(workerPromises);
  workerPromises = [];
}

async function generationQueueWorkerLoop(
  index: number,
  processor: GenerationQueueProcessor,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    try {
      const jobKey = await popNextJobKey();
      if (!jobKey) {
        await delay(generationQueueConfig.pollIntervalMs, signal);
        continue;
      }

      const job = await readQueuedJob(jobKey);
      if (!job) {
        continue;
      }

      try {
        await processor(job, signal);
      } finally {
        await deleteQueuedJob(jobKey);
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return;
      }
      console.warn(`Generation queue worker ${index} failed: ${errorToMessage(error)}`);
      await delay(generationQueueConfig.pollIntervalMs, signal).catch(() => undefined);
    }
  }
}

async function popNextJobKey(): Promise<string | undefined> {
  try {
    const client = await getRedisClient();
    const value = await client.lPop(GENERATION_QUEUE_READY_KEY);
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch (error) {
    throw toGenerationQueueError(error);
  }
}

async function readQueuedJob(jobKey: string): Promise<GenerationQueueJob | undefined> {
  try {
    const client = await getRedisClient();
    const raw = await client.get(jobKey);
    if (!raw) {
      return undefined;
    }
    const parsed = parseGenerationQueueJob(JSON.parse(raw));
    if (!parsed) {
      await deleteQueuedJob(jobKey);
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      await deleteQueuedJob(jobKey);
      return undefined;
    }
    throw toGenerationQueueError(error);
  }
}

async function deleteQueuedJob(jobKey: string): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.del(jobKey);
  } catch (error) {
    console.warn(`Generation queue job cleanup failed: ${errorToMessage(error)}`);
  }
}

function parseGenerationQueueJob(value: unknown): GenerationQueueJob | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<GenerationQueueJob>;
  if (
    typeof candidate.jobId !== "string" ||
    typeof candidate.generationId !== "string" ||
    typeof candidate.userId !== "string" ||
    (candidate.mode !== "generate" && candidate.mode !== "edit") ||
    typeof candidate.isPublic !== "boolean" ||
    typeof candidate.enqueuedAt !== "string"
  ) {
    return undefined;
  }

  return {
    jobId: candidate.jobId,
    generationId: candidate.generationId,
    userId: candidate.userId,
    mode: candidate.mode,
    isPublic: candidate.isPublic,
    attempt: positiveNumber(candidate.attempt) ?? 1,
    maxAttempts: positiveNumber(candidate.maxAttempts) ?? 1,
    enqueuedAt: candidate.enqueuedAt
  };
}

function generationJobKey(generationId: string): string {
  return `${GENERATION_JOB_KEY_PREFIX}${generationId}`;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function toGenerationQueueError(error: unknown): GenerationQueueError {
  if (error instanceof GenerationQueueError) {
    return error;
  }
  return new GenerationQueueError();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorToMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown error";
}
