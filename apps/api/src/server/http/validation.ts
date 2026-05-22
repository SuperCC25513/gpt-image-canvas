import {
  GENERATION_COUNTS,
  IMAGE_QUALITIES,
  MAX_REFERENCE_IMAGES,
  OUTPUT_FORMATS,
  PROVIDER_SOURCE_IDS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  USER_ROLES,
  USER_STATUSES,
  composePrompt,
  validateSceneImageSize,
  type AdminCreditAdjustmentRequest,
  type AdminSettingsUpdateRequest,
  type AdminUserUpdateRequest,
  type GenerationCount,
  type CurrentUser,
  type ImageQuality,
  type ImageSize,
  type LoginRequest,
  type OutputFormat,
  type ProviderSourceId,
  type ReferenceImageInput,
  type RegisterRequest,
  type SaveAgentLlmConfigRequest,
  type SaveLocalOpenAIProviderConfig,
  type SaveProviderConfigRequest,
  type StylePresetId,
  type UpdateGalleryVisibilityRequest
} from "../../domain/contracts.js";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import { userCanReadAsset } from "../../domain/storage/store.js";
import { isProviderSourceOrder } from "../../domain/providers/provider-config.js";
import type { EditImageProviderInput, ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, type ErrorResponseBody, type ParseResult } from "./errors.js";

const MAX_PROJECT_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_CLIENT_REQUEST_ID_LENGTH = 120;
const MAX_AUTH_NAME_LENGTH = 80;
const MAX_AUTH_EMAIL_LENGTH = 254;
const MIN_AUTH_PASSWORD_LENGTH = 8;
const MAX_ADMIN_NOTE_LENGTH = 240;

export interface ProjectPayload {
  name?: string;
  snapshotJson: string;
}

export function logProjectSaveRejected(error: ErrorResponseBody, request: Request): void {
  console.warn(
    `Project save rejected: ${error.error.code}. ${error.error.message}${formatRequestBodySummary(request)}`
  );
}

function formatRequestBodySummary(request: Request): string {
  const contentType = sanitizeHeaderValue(request.headers.get("content-type"));
  const contentLength = sanitizeHeaderValue(request.headers.get("content-length"));
  const transferEncoding = sanitizeHeaderValue(request.headers.get("transfer-encoding"));
  const bodySize = contentLength
    ? `content-length=${contentLength}`
    : transferEncoding
      ? `transfer-encoding=${transferEncoding}`
      : "content-length=unknown";

  return ` (${bodySize}, content-type=${contentType || "missing"})`;
}

function sanitizeHeaderValue(value: string | null): string {
  return (value ?? "").replace(/[\r\n]/gu, " ").trim().slice(0, 120);
}

export function parseGeneratePayload(input: unknown): ParseResult<ImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  return {
    ok: true,
    value: base.value
  };
}

export function parseRegisterPayload(input: unknown): ParseResult<RegisterRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_auth_request", "注册请求必须是 JSON 对象。")
    };
  }

  const name = parseAuthName(input.name);
  if (!name) {
    return {
      ok: false,
      error: errorResponse("invalid_auth_request", "请输入有效的用户名称。")
    };
  }

  const email = parseAuthEmail(input.email);
  if (!email) {
    return {
      ok: false,
      error: errorResponse("invalid_auth_request", "请输入有效的邮箱地址。")
    };
  }

  const password = parseAuthPassword(input.password);
  if (!password) {
    return {
      ok: false,
      error: errorResponse("invalid_auth_request", `密码至少需要 ${MIN_AUTH_PASSWORD_LENGTH} 个字符。`)
    };
  }

  return {
    ok: true,
    value: {
      name,
      email,
      password
    }
  };
}

export function parseLoginPayload(input: unknown): ParseResult<LoginRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_auth_request", "登录请求必须是 JSON 对象。")
    };
  }

  const email = parseAuthEmail(input.email);
  const password = typeof input.password === "string" ? input.password : undefined;
  if (!email || !password) {
    return {
      ok: false,
      error: errorResponse("invalid_auth_request", "请输入邮箱和密码。")
    };
  }

  return {
    ok: true,
    value: {
      email,
      password
    }
  };
}

