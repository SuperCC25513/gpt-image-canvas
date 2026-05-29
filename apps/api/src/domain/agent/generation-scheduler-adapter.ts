import type { CurrentUser, GenerationRecord } from "../contracts.js";
import {
  cancelGenerationTask,
  readGenerationTaskRecord,
  runReferenceImageGenerationTask,
  runTextToImageGenerationTask,
  startReferenceImageGenerationTask,
  startTextToImageGenerationTask
} from "../generation/generation-tasks.js";
import { generationQueueUsesRedis, getGenerationQueueConfig } from "../generation/generation-queue.js";
import type { EditImageProviderInput, ImageProvider, ImageProviderInput } from "../../infrastructure/providers/image-provider.js";

export interface ScheduledAgentGenerationInput {
  runId: string;
  jobId: string;
  user: CurrentUser;
  provider?: ImageProvider;
  signal: AbortSignal;
  isRunActive: () => boolean;
  onRunning?: (record: GenerationRecord) => void;
}

export function shouldUseAgentGenerationQueue(provider?: ImageProvider): boolean {
  return generationQueueUsesRedis() && !provider;
}

export async function runScheduledAgentTextGeneration(
  input: ScheduledAgentGenerationInput & { request: ImageProviderInput }
): Promise<GenerationRecord> {
  if (!shouldUseAgentGenerationQueue(input.provider)) {
    return runTextToImageGenerationTask(input.request, input.user, requiredProvider(input.provider), input.signal);
  }

  throwIfAborted(input.signal);
  const record = await startTextToImageGenerationTask(input.request, input.user);
  return waitForScheduledGenerationRecord(record.id, input);
}

export async function runScheduledAgentReferenceGeneration(
  input: ScheduledAgentGenerationInput & { request: EditImageProviderInput }
): Promise<GenerationRecord> {
  if (!shouldUseAgentGenerationQueue(input.provider)) {
    return runReferenceImageGenerationTask(input.request, input.user, requiredProvider(input.provider), input.signal);
  }

  throwIfAborted(input.signal);
  const record = await startReferenceImageGenerationTask(input.request, input.user);
  return waitForScheduledGenerationRecord(record.id, input);
}

async function waitForScheduledGenerationRecord(
  generationId: string,
  input: ScheduledAgentGenerationInput
): Promise<GenerationRecord> {
  let runningNotified = false;
  const cancelScheduledGeneration = (): void => {
    void cancelGenerationTask(generationId, input.user).catch((error: unknown) => {
      console.warn(`Agent scheduled generation cancellation failed: ${errorToMessage(error)}`);
    });
  };

  input.signal.addEventListener("abort", cancelScheduledGeneration, { once: true });
  try {
    while (true) {
      if (input.signal.aborted || !input.isRunActive()) {
        await cancelGenerationTask(generationId, input.user);
        throw createAbortError();
      }

      const record = await readGenerationTaskRecord(generationId, input.user);
      if (!record) {
        throw new Error("Scheduled Agent generation record is unavailable.");
      }

      if (!runningNotified && (record.status === "running" || isTerminalGenerationStatus(record.status))) {
        runningNotified = true;
        input.onRunning?.(record);
      }

      if (isTerminalGenerationStatus(record.status)) {
        return record;
      }

      try {
        await delay(getGenerationQueueConfig().pollIntervalMs, input.signal);
      } catch (error) {
        if (input.signal.aborted || !input.isRunActive()) {
          await cancelGenerationTask(generationId, input.user);
        }
        throw error;
      }
    }
  } finally {
    input.signal.removeEventListener("abort", cancelScheduledGeneration);
  }
}

function requiredProvider(provider: ImageProvider | undefined): ImageProvider {
  if (!provider) {
    throw new Error("Agent generation requires a configured image provider.");
  }
  return provider;
}

function isTerminalGenerationStatus(status: GenerationRecord["status"]): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): DOMException {
  return new DOMException("Agent run was cancelled.", "AbortError");
}

function errorToMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown error";
}
