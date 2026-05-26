import type { Hono } from "hono";
import { getStoredAssetPreviewAccessUrl, parsePreviewWidth, readStoredAssetPreview } from "../../domain/assets/preview.js";
import {
  getStoredAssetAccessUrl,
  readStoredAsset,
  readStoredAssetMetadata
} from "../../domain/generation/image-generation.js";
import { userCanReadAsset } from "../../domain/storage/store.js";
import { usesOssAssetStorage } from "../../infrastructure/storage/asset-storage.js";
import { currentUserFromRequest } from "../http/auth.js";
import { downloadFileName, errorResponse } from "../http/errors.js";

export function registerAssetRoutes(app: Hono): void {
  app.get("/api/assets/:id/preview-url", async (c) => {
    const parsedWidth = parsePreviewWidth(c.req.query("width"));
    if (!parsedWidth.ok) {
      return c.json(errorResponse(parsedWidth.code, parsedWidth.message), 400);
    }

    const assetId = c.req.param("id");
    if (!(await userCanReadAsset(assetId, await currentUserFromRequest(c)))) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    const access = await getStoredAssetPreviewAccessUrl(assetId, parsedWidth.width);
    if (!access) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return c.json(access);
  });

  app.get("/api/assets/:id/preview", async (c) => {
    const parsedWidth = parsePreviewWidth(c.req.query("width"));
    if (!parsedWidth.ok) {
      return c.json(errorResponse(parsedWidth.code, parsedWidth.message), 400);
    }

    const assetId = c.req.param("id");
    if (!(await userCanReadAsset(assetId, await currentUserFromRequest(c)))) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    if (usesOssAssetStorage()) {
      const access = await getStoredAssetPreviewAccessUrl(assetId, parsedWidth.width);
      if (!access) {
        return c.json(errorResponse("not_found", "Asset not found."), 404);
      }

      return c.redirect(access.url, 302);
    }

    const preview = await readStoredAssetPreview(assetId, parsedWidth.width);
    if (!preview) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return new Response(new Uint8Array(preview.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${downloadFileName(c.req.param("id"))}-${preview.width}.webp"`,
        "Content-Type": "image/webp"
      }
    });
  });

  app.get("/api/assets/:id/metadata", async (c) => {
    const assetId = c.req.param("id");
    if (!(await userCanReadAsset(assetId, await currentUserFromRequest(c)))) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    const metadata = await readStoredAssetMetadata(assetId);
    if (!metadata) {
      return c.json(errorResponse("not_found", "Asset not found."), 404);
    }

    return c.json(metadata);
  });

  app.get("/api/assets/:id/access-url", async (c) => {
    const assetId = c.req.param("id");
    if (!(await userCanReadAsset(assetId, await currentUserFromRequest(c)))) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
    const access = await getStoredAssetAccessUrl(assetId, disposition);
    if (!access) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return c.json(access);
  });

  app.get("/api/assets/:id/download", async (c) => {
    const assetId = c.req.param("id");
    if (!(await userCanReadAsset(assetId, await currentUserFromRequest(c)))) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    if (usesOssAssetStorage()) {
      const access = await getStoredAssetAccessUrl(assetId, "attachment");
      if (!access) {
        return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
      }

      return c.redirect(access.url, 302);
    }

    const asset = await readStoredAsset(assetId);
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `attachment; filename="${downloadFileName(asset.file.fileName)}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });

  app.get("/api/assets/:id", async (c) => {
    const assetId = c.req.param("id");
    if (!(await userCanReadAsset(assetId, await currentUserFromRequest(c)))) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    if (usesOssAssetStorage() && c.req.query("proxy") !== "1") {
      const access = await getStoredAssetAccessUrl(assetId, "inline");
      if (!access) {
        return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
      }

      return c.redirect(access.url, 302);
    }

    const asset = await readStoredAsset(assetId);
    if (!asset) {
      return c.json(errorResponse("not_found", "找不到请求的图像资源。"), 404);
    }

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${asset.file.fileName}"`,
        "Content-Type": asset.file.mimeType
      }
    });
  });
}