export function parseCodexPollPayload(input: unknown): ParseResult<{ deviceAuthId: string; userCode: string }> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Codex 登录轮询请求必须是 JSON 对象。")
    };
  }

  const deviceAuthId = parseOptionalString(input.deviceAuthId);
  const userCode = parseOptionalString(input.userCode);

  if (!deviceAuthId || !userCode) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Codex 登录轮询缺少设备码。")
    };
  }

  return {
    ok: true,
    value: {
      deviceAuthId,
      userCode
    }
  };
}

export function parseAdminUserPatchPayload(input: unknown): ParseResult<AdminUserUpdateRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_admin_request", "用户更新请求必须是 JSON 对象。")
    };
  }

  const value: AdminUserUpdateRequest = {};
  if (Object.hasOwn(input, "role")) {
    if (typeof input.role !== "string" || !USER_ROLES.includes(input.role as (typeof USER_ROLES)[number])) {
      return {
        ok: false,
        error: errorResponse("invalid_admin_request", "不支持的用户角色。")
      };
    }
    value.role = input.role as AdminUserUpdateRequest["role"];
  }

  if (Object.hasOwn(input, "status")) {
    if (typeof input.status !== "string" || !USER_STATUSES.includes(input.status as (typeof USER_STATUSES)[number])) {
      return {
        ok: false,
        error: errorResponse("invalid_admin_request", "不支持的用户状态。")
      };
    }
    value.status = input.status as AdminUserUpdateRequest["status"];
  }

  if (!value.role && !value.status) {
    return {
      ok: false,
      error: errorResponse("invalid_admin_request", "至少需要提供角色或状态。")
    };
  }

  return {
    ok: true,
    value
  };
}

export function parseAdminCreditAdjustmentPayload(input: unknown): ParseResult<AdminCreditAdjustmentRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_admin_credit_adjustment", "积分调整请求必须是 JSON 对象。")
    };
  }

  if (input.mode !== "set" && input.mode !== "delta") {
    return {
      ok: false,
      error: errorResponse("invalid_admin_credit_adjustment", "积分调整模式必须是 set 或 delta。")
    };
  }

  const amount = parseInteger(input.amount);
  if (amount === undefined || (input.mode === "set" && amount < 0)) {
    return {
      ok: false,
      error: errorResponse("invalid_admin_credit_adjustment", "积分数值必须是有效整数。")
    };
  }

  const note = typeof input.note === "string" ? input.note.trim().slice(0, MAX_ADMIN_NOTE_LENGTH) : undefined;
  return {
    ok: true,
    value: {
      mode: input.mode,
      amount,
      note: note || undefined
    }
  };
}

export function parseAdminSettingsPayload(input: unknown): ParseResult<AdminSettingsUpdateRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_admin_settings", "系统设置请求必须是 JSON 对象。")
    };
  }

  const value: AdminSettingsUpdateRequest = {};
  for (const key of ["allowRegistration", "requireApproval"] as const) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== "boolean") {
        return {
          ok: false,
          error: errorResponse("invalid_admin_settings", "开关设置必须是布尔值。")
        };
      }
      value[key] = input[key];
    }
  }

  for (const key of ["defaultCredits", "generationCreditCost", "checkinCredit"] as const) {
    if (Object.hasOwn(input, key)) {
      const amount = parseInteger(input[key]);
      if (amount === undefined || amount < 0) {
        return {
          ok: false,
          error: errorResponse("invalid_admin_settings", "积分设置必须是非负整数。")
        };
      }
      value[key] = amount;
    }
  }

  if (Object.hasOwn(input, "maxImagesPerRequest")) {
    const maxImagesPerRequest = parseInteger(input.maxImagesPerRequest);
    if (maxImagesPerRequest === undefined || maxImagesPerRequest < 1 || maxImagesPerRequest > Math.max(...GENERATION_COUNTS)) {
      return {
        ok: false,
        error: errorResponse("invalid_admin_settings", `单次生成数量上限必须在 1-${Math.max(...GENERATION_COUNTS)} 之间。`)
      };
    }
    value.maxImagesPerRequest = maxImagesPerRequest;
  }

  if (Object.keys(value).length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_admin_settings", "至少需要提供一个系统设置。")
    };
  }

  return {
    ok: true,
    value
  };
}

