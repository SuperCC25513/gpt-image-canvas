import { rm, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import OSS from "ali-oss";
import { ossStorageConfig, type OssStorageConfig } from "../app-config.js";
import { databaseConfig } from "../database-config.js";
import { runtimePaths } from "../runtime.js";

export interface AssetStorageAdapter<TPutInput, TLocation> {
  putObject(input: TPutInput): Promise<void>;
  getObject(location: TLocation): Promise<Buffer>;
  deleteObject(location: TLocation): Promise<void>;
}

export interface LocalAssetPutInput {
  filePath: string;
  bytes: Buffer;
}

export interface LocalAssetLocation {
  filePath: string;
}

export interface OssAssetPutInput {
  objectKey: string;
  bytes: Buffer;
  mimeType: string;
}

export interface OssAssetLocation {
  objectKey: string;
}

export type AssetUrlDisposition = "inline" | "attachment";

export interface StoredAssetUrlInput {
  id: string;
  relativePath: string;
  fileName: string;
  mimeType?: string;
}

export class LocalAssetStorageAdapter implements AssetStorageAdapter<LocalAssetPutInput, LocalAssetLocation> {
  async putObject(input: LocalAssetPutInput): Promise<void> {
    await writeFile(input.filePath, input.bytes);
  }

  async getObject(location: LocalAssetLocation): Promise<Buffer> {
    return readFile(location.filePath);
  }

  async deleteObject(location: LocalAssetLocation): Promise<void> {
    await rm(location.filePath, { force: true });
  }
}

export class OssAssetStorageAdapter implements AssetStorageAdapter<OssAssetPutInput, OssAssetLocation> {
  private readonly client: OSS;

  constructor(private readonly config: OssStorageConfig) {
    this.client = new OSS({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucketName,
      endpoint: config.endpoint,
      internal: config.internal,
      secure: true
    });
  }

  async putObject(input: OssAssetPutInput): Promise<void> {
    assertOssObjectKey(input.objectKey, this.config);
    if (input.bytes.byteLength > this.config.uploadMaxBytes) {
      throw new Error(`Asset exceeds OSS upload limit of ${this.config.uploadMaxBytes} bytes.`);
    }

    await this.client.put(input.objectKey, input.bytes, {
      mime: input.mimeType,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable"
      }
    });
  }

  async getObject(location: OssAssetLocation): Promise<Buffer> {
    assertOssObjectKey(location.objectKey, this.config);
    const result = await this.client.get(location.objectKey);
    if (Buffer.isBuffer(result.content)) {
      return result.content;
    }
    if (result.content instanceof Uint8Array) {
      return Buffer.from(result.content);
    }
    if (typeof result.content === "string") {
      return Buffer.from(result.content);
    }

    throw new Error("OSS object response did not include readable content.");
  }

  async deleteObject(location: OssAssetLocation): Promise<void> {
    assertOssObjectKey(location.objectKey, this.config);
    try {
      await this.client.delete(location.objectKey);
    } catch (error) {
      if (!isOssNotFound(error)) {
        throw error;
      }
    }
  }

  async objectExists(location: OssAssetLocation): Promise<boolean> {
    assertOssObjectKey(location.objectKey, this.config);
    try {
      await this.client.head(location.objectKey);
      return true;
    } catch (error) {
      if (isOssNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  signedGetUrl(
    location: OssAssetLocation,
    options: { disposition?: AssetUrlDisposition; fileName?: string } = {}
  ): string {
    assertOssObjectKey(location.objectKey, this.config);
    const disposition = contentDisposition(options.disposition ?? "inline", options.fileName);
    return this.client.signatureUrl(location.objectKey, {
      expires: this.config.expireSeconds,
      method: "GET",
      response: disposition ? { "content-disposition": disposition } : undefined
    });
  }
}

const localAssetStorage = new LocalAssetStorageAdapter();
let ossAssetStorage: OssAssetStorageAdapter | undefined;

export function usesOssAssetStorage(): boolean {
  return databaseConfig.driver === "mysql";
}

export function assertAssetStorageConfigured(): void {
  if (usesOssAssetStorage() && !ossStorageConfig) {
    throw new Error(
      "OSS config is required when USE_MYSQL=true. Provide OSS_* values in .env or runtime environment variables."
    );
  }
}

export function storedAssetRelativePathForFileName(fileName: string): string {
  const safeFileName = safeFileSegment(fileName);
  return usesOssAssetStorage() ? ossObjectKeyForFileName(safeFileName) : `assets/${safeFileName}`;
}

export async function writeStoredAssetBytes(relativePath: string, bytes: Buffer, mimeType: string): Promise<void> {
  if (usesOssAssetStorage()) {
    await getOssAssetStorage().putObject({ objectKey: relativePath, bytes, mimeType });
    return;
  }

  const filePath = resolveLocalAssetPath(relativePath);
  if (!filePath) {
    throw new Error("Invalid local asset path.");
  }

  await localAssetStorage.putObject({ filePath, bytes });
}

export async function readStoredAssetBytes(relativePath: string): Promise<Buffer> {
  if (usesOssAssetStorage()) {
    return getOssAssetStorage().getObject({ objectKey: relativePath });
  }

  const filePath = resolveLocalAssetPath(relativePath);
  if (!filePath) {
    throw new Error("Invalid local asset path.");
  }

  return localAssetStorage.getObject({ filePath });
}

export function resolveLocalAssetPath(relativePath: string): string | undefined {
  const filePath = resolve(runtimePaths.dataDir, relativePath);
  return isInsideDirectory(filePath, runtimePaths.assetsDir) ? filePath : undefined;
}

export function storedAssetAccessUrl(
  asset: StoredAssetUrlInput,
  options: { disposition?: AssetUrlDisposition } = {}
): string {
  const disposition = options.disposition ?? "inline";
  if (!usesOssAssetStorage()) {
    const encodedId = encodeURIComponent(asset.id);
    return disposition === "attachment" ? `/api/assets/${encodedId}/download` : `/api/assets/${encodedId}`;
  }

  return signedOssObjectUrl(asset.relativePath, {
    disposition,
    fileName: asset.fileName
  });
}

export function assetStorageSignedUrlExpiresInSeconds(): number | undefined {
  return usesOssAssetStorage() ? requireOssStorageConfig().expireSeconds : undefined;
}

export function previewObjectKeyForAsset(assetId: string, width: number): string {
  const safeAssetId = safeFileSegment(assetId);
  return `${requireOssStorageConfig().rootPath}previews/${safeAssetId}-${width}.webp`;
}

export async function writeOssObject(objectKey: string, bytes: Buffer, mimeType: string): Promise<void> {
  await getOssAssetStorage().putObject({ objectKey, bytes, mimeType });
}

export async function ossObjectExists(objectKey: string): Promise<boolean> {
  return getOssAssetStorage().objectExists({ objectKey });
}

export function signedOssObjectUrl(
  objectKey: string,
  options: { disposition?: AssetUrlDisposition; fileName?: string } = {}
): string {
  return getOssAssetStorage().signedGetUrl({ objectKey }, options);
}

function getOssAssetStorage(): OssAssetStorageAdapter {
  if (!ossAssetStorage) {
    ossAssetStorage = new OssAssetStorageAdapter(requireOssStorageConfig());
  }

  return ossAssetStorage;
}

function requireOssStorageConfig(): OssStorageConfig {
  assertAssetStorageConfigured();
  if (!ossStorageConfig) {
    throw new Error("OSS storage config is unavailable.");
  }

  return ossStorageConfig;
}

function ossObjectKeyForFileName(fileName: string): string {
  return `${requireOssStorageConfig().rootPath}${fileName}`;
}

function assertOssObjectKey(objectKey: string, config: OssStorageConfig): void {
  if (
    !objectKey ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Invalid OSS object key.");
  }

  if (config.rootPath && !objectKey.startsWith(config.rootPath)) {
    throw new Error("OSS object key is outside the configured root path.");
  }
}

function contentDisposition(disposition: AssetUrlDisposition, fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }

  return `${disposition}; filename="${safeFileSegment(fileName)}"`;
}

function safeFileSegment(value: string): string {
  const safeValue = value.replace(/[^a-zA-Z0-9._-]/gu, "_");
  if (!safeValue) {
    throw new Error("Invalid file name.");
  }

  return safeValue;
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}

function isOssNotFound(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  const code = (error as { code?: unknown })?.code;
  return status === 404 || code === "NoSuchKey" || code === "NotFound";
}
