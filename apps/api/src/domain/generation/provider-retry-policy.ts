import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { type ProviderCallInput, ProviderSchedulerError, runProviderCall } from "./provider-scheduler.js";

export interface ProviderRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type ProviderRetryDecision =
  | { retry: true; delayMs: number; reason: string }
  | { retry: false; reason: string };

const DEFAULT_PROVIDER_MAX_RETRIES = 2;
const DEFAULT_PROVIDER_RETRY_BASE_MS = 1000;
const DEFAULT_PROVIDER_RETRY_MAX_MS = 30_000;
const JITTER_RATIO = 0.2;
const RETRY_EXHAUSTED_MESSAGE = "图像服务暂时不可用，已自动重试后仍失败。请稍后再试。";
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET"
]);

const providerRetryConfig = readProviderRetryConfig(process.env);

export function readProviderRetryConfig(env: NodeJS.ProcessEnv): ProviderRetryConfig {
  return {
    maxRetries: parseNonNegativeInteger(env.GENERATION_PROVIDER_MAX_RETRIES, DEFAULT_PROVIDER_MAX_RETRIES),
    baseDelayMs: parsePositiveInteger(env.GENERATION_PROVIDER_RETRY_BASE_MS, DEFAULT_PROVIDER_RETRY_BASE_MS),
    maxDelayMs: parsePositiveInteger(env.GENERATION_PROVIDER_RETRY_MAX_MS, DEFAULT_PROVIDER_RETRY_MAX_MS)
  };
}

export function getProviderRetryConfig(): ProviderRetryConfig {
  return providerRetryConfig;
}

export async function runProviderCallWithRetry<T>(input: ProviderCallInput<T>): Promise<T> {
  const maxAttempts = Math.max(1, providerRetryConfig.maxRetries + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(input.signal);
    try {
      return await runProviderCall(input);
    } catch (error) {
      if (isAbortError(error) || input.signal?.aborted) {
        throw error;
      }

      lastError = error;
      const decision = classifyProviderRetry(error, attempt, maxAttempts);
      if (!decision.retry) {
        throw isRetryableProviderError(error) && decision.reason === "max_attempts_exhausted"
          ? retryExhaustedError(error)
          : error;
      }

      console.warn(
        `Provider call retry scheduled: outputIndex=${input.outputIndex} attempt=${attempt}/${maxAttempts} reason=${decision.reason} delayMs=${decision.delayMs}`
      );
      await delay(decision.delayMs, input.signal);
    }
  }

  throw retryExhaustedError(lastError);
}

export function classifyProviderRetry(error: unknown, attempt: number, maxAttempts: number): ProviderRetryDecision {
  const reason = retryableReason(error);
  if (!reason) {
    return { retry: false, reason: nonRetryableReason(error) };
  }

  if (attempt >= maxAttempts) {
    return { retry: false, reason: "max_attempts_exhausted" };
  }

  return {
    retry: true,
    delayMs: retryDelayMs(attempt, providerRetryConfig),
    reason
  };
}

function retryableReason(error: unknown): string | undefined {
  if (error instanceof ProviderError) {
    if (error.code === "missing_api_key" || error.code === "missing_provider") {
      return undefined;
    }
    if (error.status === 408) {
      return "http_408";
    }
    if (error.status === 429) {
      return "http_429";
    }
    if (error.status >= 500 && error.status <= 599) {
      return "http_5xx";
    }
    return undefined;
  }

  if (error instanceof ProviderSchedulerError) {
    return "provider_scheduler_unavailable";
  }

  if (isAbortError(error)) {
    return undefined;
  }

  const code = errorCode(error);
  if (code && RETRYABLE_NETWORK_ERROR_CODES.has(code)) {
    return "temporary_network_error";
  }

  const message = errorMessage(error).toLowerCase();
  if (/\b(time[ -]?out|timed out|timeout)\b/u.test(message)) {
    return "network_timeout";
  }
  if (/\b(fetch failed|network|connection reset|socket hang up|temporar(?:y|ily))\b/u.test(message)) {
    return "temporary_network_error";
  }

  return undefined;
}

function nonRetryableReason(error: unknown): string {
  if (isAbortError(error)) {
    return "aborted";
  }
  if (error instanceof ProviderError) {
    if (error.code === "missing_api_key") {
      return "missing_api_key";
    }
    if (error.code === "missing_provider") {
      return "missing_provider";
    }
    if (error.status >= 400 && error.status < 500) {
      return `http_${error.status}`;
    }
  }
  return "non_retryable";
}

function retryDelayMs(attempt: number, config: ProviderRetryConfig): number {
  const exponentialDelay = config.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = 1 - JITTER_RATIO + Math.random() * JITTER_RATIO * 2;
  return Math.max(1, Math.min(config.maxDelayMs, Math.round(cappedDelay * jitter)));
}

function retryExhaustedError(error: unknown): ProviderError {
  return new ProviderError("upstream_failure", RETRY_EXHAUSTED_MESSAGE, providerErrorStatus(error));
}

function providerErrorStatus(error: unknown): number {
  if (error instanceof ProviderError) {
    return error.status;
  }
  return 502;
}

function isRetryableProviderError(error: unknown): boolean {
  return retryableReason(error) !== undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}
