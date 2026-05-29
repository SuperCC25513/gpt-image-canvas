import { randomUUID } from "node:crypto";
import { sizeToApiValue, type GenerationRecord, type ReferenceImageInput } from "../contracts.js";
import type { CurrentUser } from "../contracts.js";
import { recordGenerationAuditStart, type GenerationAuditRequestContext } from "../admin/audit-store.js";
import { refundGenerationCreditsForFailures, reserveGenerationCredits } from "../credits/credit-store.js";
import { createConfiguredImageProvider } from "../providers/image-provider-selection.js";
import { ProviderError, type EditImageProviderInput, type ImageProvider, type ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import {
  enqueueGenerationJob,
  generationQueueUsesRedis,
  removeGenerationJob,
  startGenerationQueueWorker,
  stopGenerationQueueWorker,
  type GenerationQueueJob
} from "./generation-queue.js";
import { recoverGenerationQueueState } from "./generation-state-bridge.js";
import {
  cancelGenerationRecord,
  createPendingReferenceImageGeneration,
  createPendingTextToImageGeneration,
  createRunningReferenceImageGeneration,
  createRunningTextToImageGeneration,
  ensureGenerationIdAvailableForUser,
  failGenerationRecord,
  finishReferenceImageGeneration,
  finishTextToImageGeneration,
  getGenerationRecord,
  markGenerationRecordRunning,
  markInterruptedGenerationRecordsFailed,
  readStoredAsset
} from "./image-generation.js";

interface ActiveGenerationTask {
  controller: AbortController;
}

const activeGenerationTasks = new Map<string, ActiveGenerationTask>();

export async function initializeGenerationTaskManager(): Promise<void> {
  activeGenerationTasks.clear();
  if (generationQueueUsesRedis()) {
    await recoverGenerationQueueState();
    startGenerationQueueWorker(processQueuedGenerationJob);
    return;
  }

  await markInterruptedGenerationRecordsFailed();
}

export async function shutdownGenerationTaskManager(): Promise<void> {
  await stopGenerationQueueWorker();
}

export async function startTextToImageGenerationTask(
  input: ImageProviderInput,
  user: CurrentUser,
  auditContext?: GenerationAuditRequestContext
): Promise<GenerationRecord> {
  const generationId = input.clientRequestId || randomUUID();
  const inputWithRequestId = {
    ...input,
    clientRequestId: generationId
  };

  await ensureGenerationIdAvailableForUser(generationId, user);
  await reserveGenerationCredits(user, generationId, input.count);

  let record: GenerationRecord;
  try {
    record = generationQueueUsesRedis()
      ? await createPendingTextToImageGeneration(inputWithRequestId, user)
      : await createRunningTextToImageGeneration(inputWithRequestId, user);
  } catch (error) {
    await refundGenerationCreditsForFailures(generationId, input.count, input.count, user.id);
    throw error;
  }
  if (isTerminalGenerationStatus(record.status) || activeGenerationTasks.has(record.id)) {
    await recordGenerationAuditStartSafely(record, user, inputWithRequestId.isPublic === true, auditContext);
    return record;
  }
  await recordGenerationAuditStartSafely(record, user, inputWithRequestId.isPublic === true, auditContext);

  if (generationQueueUsesRedis()) {
    try {
      await enqueueGenerationTask(record, user, "generate", inputWithRequestId.isPublic === true);
    } catch (error) {
      await failGenerationRecord(record.id, errorToMessage(error), user);
      throw error;
    }
    return record;
  }

  startBackgroundGenerationTask(record.id, user, async (signal) => {
    const provider = await createConfiguredImageProvider(signal);
    await finishTextToImageGeneration(record.id, inputWithRequestId, provider, signal, user);
  });

  return record;
}

export async function startReferenceImageGenerationTask(
  input: EditImageProviderInput,
  user: CurrentUser,
  auditContext?: GenerationAuditRequestContext
): Promise<GenerationRecord> {
  const generationId = input.clientRequestId || randomUUID();
  const inputWithRequestId = {
    ...input,
    clientRequestId: generationId
  };

  await ensureGenerationIdAvailableForUser(generationId, user);
  await reserveGenerationCredits(user, generationId, input.count);

  let running: Awaited<ReturnType<typeof createRunningReferenceImageGeneration>>;
  try {
    running = generationQueueUsesRedis()
      ? await createPendingReferenceImageGeneration(inputWithRequestId, user)
      : await createRunningReferenceImageGeneration(inputWithRequestId, user);
  } catch (error) {
    await refundGenerationCreditsForFailures(generationId, input.count, input.count, user.id);
    throw error;
  }
  if (isTerminalGenerationStatus(running.record.status) || activeGenerationTasks.has(running.record.id)) {
    await recordGenerationAuditStartSafely(running.record, user, inputWithRequestId.isPublic === true, auditContext);
    return running.record;
  }
  await recordGenerationAuditStartSafely(running.record, user, inputWithRequestId.isPublic === true, auditContext);

  if (generationQueueUsesRedis()) {
    try {
      await enqueueGenerationTask(running.record, user, "edit", inputWithRequestId.isPublic === true);
    } catch (error) {
      await failGenerationRecord(running.record.id, errorToMessage(error), user);
      throw error;
    }
    return running.record;
  }

  startBackgroundGenerationTask(running.record.id, user, async (signal) => {
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
  const cancelled = await cancelGenerationRecord(generationId, user);
  if (cancelled?.status === "cancelled") {
    await removeGenerationJob(generationId);
  }
  return cancelled;
}

export async function runTextToImageGenerationTask(
  input: ImageProviderInput,
  user: CurrentUser,
  provider: ImageProvider,
  signal?: AbortSignal,
  auditContext?: GenerationAuditRequestContext
): Promise<GenerationRecord> {
  const generationId = input.clientRequestId || randomUUID();
  const inputWithRequestId = {
    ...input,
    clientRequestId: generationId
  };

  await ensureGenerationIdAvailableForUser(generationId, user);
  await reserveGenerationCredits(user, generationId, input.count);

  let record: GenerationRecord;
  try {
    record = await createRunningTextToImageGeneration(inputWithRequestId, user);
  } catch (error) {
    await refundGenerationCreditsForFailures(generationId, input.count, input.count, user.id);
    throw error;
  }

  await recordGenerationAuditStartSafely(record, user, inputWithRequestId.isPublic === true, auditContext);
  if (isTerminalGenerationStatus(record.status)) {
    return record;
  }

  try {
    return await finishTextToImageGeneration(record.id, inputWithRequestId, provider, signal, user);
  } catch (error) {
    if (signal?.aborted) {
      await cancelGenerationRecord(record.id, user);
    } else {
      await failGenerationRecord(record.id, errorToMessage(error), user);
    }
    throw error;
  }
}

export async function runReferenceImageGenerationTask(
  input: EditImageProviderInput,
  user: CurrentUser,
  provider: ImageProvider,
  signal?: AbortSignal,
  auditContext?: GenerationAuditRequestContext
): Promise<GenerationRecord> {
  const generationId = input.clientRequestId || randomUUID();
  const inputWithRequestId = {
    ...input,
    clientRequestId: generationId
  };

  await ensureGenerationIdAvailableForUser(generationId, user);
  await reserveGenerationCredits(user, generationId, input.count);

  let running: Awaited<ReturnType<typeof createRunningReferenceImageGeneration>>;
  try {
    running = await createRunningReferenceImageGeneration(inputWithRequestId, user);
  } catch (error) {
    await refundGenerationCreditsForFailures(generationId, input.count, input.count, user.id);
    throw error;
  }

  await recordGenerationAuditStartSafely(running.record, user, inputWithRequestId.isPublic === true, auditContext);
  if (isTerminalGenerationStatus(running.record.status)) {
    return running.record;
  }

  try {
    return await finishReferenceImageGeneration(running.record.id, running.input, provider, signal, user);
  } catch (error) {
    if (signal?.aborted) {
      await cancelGenerationRecord(running.record.id, user);
    } else {
      await failGenerationRecord(running.record.id, errorToMessage(error), user);
    }
    throw error;
  }
}

function startBackgroundGenerationTask(generationId: string, user: CurrentUser, run: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  activeGenerationTasks.set(generationId, { controller });

  void (async () => {
    try {
      await run(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        await cancelGenerationRecord(generationId, user);
      } else {
        await failGenerationRecord(generationId, errorToMessage(error), user);
      }
    } finally {
      const activeTask = activeGenerationTasks.get(generationId);
      if (activeTask?.controller === controller) {
        activeGenerationTasks.delete(generationId);
      }
    }
  })();
}

async function enqueueGenerationTask(
  record: GenerationRecord,
  user: CurrentUser,
  mode: GenerationQueueJob["mode"],
  isPublic: boolean
): Promise<void> {
  if (record.status !== "pending") {
    return;
  }

  await enqueueGenerationJob({
    jobId: randomUUID(),
    generationId: record.id,
    userId: user.id,
    mode,
    isPublic,
    attempt: 1,
    maxAttempts: 1,
    enqueuedAt: new Date().toISOString()
  });
}

async function processQueuedGenerationJob(job: GenerationQueueJob, workerSignal: AbortSignal): Promise<void> {
  const existing = await getGenerationRecord(job.generationId);
  if (!existing || isTerminalGenerationStatus(existing.status)) {
    return;
  }

  const controller = new AbortController();
  const abortFromWorker = (): void => controller.abort();
  workerSignal.addEventListener("abort", abortFromWorker, { once: true });
  activeGenerationTasks.set(job.generationId, { controller });

  try {
    const runningRecord = await markGenerationRecordRunning(job.generationId);
    if (!runningRecord || isTerminalGenerationStatus(runningRecord.status)) {
      return;
    }

    const provider = await createConfiguredImageProvider(controller.signal);
    if (job.mode === "edit") {
      const input = await editInputFromRecord(runningRecord, job.isPublic);
      await finishReferenceImageGeneration(runningRecord.id, input, provider, controller.signal);
    } else {
      await finishTextToImageGeneration(runningRecord.id, textInputFromRecord(runningRecord, job.isPublic), provider, controller.signal);
    }
  } catch (error) {
    if (workerSignal.aborted) {
      return;
    }
    if (controller.signal.aborted) {
      await cancelGenerationRecord(job.generationId);
    } else {
      await failGenerationRecord(job.generationId, errorToMessage(error));
    }
  } finally {
    workerSignal.removeEventListener("abort", abortFromWorker);
    const activeTask = activeGenerationTasks.get(job.generationId);
    if (activeTask?.controller === controller) {
      activeGenerationTasks.delete(job.generationId);
    }
  }
}

function textInputFromRecord(record: GenerationRecord, isPublic: boolean): ImageProviderInput {
  return {
    originalPrompt: record.prompt,
    clientRequestId: record.id,
    presetId: record.presetId,
    prompt: record.effectivePrompt,
    size: record.size,
    sizeApiValue: sizeToApiValue(record.size),
    quality: record.quality,
    outputFormat: record.outputFormat,
    count: record.count,
    isPublic
  };
}

async function editInputFromRecord(record: GenerationRecord, isPublic: boolean): Promise<EditImageProviderInput> {
  const referenceAssetIds = record.referenceAssetIds ?? (record.referenceAssetId ? [record.referenceAssetId] : []);
  const referenceImages: ReferenceImageInput[] = [];

  for (const assetId of referenceAssetIds) {
    const stored = await readStoredAsset(assetId);
    if (!stored) {
      throw new ProviderError("unsupported_provider_behavior", "参考图像资产无法读取。", 400);
    }
    referenceImages.push({
      dataUrl: `data:${stored.file.mimeType};base64,${stored.bytes.toString("base64")}`,
      fileName: stored.file.fileName
    });
  }

  return {
    ...textInputFromRecord(record, isPublic),
    referenceImages,
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };
}

async function recordGenerationAuditStartSafely(
  record: GenerationRecord,
  user: CurrentUser,
  isPublic: boolean,
  context: GenerationAuditRequestContext | undefined
): Promise<void> {
  try {
    await recordGenerationAuditStart({
      record,
      user,
      isPublic,
      context
    });
  } catch (error) {
    console.warn(`Generation audit start failed: ${errorToMessage(error)}`);
  }
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
