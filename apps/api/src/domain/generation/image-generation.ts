import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  AssetAccessUrlResponse,
  AssetMetadataResponse,
  GeneratedAsset,
  GenerationOutput,
  GenerationRecord,
  GenerationResponse,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  ImageSize,
  OutputStatus,
  OutputFormat,
  ReferenceImageInput
} from "../contracts.js";
import type { CurrentUser } from "../contracts.js";
import { markInterruptedGenerationAuditsFailed, updateGenerationAuditFromRecord } from "../admin/audit-store.js";
import { refundGenerationCreditsForFailures, refundInterruptedGenerationCredits } from "../credits/credit-store.js";
import {
  ProviderError,
  type EditImageProviderInput,
  type ImageProvider,
  type ImageProviderInput,
  type ProviderImage
} from "../../infrastructure/providers/image-provider.js";
import {
  assetStorageSignedUrlExpiresInSeconds,
  readStoredAssetBytes,
  resolveLocalAssetPath,
  storedAssetAccessUrl,
  storedAssetRelativePathForFileName,
  usesOssAssetStorage,
  writeStoredAssetBytes
} from "../../infrastructure/storage/asset-storage.js";
import {
  assetExists,
  completeGenerationRecordWithOutputs,
  findAssetById,
  insertAsset,
  insertGenerationOutputs,
  insertGenerationRecord,
  markInterruptedGenerationRecordsFailed as markInterruptedGenerationRecordsFailedInStore,
  readGenerationRecord,
  readGenerationRecordOwner,
  updateGenerationRecordStatus as updateGenerationRecordStatusInStore
} from "../storage/store.js";

const BATCH_CONCURRENCY = 2;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const INTERRUPTED_GENERATION_ERROR = "Generation was interrupted by an API restart. Rerun it from history.";
const CANCELLED_GENERATION_ERROR = "This generation was cancelled.";

export class GenerationDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "GenerationDomainError";
  }
}

export interface StoredAssetFile {
  id: string;
  fileName: string;
  relativePath: string;
  filePath?: string;
  mimeType: string;
}

type StoredGeneratedAsset = GeneratedAsset & {
  relativePath: string;
};

interface BatchOutputResult {
  id: string;
  status: "succeeded" | "failed";
  asset?: StoredGeneratedAsset;
  error?: string;
  isPublic?: boolean;
  publicTitle?: string;
}

interface SavedProviderImage {
  asset: StoredGeneratedAsset;
}

type PersistedGenerationInput = ImageProviderInput & {
  mode: "generate" | "edit";
  referenceAssetIds?: string[];
  referenceAssetId?: string;
};

const mimeTypes: Record<OutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export async function runTextToImageGeneration(
  input: ImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  user?: CurrentUser
): Promise<GenerationResponse> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal)
  );

  const record = await saveCompletedGenerationRecord(
    randomUUID(),
    {
      ...input,
      mode: "generate"
    },
    outputs,
    user
  );

  return {
    record
  };
}

export async function runReferenceImageGeneration(
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  user?: CurrentUser
): Promise<GenerationResponse> {
  const referenceAssetIds = await ensureReferenceAssetIds(input, user);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  const outputs = await mapWithConcurrency(
    Array.from({ length: inputWithReferenceAssets.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(inputWithReferenceAssets, provider, signal)
  );

  const record = await saveCompletedGenerationRecord(
    randomUUID(),
    {
      ...inputWithReferenceAssets,
      mode: "edit"
    },
    outputs,
    user
  );

  return {
    record
  };
}

export async function createRunningTextToImageGeneration(input: ImageProviderInput, user?: CurrentUser): Promise<GenerationRecord> {
  return createRunningGenerationRecord({
    ...input,
    mode: "generate"
  }, user);
}

export async function createRunningReferenceImageGeneration(
  input: EditImageProviderInput,
  user?: CurrentUser
): Promise<{ record: GenerationRecord; input: EditImageProviderInput }> {
  const referenceAssetIds = await ensureReferenceAssetIds(input, user);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  return {
    record: await createRunningGenerationRecord({
      ...inputWithReferenceAssets,
      mode: "edit"
    }, user),
    input: inputWithReferenceAssets
  };
}

export async function finishTextToImageGeneration(
  generationId: string,
  input: ImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  user?: CurrentUser
): Promise<GenerationRecord> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    {
      ...input,
      mode: "generate"
    },
    outputs,
    user
  );
}

