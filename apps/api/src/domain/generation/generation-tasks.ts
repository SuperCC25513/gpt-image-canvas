import type { GenerationRecord } from "../contracts.js";
import type { CurrentUser } from "../contracts.js";
import { createConfiguredImageProvider } from "../providers/image-provider-selection.js";
import type { EditImageProviderInput, ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import {
  cancelGenerationRecord,
  createRunningReferenceImageGeneration,
  createRunningTextToImageGeneration,
  failGenerationRecord,
  finishReferenceImageGeneration,
  finishTextToImageGeneration,
  getGenerationRecord,
  markInterruptedGenerationRecordsFailed
} from "./image-generation.js";

interface ActiveGenerationTask {
  controller: AbortController;
}

const activeGenerationTasks = new Map<string, ActiveGenerationTask>();

export async function initializeGenerationTaskManager(): Promise<void> {
  activeGenerationTasks.clear();
  await markInterruptedGenerationRecordsFailed();
}

export async function startTextToImageGenerationTask(input: ImageProviderInput, user: CurrentUser): Promise<GenerationRecord> {
  const record = await createRunningTextToImageGeneration(input, user);
  if (isTerminalGenerationStatus(record.status) || activeGenerationTasks.has(record.id)) {
    return record;
  }

  startBackgroundGenerationTask(record.id, async (signal) => {
    const provider = await createConfiguredImageProvider(signal);
    await finishTextToImageGeneration(record.id, input, provider, signal, user);
  });

  return record;
}

export async function startReferenceImageGenerationTask(input: EditImageProviderInput, user: CurrentUser): Promise<GenerationRecord> {
  const running = await createRunningReferenceImageGeneration(input, user);
  if (isTerminalGenerationStatus(running.record.status) || activeGenerationTasks.has(running.record.id)) {
    return running.record;
  }

  startBackgroundGenerationTask(running.record.id, async (signal) => {
    const provider = await createConfiguredImageProvider(signal);
    await finishReferenceImageGeneration(running.record.id, running.input, provider, signal, user);
  });

  return running.record;
}

export async function readGenerationTaskRecord(generationId: string, user: CurrentUser): Promise<GenerationRecord | undefined> {
  return getGenerationRecord(generationId, user);
}

export async function cancelGenerationTask(generationId: string, user: CurrentUser): Promise<GenerationRecord | undefined> {
  const record = await getGenerationRecord(generationId, user);
  if (!record) {
    return undefined;
  }

  activeGenerationTasks.get(generationId)?.controller.abort();
  return cancelGenerationRecord(generationId);
}

function startBackgroundGenerationTask(generationId: string, run: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  activeGenerationTasks.set(generationId, { controller });

  void (async () => {
    try {
      await run(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        await cancelGenerationRecord(generationId);
      } else {
        await failGenerationRecord(generationId, errorToMessage(error));
      }
    } finally {
      const activeTask = activeGenerationTasks.get(generationId);
      if (activeTask?.controller === controller) {
        activeGenerationTasks.delete(generationId);
      }
    }
  })();
}

function isTerminalGenerationStatus(status: GenerationRecord["status"]): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Generation failed. Try again.";
}
