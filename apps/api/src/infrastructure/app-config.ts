import "./runtime.js";

export interface OssStorageConfig {
  endpoint: string;
  bucketName: string;
  accessKeyId: string;
  accessKeySecret: string;
  expireSeconds: number;
  uploadMaxBytes: number;
  rootPath: string;
  internal: boolean;
}

const DEFAULT_OSS_EXPIRE_SECONDS = 86_400;
const DEFAULT_OSS_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_OSS_ROOT_PATH = "assets/";

const ossEnvNames = [
  "OSS_BUCKET_NAME",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET"
];

export const ossStorageConfig = parseOssStorageConfig();

function parseOssStorageConfig(): OssStorageConfig | undefined {
  const hasCredentialConfig = ossEnvNames.some((name) => Boolean(process.env[name]?.trim()));
  if (!parseBoolean(process.env.USE_MYSQL) && !hasCredentialConfig) {
    return undefined;
  }

  const endpoint = requiredString(process.env.OSS_ENDPOINT, "OSS_ENDPOINT");
  const bucketName = requiredString(process.env.OSS_BUCKET_NAME, "OSS_BUCKET_NAME");
  const accessKeyId = requiredString(process.env.OSS_ACCESS_KEY_ID, "OSS_ACCESS_KEY_ID");
  const accessKeySecret = requiredString(process.env.OSS_ACCESS_KEY_SECRET, "OSS_ACCESS_KEY_SECRET");
  const expireSeconds = parsePositiveInteger(process.env.OSS_EXPIRE, DEFAULT_OSS_EXPIRE_SECONDS, "OSS_EXPIRE");
  const uploadMaxBytes = parsePositiveInteger(
    process.env.OSS_UPLOAD_MAX,
    DEFAULT_OSS_UPLOAD_MAX_BYTES,
    "OSS_UPLOAD_MAX"
  );
  const rootPath = normalizeOssRootPath(stringValue(process.env.OSS_ROOT_PATH) ?? DEFAULT_OSS_ROOT_PATH);
  const internal = parseBoolean(process.env.OSS_INTERNAL);

  return {
    endpoint,
    bucketName,
    accessKeyId,
    accessKeySecret,
    expireSeconds,
    uploadMaxBytes,
    rootPath,
    internal
  };
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value);
  if (!parsed) {
    throw new Error(`${label} is required when OSS storage is configured.`);
  }

  return parsed;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function parsePositiveInteger(value: unknown, fallback: number, label: string): number {
  const raw = stringValue(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseBoolean(value: unknown): boolean {
  const normalized = stringValue(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeOssRootPath(value: string): string {
  const normalized = value.trim().replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (!normalized) {
    return "";
  }

  if (normalized.includes("\\") || normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("oss.root-path must be a valid OSS object key prefix.");
  }

  return `${normalized}/`;
}