export async function parseEditPayload(input: unknown, user?: CurrentUser): Promise<ParseResult<EditImageProviderInput>> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", "编辑图像需要提供 1-3 张参考图像。")
    };
  }

  const referenceImages = parseReferenceImages(input);
  if (!referenceImages.ok) {
    return referenceImages;
  }

  const referenceAssetIds = parseReferenceAssetIds(input, referenceImages.value.length);
  if (!referenceAssetIds.ok) {
    return referenceAssetIds;
  }

  for (const referenceAssetId of referenceAssetIds.value) {
    const canRead = user ? await userCanReadAsset(referenceAssetId, user) : Boolean(await getStoredAssetFile(referenceAssetId));
    if (!canRead) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "找不到可记录的参考图像资源。")
      };
    }
  }

  return {
    ok: true,
    value: {
      ...base.value,
      referenceImages: referenceImages.value,
      referenceImage: referenceImages.value[0],
      referenceAssetIds: referenceAssetIds.value.length > 0 ? referenceAssetIds.value : undefined,
      referenceAssetId: referenceAssetIds.value[0]
    }
  };
}

export function parseGalleryVisibilityPayload(input: unknown): ParseResult<UpdateGalleryVisibilityRequest> {
  if (!isRecord(input) || typeof input.isPublic !== "boolean") {
    return {
      ok: false,
      error: errorResponse("invalid_gallery_visibility_request", "公开状态请求必须包含 isPublic。")
    };
  }

  if (input.publicTitle !== undefined && typeof input.publicTitle !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_gallery_visibility_request", "公开标题必须是字符串。")
    };
  }

  return {
    ok: true,
    value: {
      isPublic: input.isPublic,
      publicTitle: typeof input.publicTitle === "string" ? input.publicTitle : undefined
    }
  };
}

function parseReferenceImages(input: Record<string, unknown>): ParseResult<ReferenceImageInput[]> {
  const rawReferenceImages = Array.isArray(input.referenceImages)
    ? input.referenceImages
    : isRecord(input.referenceImage)
      ? [input.referenceImage]
      : undefined;

  if (!rawReferenceImages) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", "编辑图像需要提供 1-3 张参考图像。")
    };
  }

  if (rawReferenceImages.length < 1 || rawReferenceImages.length > MAX_REFERENCE_IMAGES) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", `参考图像数量必须是 1-${MAX_REFERENCE_IMAGES} 张。`)
    };
  }

  const referenceImages: ReferenceImageInput[] = [];
  for (const rawReferenceImage of rawReferenceImages) {
    if (!isRecord(rawReferenceImage)) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "参考图像格式不受支持。")
      };
    }

    const dataUrl = rawReferenceImage.dataUrl;
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "参考图像格式不受支持。")
      };
    }

    const fileName = rawReferenceImage.fileName;
    referenceImages.push({
      dataUrl,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim() : undefined
    });
  }

  return {
    ok: true,
    value: referenceImages
  };
}

function parseReferenceAssetIds(input: Record<string, unknown>, referenceImageCount: number): ParseResult<string[]> {
  const legacyReferenceAssetId = parseOptionalString(input.referenceAssetId);
  const rawReferenceAssetIds = Array.isArray(input.referenceAssetIds)
    ? input.referenceAssetIds
    : legacyReferenceAssetId
      ? [legacyReferenceAssetId]
      : [];

  if (
    rawReferenceAssetIds.length > MAX_REFERENCE_IMAGES ||
    (rawReferenceAssetIds.length > 0 && rawReferenceAssetIds.length !== referenceImageCount)
  ) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "参考图像资源 ID 数量必须与参考图像数量一致。")
    };
  }

  const referenceAssetIds: string[] = [];
  for (const rawReferenceAssetId of rawReferenceAssetIds) {
    const referenceAssetId = parseOptionalString(rawReferenceAssetId);
    if (!referenceAssetId) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "参考图像资源 ID 格式不受支持。")
      };
    }

    referenceAssetIds.push(referenceAssetId);
  }

  return {
    ok: true,
    value: referenceAssetIds
  };
}

export function parseAgentLlmConfigPayload(input: unknown): ParseResult<SaveAgentLlmConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM config payload must be a JSON object.")
    };
  }

  if (Object.hasOwn(input, "apiKey") && typeof input.apiKey !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM API key must be a string.")
    };
  }

  if (typeof input.baseUrl !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM base URL must be a string.")
    };
  }

  if (typeof input.model !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM model must be a string.")
    };
  }

  if (typeof input.timeoutMs !== "number" || !Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM timeout must be a positive integer.")
    };
  }

  if (typeof input.supportsVision !== "boolean") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM supportsVision must be a boolean.")
    };
  }

  return {
    ok: true,
    value: {
      apiKey: stringValue(input.apiKey),
      preserveApiKey: input.preserveApiKey === true,
      baseUrl: input.baseUrl,
      model: input.model,
      timeoutMs: input.timeoutMs,
      supportsVision: input.supportsVision
    }
  };
}

