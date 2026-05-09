import { randomUUID } from "node:crypto";
import { rm, readFile, writeFile } from "node:fs/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import COS from "cos-nodejs-sdk-v5";

export interface AssetStorageAdapter<TPutInput, TLocation> {
  putObject(input: TPutInput): Promise<AssetStoragePutResult>;
  getObject(location: TLocation): Promise<Buffer>;
  deleteObject(location: TLocation): Promise<void>;
}

export interface AssetStoragePutResult {
  etag?: string;
  requestId?: string;
}

export interface LocalAssetPutInput {
  filePath: string;
  bytes: Buffer;
}

export interface LocalAssetLocation {
  filePath: string;
}

export interface CosStorageAdapterConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  keyPrefix: string;
}

export interface CosAssetPutInput {
  key: string;
  bytes: Buffer;
  mimeType: string;
}

export interface CosAssetLocation {
  bucket: string;
  region: string;
  key: string;
}

export interface S3StorageAdapterConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  keyPrefix: string;
  endpoint: string;
  forcePathStyle: boolean;
}

export interface S3AssetPutInput {
  key: string;
  bytes: Buffer;
  mimeType: string;
}

export interface S3AssetLocation {
  bucket: string;
  region: string;
  key: string;
  endpoint: string;
  forcePathStyle: boolean;
}

export class LocalAssetStorageAdapter implements AssetStorageAdapter<LocalAssetPutInput, LocalAssetLocation> {
  async putObject(input: LocalAssetPutInput): Promise<AssetStoragePutResult> {
    await writeFile(input.filePath, input.bytes);
    return {};
  }

  async getObject(location: LocalAssetLocation): Promise<Buffer> {
    return readFile(location.filePath);
  }

  async deleteObject(location: LocalAssetLocation): Promise<void> {
    await rm(location.filePath, { force: true });
  }
}

export class CosAssetStorageAdapter implements AssetStorageAdapter<CosAssetPutInput, CosAssetLocation> {
  private readonly client: COS;

  constructor(private readonly config: CosStorageAdapterConfig) {
    this.client = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
      Protocol: "https:"
    });
  }

  async putObject(input: CosAssetPutInput): Promise<AssetStoragePutResult> {
    const result = await this.client.putObject({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: input.key,
      Body: input.bytes,
      ContentLength: input.bytes.length,
      ContentType: input.mimeType
    });

    return {
      etag: result.ETag,
      requestId: result.RequestId
    };
  }

  async getObject(location: CosAssetLocation): Promise<Buffer> {
    const result = await this.client.getObject({
      Bucket: location.bucket,
      Region: location.region,
      Key: location.key
    });

    return Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body);
  }

  async deleteObject(location: CosAssetLocation): Promise<void> {
    await this.client.deleteObject({
      Bucket: location.bucket,
      Region: location.region,
      Key: location.key
    });
  }

  async testConfig(): Promise<void> {
    const key = buildCosObjectKey(this.config.keyPrefix, `.storage-test-${randomUUID()}.txt`, new Date().toISOString());
    await this.putObject({
      key,
      bytes: Buffer.from("gpt-image-canvas storage test\n", "utf8"),
      mimeType: "text/plain; charset=utf-8"
    });
    await this.deleteObject({
      bucket: this.config.bucket,
      region: this.config.region,
      key
    });
  }
}

export class S3CompatibleAssetStorageAdapter implements AssetStorageAdapter<S3AssetPutInput, S3AssetLocation> {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageAdapterConfig) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region || "auto"
    });
  }

  async putObject(input: S3AssetPutInput): Promise<AssetStoragePutResult> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.bytes,
        ContentLength: input.bytes.length,
        ContentType: input.mimeType
      })
    );

    return {
      etag: result.ETag,
      requestId: result.$metadata.requestId
    };
  }

  async getObject(location: S3AssetLocation): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: location.bucket,
        Key: location.key
      })
    );

    return bodyToBuffer(result.Body);
  }

  async deleteObject(location: S3AssetLocation): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: location.bucket,
        Key: location.key
      })
    );
  }

  async testConfig(): Promise<void> {
    const key = buildCloudObjectKey(this.config.keyPrefix, `.storage-test-${randomUUID()}.txt`, new Date().toISOString());
    await this.putObject({
      key,
      bytes: Buffer.from("gpt-image-canvas storage test\n", "utf8"),
      mimeType: "text/plain; charset=utf-8"
    });
    await this.deleteObject({
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle,
      region: this.config.region,
      key
    });
  }
}

export function buildCosObjectKey(keyPrefix: string, fileName: string, createdAt: string): string {
  return buildCloudObjectKey(keyPrefix, fileName, createdAt);
}

export function buildCloudObjectKey(keyPrefix: string, fileName: string, createdAt: string): string {
  const date = new Date(createdAt);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(safeDate.getUTCFullYear()).padStart(4, "0");
  const month = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
  const normalizedPrefix = normalizeKeyPrefix(keyPrefix);
  return [normalizedPrefix, year, month, fileName].filter(Boolean).join("/");
}

export function normalizeKeyPrefix(value: string | undefined): string {
  const normalized = (value ?? "gpt-image-canvas/assets")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "")
    .replace(/\/{2,}/gu, "/");

  return normalized || "gpt-image-canvas/assets";
}

export function storageErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Cloud storage request failed.";
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return Buffer.from(await body.transformToByteArray());
  }

  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  return Buffer.from(String(body));
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array | Buffer | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
