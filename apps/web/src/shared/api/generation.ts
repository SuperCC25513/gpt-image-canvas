import {
  CREDIT_TRANSACTION_REASONS,
  IMAGE_QUALITIES,
  OUTPUT_FORMATS,
  REDEMPTION_CODE_STATUSES,
  type CreditTransaction,
  type CreditTransactionListResponse,
  type AdminCreateRedemptionCodesResponse,
  type GalleryImageItem,
  type GalleryResponse,
  type GeneratedAsset,
  type GenerationOutput,
  type GenerationRecord,
  type GenerationResponse,
  type PublicGalleryResponse,
  type RedeemCreditCodeResponse,
  type RedemptionCodeListResponse,
  type RedemptionCodeSummary
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, type Locale } from "../i18n";

const GENERATION_STATUSES = ["pending", "running", "succeeded", "partial", "failed", "cancelled"] as const;
const OUTPUT_STATUSES = ["succeeded", "failed"] as const;

export async function readApiErrorMessage(response: Response, locale: Locale, fallbackText: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText,
      locale,
      status: response.status
    });
  } catch {
    return fallbackText;
  }
}

export function isGenerationResponse(value: unknown): value is GenerationResponse {
  return isRecord(value) && isGenerationRecord(value.record);
}

export function isGenerationRecord(value: unknown): value is GenerationRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isImageMode(value.mode) &&
    typeof value.prompt === "string" &&
    typeof value.effectivePrompt === "string" &&
    typeof value.presetId === "string" &&
    isImageSize(value.size) &&
    typeof value.quality === "string" &&
    (IMAGE_QUALITIES as readonly string[]).includes(value.quality) &&
    typeof value.outputFormat === "string" &&
    (OUTPUT_FORMATS as readonly string[]).includes(value.outputFormat) &&
    isFiniteNumber(value.count) &&
    typeof value.status === "string" &&
    (GENERATION_STATUSES as readonly string[]).includes(value.status) &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.referenceAssetId === undefined || typeof value.referenceAssetId === "string") &&
    (value.referenceAssetIds === undefined || (Array.isArray(value.referenceAssetIds) && value.referenceAssetIds.every((item) => typeof item === "string"))) &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isGenerationOutput)
  );
}

export function isGalleryResponse(value: unknown): value is GalleryResponse | PublicGalleryResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isGalleryImageItem);
}

export function isCreditTransactionListResponse(value: unknown): value is CreditTransactionListResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isCreditTransaction);
}

export function isRedemptionCodeListResponse(value: unknown): value is RedemptionCodeListResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isRedemptionCodeSummary);
}

export function isAdminCreateRedemptionCodesResponse(value: unknown): value is AdminCreateRedemptionCodesResponse {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isRedemptionCodeSummary);
}

export function isRedeemCreditCodeResponse(value: unknown): value is RedeemCreditCodeResponse {
  return (
    isRecord(value) &&
    isCurrentUser(value.user) &&
    isCreditTransaction(value.transaction) &&
    isRecord(value.redemption) &&
    typeof value.redemption.codeId === "string" &&
    typeof value.redemption.codeShort === "string" &&
    isFiniteNumber(value.redemption.creditsAwarded) &&
    typeof value.redemption.redeemedAt === "string"
  );
}

export function isGalleryImageItem(value: unknown): value is GalleryImageItem {
  return (
    isRecord(value) &&
    typeof value.outputId === "string" &&
    typeof value.generationId === "string" &&
    isImageMode(value.mode) &&
    typeof value.prompt === "string" &&
    typeof value.effectivePrompt === "string" &&
    typeof value.presetId === "string" &&
    isImageSize(value.size) &&
    typeof value.quality === "string" &&
    (IMAGE_QUALITIES as readonly string[]).includes(value.quality) &&
    typeof value.outputFormat === "string" &&
    (OUTPUT_FORMATS as readonly string[]).includes(value.outputFormat) &&
    typeof value.createdAt === "string" &&
    isGeneratedAsset(value.asset) &&
    typeof value.isPublic === "boolean" &&
    (value.publishedAt === undefined || typeof value.publishedAt === "string") &&
    (value.publicTitle === undefined || typeof value.publicTitle === "string") &&
    (value.authorName === undefined || typeof value.authorName === "string") &&
    (value.providerLabel === undefined || typeof value.providerLabel === "string")
  );
}

export function isActiveGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "pending" || record.status === "running";
}

export function isTerminalGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "succeeded" || record.status === "partial" || record.status === "failed" || record.status === "cancelled";
}

export function generatedAssetsForRecord(record: GenerationRecord): GeneratedAsset[] {
  return record.outputs.flatMap((output) => (output.status === "succeeded" && output.asset ? [output.asset] : []));
}

function isCreditTransaction(value: unknown): value is CreditTransaction {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    isFiniteNumber(value.delta) &&
    typeof value.reason === "string" &&
    (CREDIT_TRANSACTION_REASONS as readonly string[]).includes(value.reason) &&
    (value.relatedGenerationId === undefined || typeof value.relatedGenerationId === "string") &&
    (value.relatedOutputId === undefined || typeof value.relatedOutputId === "string") &&
    (value.relatedCheckinDate === undefined || typeof value.relatedCheckinDate === "string") &&
    (value.relatedRedemptionCodeId === undefined || typeof value.relatedRedemptionCodeId === "string") &&
    (value.adminNote === undefined || typeof value.adminNote === "string") &&
    typeof value.createdAt === "string"
  );
}

function isRedemptionCodeSummary(value: unknown): value is RedemptionCodeSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.code === "string" &&
    isFiniteNumber(value.credits) &&
    typeof value.status === "string" &&
    (REDEMPTION_CODE_STATUSES as readonly string[]).includes(value.status) &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string") &&
    (value.redeemedByUserId === undefined || typeof value.redeemedByUserId === "string") &&
    (value.redeemedByUserName === undefined || typeof value.redeemedByUserName === "string") &&
    (value.redeemedByUserEmail === undefined || typeof value.redeemedByUserEmail === "string") &&
    (value.redeemedAt === undefined || typeof value.redeemedAt === "string") &&
    (value.createdByAdminId === undefined || typeof value.createdByAdminId === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isCurrentUser(value: unknown): value is RedeemCreditCodeResponse["user"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    (value.role === "admin" || value.role === "user") &&
    (value.status === "active" || value.status === "pending" || value.status === "disabled") &&
    isFiniteNumber(value.credits) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isGenerationOutput(value: unknown): value is GenerationOutput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    (OUTPUT_STATUSES as readonly string[]).includes(value.status) &&
    (value.asset === undefined || isGeneratedAsset(value.asset)) &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.isPublic === undefined || typeof value.isPublic === "boolean") &&
    (value.publishedAt === undefined || typeof value.publishedAt === "string") &&
    (value.publicTitle === undefined || typeof value.publicTitle === "string")
  );
}

function isGeneratedAsset(value: unknown): value is GeneratedAsset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

function isImageSize(value: unknown): value is GalleryImageItem["size"] {
  return isRecord(value) && isFiniteNumber(value.width) && isFiniteNumber(value.height);
}

function isImageMode(value: unknown): value is GalleryImageItem["mode"] {
  return value === "generate" || value === "edit";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