export function parseProviderConfigPayload(input: unknown): ParseResult<SaveProviderConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Provider config payload must be a JSON object.")
    };
  }

  const sourceOrder = parseProviderSourceOrderPayload(input.sourceOrder);
  if (!sourceOrder.ok) {
    return sourceOrder;
  }

  if (input.localOpenAI === undefined) {
    return {
      ok: true,
      value: {
        sourceOrder: sourceOrder.value
      }
    };
  }

  const localOpenAI = parseLocalOpenAIProviderConfig(input.localOpenAI);
  if (!localOpenAI.ok) {
    return localOpenAI;
  }

  return {
    ok: true,
    value: {
      sourceOrder: sourceOrder.value,
      localOpenAI: localOpenAI.value
    }
  };
}

function parseProviderSourceOrderPayload(input: unknown): ParseResult<ProviderSourceId[]> {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_source_order", "Provider source order must be an array.")
    };
  }

  if (!isProviderSourceOrder(input)) {
    return {
      ok: false,
      error: errorResponse(
        "invalid_provider_source_order",
        `Provider source order must contain each supported source exactly once: ${PROVIDER_SOURCE_IDS.join(", ")}.`
      )
    };
  }

  return {
    ok: true,
    value: [...input]
  };
}

function parseLocalOpenAIProviderConfig(input: unknown): ParseResult<SaveLocalOpenAIProviderConfig> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Custom OpenAI config must be a JSON object.")
    };
  }

  const config: SaveLocalOpenAIProviderConfig = {
    preserveApiKey: input.preserveApiKey === true
  };

  if (Object.hasOwn(input, "apiKey")) {
    if (typeof input.apiKey !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI API key must be a string.")
      };
    }
    config.apiKey = input.apiKey;
  }

  if (Object.hasOwn(input, "baseUrl")) {
    if (typeof input.baseUrl !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI base URL must be a string.")
      };
    }
    config.baseUrl = input.baseUrl;
  }

  if (Object.hasOwn(input, "model")) {
    if (typeof input.model !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI model must be a string.")
      };
    }
    config.model = input.model;
  }

  if (Object.hasOwn(input, "timeoutMs")) {
    const timeoutMs = parsePositiveIntegerValue(input.timeoutMs);
    if (!timeoutMs) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI timeout must be a positive integer.")
      };
    }
    config.timeoutMs = timeoutMs;
  }

  return {
    ok: true,
    value: config
  };
}

function parseBaseImagePayload(input: unknown): ParseResult<ImageProviderInput> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "请求内容必须是 JSON 对象。")
    };
  }

  const prompt = input.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "请输入有效的提示词。")
    };
  }

  const stylePreset = parseStylePreset(input);
  if (!stylePreset.ok) {
    return stylePreset;
  }

  const size = parseSize(input.size);
  if (!size.ok) {
    return size;
  }

  const sizePresetId = parseOptionalString(input.sizePresetId) ?? parseOptionalString(input.scenePresetId) ?? parseSizePresetFromPresetId(input.presetId);
  const resolvedSize = validateSceneImageSize({
    size: size.value,
    sizePresetId
  });

  if (!resolvedSize.ok) {
    return {
      ok: false,
      error: errorResponse(resolvedSize.code, resolvedSize.message)
    };
  }

  const quality = parseQuality(input.quality);
  if (!quality.ok) {
    return quality;
  }

  const outputFormat = parseOutputFormat(input.outputFormat);
  if (!outputFormat.ok) {
    return outputFormat;
  }

  const count = parseCount(input.count);
  if (!count.ok) {
    return count;
  }

  const clientRequestId = parseClientRequestId(input.clientRequestId);
  if (!clientRequestId.ok) {
    return clientRequestId;
  }

  return {
    ok: true,
    value: {
      originalPrompt: prompt.trim(),
      clientRequestId: clientRequestId.value,
      presetId: stylePreset.value,
      prompt: composePrompt(prompt, stylePreset.value),
      size: resolvedSize.size,
      sizeApiValue: resolvedSize.apiValue,
      quality: quality.value,
      outputFormat: outputFormat.value,
      count: count.value,
      isPublic: input.isPublic === true
    }
  };
}