export async function finishReferenceImageGeneration(
  generationId: string,
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  user?: CurrentUser
): Promise<GenerationRecord> {
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(input, provider, signal)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    {
      ...input,
      mode: "edit"
    },
    outputs,
    user
  );
}

export async function getGenerationRecord(generationId: string, user?: CurrentUser): Promise<GenerationRecord | undefined> {
  return readGenerationRecord(generationId, user);
}

export async function ensureGenerationIdAvailableForUser(generationId: string, user?: CurrentUser): Promise<void> {
  const existing = await readGenerationRecordOwner(generationId);
  if (!existing || !user || existing.userId === user.id || user.role === "admin") {
    return;
  }

  throw new GenerationDomainError("generation_id_conflict", "同一生成 ID 已属于其他用户。", 409);
}

export async function cancelGenerationRecord(generationId: string, user?: CurrentUser): Promise<GenerationRecord | undefined> {
  const record = await updateGenerationRecordStatus(generationId, "cancelled", CANCELLED_GENERATION_ERROR, user);
  if (record) {
    await refundGenerationCreditsForFailures(generationId, record.count, record.count, user?.id);
    await updateGenerationAuditSafely(record);
  }
  return record;
}

export async function failGenerationRecord(generationId: string, error: string, user?: CurrentUser): Promise<GenerationRecord | undefined> {
  const record = await updateGenerationRecordStatus(generationId, "failed", sanitizeGenerationErrorMessage(error), user);
  if (record) {
    await refundGenerationCreditsForFailures(generationId, record.count, record.count, user?.id);
    await updateGenerationAuditSafely(record);
  }
  return record;
}

export async function markInterruptedGenerationRecordsFailed(): Promise<void> {
  await refundInterruptedGenerationCredits();
  await markInterruptedGenerationRecordsFailedInStore(INTERRUPTED_GENERATION_ERROR);
  await markInterruptedGenerationAuditsFailedSafely(INTERRUPTED_GENERATION_ERROR);
}

async function ensureReferenceAssetIds(input: EditImageProviderInput, user?: CurrentUser): Promise<string[]> {
  return Promise.all(
    input.referenceImages.map(async (referenceImage, index) => {
      const existingAssetId = await persistedReferenceAssetId(input.referenceAssetIds?.[index], user);
      if (existingAssetId) {
        return existingAssetId;
      }

      const savedReferenceAsset = await saveReferenceImageInput(referenceImage, user);
      return savedReferenceAsset.id;
    })
  );
}

async function persistedReferenceAssetId(assetId: string | undefined, user?: CurrentUser): Promise<string | undefined> {
  if (!assetId) {
    return undefined;
  }

  for (const candidateAssetId of persistedReferenceAssetIdCandidates(assetId)) {
    if (await assetExists(candidateAssetId, user)) {
      return candidateAssetId;
    }
  }

  return undefined;
}

function persistedReferenceAssetIdCandidates(assetId: string): string[] {
  const trimmedAssetId = assetId.trim();
  const candidates = [trimmedAssetId];
  const tldrawAssetMatch = /^asset:(.+)$/u.exec(trimmedAssetId);
  if (tldrawAssetMatch?.[1]) {
    candidates.push(tldrawAssetMatch[1]);
  }

  return candidates.filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);
}

export async function saveReferenceImageInput(input: ReferenceImageInput, user?: CurrentUser): Promise<GeneratedAsset> {
  const parsed = referenceDataUrlToBytes(input);
  const imageSize = await readImageSize(parsed.bytes);
  if (!imageSize) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image dimensions could not be read.", 400);
  }

  const assetId = randomUUID();
  const extension = extensionForMimeType(parsed.mimeType);
  const fileName = `${assetId}.${extension}`;
  const relativePath = storedAssetRelativePathForFileName(fileName);
  const createdAt = new Date().toISOString();

  await writeStoredAssetBytes(relativePath, parsed.bytes, parsed.mimeType);
  await insertAsset({
    id: assetId,
    userId: user?.id ?? null,
    fileName,
    relativePath,
    mimeType: parsed.mimeType,
    width: imageSize.width,
    height: imageSize.height,
    createdAt
  });

  return {
    id: assetId,
    url: storedAssetAccessUrl({ id: assetId, relativePath, fileName, mimeType: parsed.mimeType }),
    fileName,
    mimeType: parsed.mimeType,
    width: imageSize.width,
    height: imageSize.height
  };
}

