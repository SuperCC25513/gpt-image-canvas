import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import sharp from "sharp";
import type { AssetAccessUrlResponse } from "../contracts.js";
import { getStoredAssetFile, readStoredAsset } from "../generation/image-generation.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import {
  assetStorageSignedUrlExpiresInSeconds,
  ossObjectExists,
  previewObjectKeyForAsset,
  signedOssObjectUrl,
  usesOssAssetStorage,
  writeOssObject
} from "../../infrastructure/storage/asset-storage.js";

const PREVIEW_WIDTHS = [256, 512, 1024, 2048] as const;
const MAX_PREVIEW_WIDTH = PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1];
const previewFlights = new Map<string, Promise<StoredAssetPreview | AssetAccessUrlResponse | undefined>>();

export type PreviewWidthResult =
  | {
      ok: true;
      width: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export interface StoredAssetPreview {
  bytes: Buffer;
  width: number;
}

export function parsePreviewWidth(value: string | undefined): PreviewWidthResult {
  if (!value || !/^\d+$/u.test(value)) {
    return {
      ok: false,
      code: "invalid_width",
      message: "Preview width must be an integer."
    };
  }

  const requestedWidth = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(requestedWidth)) {
    return {
      ok: false,
      code: "invalid_width",
      message: "Preview width must be an integer."
    };
  }

  if (requestedWidth < 1 || requestedWidth > MAX_PREVIEW_WIDTH) {
    return {
      ok: false,
      code: "invalid_width",
      message: `Preview width must be between 1 and ${MAX_PREVIEW_WIDTH}.`
    };
  }

  return {
    ok: true,
    width: PREVIEW_WIDTHS.find((width) => width >= requestedWidth) ?? MAX_PREVIEW_WIDTH
  };
}

export async function readStoredAssetPreview(assetId: string, width: number): Promise<StoredAssetPreview | undefined> {
  if (usesOssAssetStorage()) {
    return undefined;
  }

  const asset = await readStoredAsset(assetId);
  if (!asset) {
    return undefined;
  }

  const previewPath = resolvePreviewPath(asset.file.id, width);
  const cached = await readCachedPreview(previewPath);
  if (cached) {
    return {
      bytes: cached,
      width
    };
  }

  return singleFlightPreview(`local:${asset.file.id}:${width}`, async () => {
    const cachedAfterWait = await readCachedPreview(previewPath);
    if (cachedAfterWait) {
      return {
        bytes: cachedAfterWait,
        width
      };
    }

    const bytes = await renderPreviewBytes(asset.bytes, width);
    await writeFile(previewPath, bytes);

    return {
      bytes,
      width
    };
  }) as Promise<StoredAssetPreview | undefined>;
}

export async function getStoredAssetPreviewAccessUrl(
  assetId: string,
  width: number
): Promise<AssetAccessUrlResponse | undefined> {
  if (!usesOssAssetStorage()) {
    return {
      id: assetId,
      url: `/api/assets/${encodeURIComponent(assetId)}/preview?width=${width}`,
      width
    };
  }

  const file = await getStoredAssetFile(assetId);
  if (!file) {
    return undefined;
  }

  const objectKey = previewObjectKeyForAsset(assetId, width);
  if (!(await ossObjectExists(objectKey))) {
    return singleFlightPreview(`oss:${assetId}:${width}`, async () => {
      if (await ossObjectExists(objectKey)) {
        return signedPreviewAccessUrl(assetId, objectKey, file.id, width);
      }

      const asset = await readStoredAsset(assetId);
      if (!asset) {
        return undefined;
      }

      const bytes = await renderPreviewBytes(asset.bytes, width);
      await writeOssObject(objectKey, bytes, "image/webp");
      return signedPreviewAccessUrl(assetId, objectKey, file.id, width);
    }) as Promise<AssetAccessUrlResponse | undefined>;
  }

  return signedPreviewAccessUrl(assetId, objectKey, file.id, width);
}

async function renderPreviewBytes(bytes: Buffer, width: number): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({
      width,
      withoutEnlargement: true
    })
    .webp({
      effort: 4,
      quality: 78
    })
    .toBuffer();
}

function signedPreviewAccessUrl(assetId: string, objectKey: string, fileId: string, width: number): AssetAccessUrlResponse {
  return {
    id: assetId,
    url: signedOssObjectUrl(objectKey, {
      disposition: "inline",
      fileName: `${fileId}-${width}.webp`
    }),
    width,
    expiresInSeconds: assetStorageSignedUrlExpiresInSeconds()
  };
}

async function singleFlightPreview<T extends StoredAssetPreview | AssetAccessUrlResponse | undefined>(
  key: string,
  run: () => Promise<T>
): Promise<T> {
  const existing = previewFlights.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const promise = run().finally(() => {
    previewFlights.delete(key);
  });
  previewFlights.set(key, promise);
  return promise;
}

async function readCachedPreview(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch {
    return undefined;
  }
}

function resolvePreviewPath(assetId: string, width: number): string {
  const filePath = resolve(runtimePaths.assetPreviewsDir, `${safeFileSegment(assetId)}-${width}.webp`);
  if (!isInsideDirectory(filePath, runtimePaths.assetPreviewsDir)) {
    throw new Error("Invalid preview cache path.");
  }

  return filePath;
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}