function parseClientRequestId(value: unknown): ParseResult<string | undefined> {
  if (value === undefined) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Client request ID must be a string.")
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (trimmed.length > MAX_CLIENT_REQUEST_ID_LENGTH || !/^[a-zA-Z0-9:_-]+$/u.test(trimmed)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Client request ID format is unsupported.")
    };
  }

  return {
    ok: true,
    value: trimmed
  };
}

function parseStylePreset(input: Record<string, unknown>): ParseResult<StylePresetId> {
  const presetId = parseOptionalString(input.stylePresetId) ?? parseStylePresetFromPresetId(input.presetId) ?? "none";

  if (!STYLE_PRESETS.some((preset) => preset.id === presetId)) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "不支持的风格预设。")
    };
  }

  return {
    ok: true,
    value: presetId as StylePresetId
  };
}

function parseSize(value: unknown): ParseResult<ImageSize> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: errorResponse("invalid_size", "请提供有效的图像尺寸。")
    };
  }

  return {
    ok: true,
    value: {
      width: parseDimension(value.width),
      height: parseDimension(value.height)
    }
  };
}

function parseQuality(value: unknown): ParseResult<ImageQuality> {
  if (value === undefined) {
    return {
      ok: true,
      value: "auto"
    };
  }

  if (typeof value === "string" && IMAGE_QUALITIES.includes(value as ImageQuality)) {
    return {
      ok: true,
      value: value as ImageQuality
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "不支持的图像质量设置。")
  };
}

function parseOutputFormat(value: unknown): ParseResult<OutputFormat> {
  if (value === undefined) {
    return {
      ok: true,
      value: "png"
    };
  }

  if (typeof value === "string" && OUTPUT_FORMATS.includes(value as OutputFormat)) {
    return {
      ok: true,
      value: value as OutputFormat
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "不支持的输出格式。")
  };
}

function parseCount(value: unknown): ParseResult<GenerationCount> {
  if (value === undefined) {
    return {
      ok: true,
      value: 1
    };
  }

  if (typeof value === "number" && GENERATION_COUNTS.includes(value as GenerationCount)) {
    return {
      ok: true,
      value: value as GenerationCount
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "生成数量只能是 1、2、4、8 或 16。")
  };
}

function parseDimension(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function parsePositiveIntegerValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAuthName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const name = value.trim().replace(/\s+/gu, " ");
  return name && name.length <= MAX_AUTH_NAME_LENGTH ? name : undefined;
}

function parseAuthEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_AUTH_EMAIL_LENGTH) {
    return undefined;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : undefined;
}

function parseAuthPassword(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.length >= MIN_AUTH_PASSWORD_LENGTH ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Request failed.";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseStylePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && STYLE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

function parseSizePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && SIZE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

export function parseProjectPayload(input: unknown):
  | {
      ok: true;
      value: ProjectPayload;
    }
  | {
      ok: false;
      error: { error: { code: string; message: string } };
    } {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_project", "Project payload must be a JSON object.")
    };
  }

  if (!Object.hasOwn(input, "snapshot")) {
    return {
      ok: false,
      error: errorResponse("missing_snapshot", "Project payload must include a snapshot.")
    };
  }

  const snapshot = input.snapshot;
  if (snapshot !== null && (!isRecord(snapshot) || Array.isArray(snapshot))) {
    return {
      ok: false,
      error: errorResponse("invalid_snapshot", "Project snapshot must be an object or null.")
    };
  }

  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = snapshotJson ? Buffer.byteLength(snapshotJson, "utf8") : 0;
  if (!snapshotJson || snapshotBytes > MAX_PROJECT_SNAPSHOT_BYTES) {
    return {
      ok: false,
      error: errorResponse(
        "invalid_snapshot",
        `Project snapshot is too large (${formatBytes(snapshotBytes)}). Maximum is ${formatBytes(MAX_PROJECT_SNAPSHOT_BYTES)}.`
      )
    };
  }

  const name = input.name;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_PROJECT_NAME_LENGTH) {
      return {
        ok: false,
        error: errorResponse("invalid_name", "Project name must be a non-empty string up to 120 characters.")
      };
    }

    return {
      ok: true,
      value: {
        name: name.trim(),
        snapshotJson
      }
    };
  }

  return {
    ok: true,
    value: {
      snapshotJson
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