function referenceDataUrlToBytes(input: ReferenceImageInput): { bytes: Buffer; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像格式不受支持。", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像必须是 PNG、JPEG 或 WebP 格式。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像不能超过 50MB。", 400);
  }

  return {
    bytes,
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType
  };
}

function extensionForMimeType(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
}

export async function getStoredAssetFile(assetId: string): Promise<StoredAssetFile | undefined> {
  const asset = await findAssetById(assetId);
  if (!asset) {
    return undefined;
  }

  const filePath = resolveLocalAssetPath(asset.relativePath);
  if (!filePath && !asset.relativePath) {
    return undefined;
  }

  return {
    id: asset.id,
    fileName: asset.fileName,
    relativePath: asset.relativePath,
    filePath,
    mimeType: asset.mimeType
  };
}

export async function readStoredAsset(assetId: string): Promise<{ file: StoredAssetFile; bytes: Buffer } | undefined> {
  const file = await getStoredAssetFile(assetId);
  if (!file) {
    return undefined;
  }

  try {
    return {
      file,
      bytes: await readStoredAssetBytes(file.relativePath)
    };
  } catch {
    return undefined;
  }
}

export async function readStoredAssetMetadata(assetId: string): Promise<AssetMetadataResponse | undefined> {
  const asset = await findAssetById(assetId);
  if (!asset) {
    return undefined;
  }

  if (!usesOssAssetStorage() && !(await readStoredAsset(assetId))) {
    return undefined;
  }

  return {
    id: asset.id,
    width: asset.width,
    height: asset.height
  };
}

export async function getStoredAssetAccessUrl(
  assetId: string,
  disposition: "inline" | "attachment" = "inline"
): Promise<AssetAccessUrlResponse | undefined> {
  const asset = await findAssetById(assetId);
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: storedAssetAccessUrl(
      {
        id: asset.id,
        relativePath: asset.relativePath,
        fileName: asset.fileName,
        mimeType: asset.mimeType
      },
      { disposition }
    ),
    expiresInSeconds: assetStorageSignedUrlExpiresInSeconds()
  };
}

async function generateSingleOutput(input: ImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await provider.generate(
      {
        ...input,
        count: 1
      },
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "上游图像服务没有返回图像结果。", 502);
    }

    const saved = await saveProviderImage(providerImage, input, signal);

    return {
      id: outputId,
      status: "succeeded",
      asset: saved.asset
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      error: errorToMessage(error)
    };
  }
}

async function editSingleOutput(input: EditImageProviderInput, provider: ImageProvider, signal?: AbortSignal): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await provider.edit(
      {
        ...input,
        count: 1
      },
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "上游图像服务没有返回图像结果。", 502);
    }

    const saved = await saveProviderImage(providerImage, input, signal);

    return {
      id: outputId,
      status: "succeeded",
      asset: saved.asset
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      error: errorToMessage(error)
    };
  }
}

async function saveProviderImage(image: ProviderImage, input: ImageProviderInput, _signal?: AbortSignal): Promise<SavedProviderImage> {
  const assetId = randomUUID();
  const fileName = `${assetId}.${input.outputFormat === "jpeg" ? "jpg" : input.outputFormat}`;
  const relativePath = storedAssetRelativePathForFileName(fileName);
  const mimeType = mimeTypes[input.outputFormat];
  const bytes = Buffer.from(image.b64Json, "base64");
  const imageSize = await readImageSize(bytes);

  if (!imageSize) {
    throw new ProviderError("unsupported_provider_behavior", "Generated image dimensions could not be read.", 502);
  }

  await writeStoredAssetBytes(relativePath, bytes, mimeType);

  return {
    asset: {
      id: assetId,
      url: storedAssetAccessUrl({ id: assetId, relativePath, fileName, mimeType }),
      fileName,
      mimeType,
      width: imageSize.width,
      height: imageSize.height,
      relativePath
    }
  };
}

async function readImageSize(bytes: Buffer): Promise<ImageSize | undefined> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) {
      return undefined;
    }

    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch {
    return undefined;
  }
}

async function createRunningGenerationRecord(input: PersistedGenerationInput, user?: CurrentUser): Promise<GenerationRecord> {
  const createdAt = new Date().toISOString();
  const generationId = input.clientRequestId || randomUUID();
  await ensureGenerationIdAvailableForUser(generationId, user);
  const existing = await readGenerationRecord(generationId, user);
  if (existing) {
    return existing;
  }

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  await insertGenerationRecord(
    {
      id: generationId,
      userId: user?.id ?? null,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status: "running",
      error: null,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    },
    referenceAssetIds
  );

  return {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status: "running",
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: []
  };
}

async function completeGenerationRecord(
  generationId: string,
  input: PersistedGenerationInput,
  outputs: BatchOutputResult[],
  user?: CurrentUser
): Promise<GenerationRecord> {
  const existing = await readGenerationRecord(generationId, user);
  if (existing && isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? `${failureCount} images failed.` : undefined;
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  await completeGenerationRecordWithOutputs({
    generationId,
    status,
    error: error ?? null,
    referenceAssetId: primaryReferenceAssetId ?? null,
    outputs: outputs.map((output) => generationOutputWithVisibility(output, input)),
    failedCount: failureCount,
    fallbackCount: input.count,
    expectedUserId: user?.id
  });

  const completedRecord = (await readGenerationRecord(generationId, user)) ?? {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    outputs: outputs.map((output) => toGenerationOutput(generationOutputWithVisibility(output, input)))
  };
  await updateGenerationAuditSafely(completedRecord);

  return completedRecord;
}

async function saveCompletedGenerationRecord(
  generationId: string,
  input: PersistedGenerationInput,
  outputs: BatchOutputResult[],
  user?: CurrentUser
): Promise<GenerationRecord> {
  const createdAt = new Date().toISOString();
  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? `${failureCount} 张图像生成失败。` : undefined;

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  await insertGenerationRecord(
    {
      id: generationId,
      userId: user?.id ?? null,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status,
      error: error ?? null,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    },
    referenceAssetIds
  );
  await insertGenerationOutputs(generationId, outputs.map((output) => generationOutputWithVisibility(output, input)));

  const completedRecord = {
    id: generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: outputs.map((output) => toGenerationOutput(generationOutputWithVisibility(output, input)))
  };
  await updateGenerationAuditSafely(completedRecord);

  return completedRecord;
}

async function updateGenerationRecordStatus(
  generationId: string,
  status: Extract<GenerationStatus, "cancelled" | "failed">,
  error: string,
  user?: CurrentUser
): Promise<GenerationRecord | undefined> {
  const owner = await readGenerationRecordOwner(generationId);
  if (!owner || (user && owner.userId !== user.id && user.role !== "admin")) {
    return undefined;
  }
  const existing = await readGenerationRecord(generationId);
  if (!existing) {
    return undefined;
  }

  if (isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  await updateGenerationRecordStatusInStore(generationId, status, error);

  return readGenerationRecord(generationId);
}

async function updateGenerationAuditSafely(record: GenerationRecord): Promise<void> {
  try {
    await updateGenerationAuditFromRecord(record);
  } catch (error) {
    console.warn(`Generation audit update failed: ${errorToMessage(error)}`);
  }
}

async function markInterruptedGenerationAuditsFailedSafely(errorMessage: string): Promise<void> {
  try {
    await markInterruptedGenerationAuditsFailed(errorMessage);
  } catch (error) {
    console.warn(`Generation audit interruption update failed: ${errorToMessage(error)}`);
  }
}

function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function resolveGenerationStatus(successCount: number, failureCount: number): GenerationStatus {
  if (successCount > 0 && failureCount > 0) {
    return "partial";
  }
  if (successCount > 0) {
    return "succeeded";
  }
  return "failed";
}

function toGenerationOutput(output: BatchOutputResult): GenerationOutput {
  return {
    id: output.id,
    status: output.status,
    asset: output.asset,
    error: output.error,
    isPublic: output.isPublic,
    publicTitle: output.publicTitle
  };
}

function generationOutputWithVisibility(output: BatchOutputResult, input: PersistedGenerationInput): BatchOutputResult {
  return {
    ...output,
    isPublic: output.status === "succeeded" && input.isPublic === true,
    publicTitle: undefined
  };
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function errorToMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    return sanitizeGenerationErrorMessage(error.message);
  }
  if (error instanceof Error && error.message) {
    return sanitizeGenerationErrorMessage(error.message);
  }
  return "图像生成失败，请重试。";
}

function sanitizeGenerationErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .trim()
    .slice(0, 1200);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
