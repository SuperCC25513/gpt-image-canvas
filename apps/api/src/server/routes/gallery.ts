import type { Hono } from "hono";
import type { GalleryExportRequest } from "../../domain/contracts.js";
import { createZipStream, prepareZipFiles, type ZipFileInput } from "../../domain/assets/zip.js";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import {
  deleteGalleryOutput,
  getGalleryExportAssets,
  getGalleryImages,
  getPublicGalleryImages,
  updateGalleryVisibility
} from "../../domain/project/project-store.js";
import { requireAuth } from "../http/auth.js";
import { downloadFileName, errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseGalleryVisibilityPayload } from "../http/validation.js";

export function registerGalleryRoutes(app: Hono): void {
  app.get("/api/gallery", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(await getGalleryImages(auth.user));
  });

  app.get("/api/gallery/public", async (c) => {
    return c.json(await getPublicGalleryImages(parsePublicGalleryLimit(c.req.query("limit"))));
  });

  app.post("/api/gallery/export", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const parsed = await parseGalleryExportRequest(c.req.raw);
    if (!parsed.ok) {
      return c.json(errorResponse(parsed.code, parsed.message), 400);
    }

    const exportAssets = await getGalleryExportAssets(parsed.outputIds, auth.user);
    if (exportAssets.length !== parsed.outputIds.length) {
      return c.json(errorResponse("gallery_export_not_found", "One or more Gallery images were not found."), 404);
    }

    const zipInputs: ZipFileInput[] = [];
    for (const [index, exportAsset] of exportAssets.entries()) {
      const file = await getStoredAssetFile(exportAsset.assetId);
      if (!file) {
        return c.json(errorResponse("gallery_export_asset_unavailable", "One or more Gallery assets are unavailable."), 404);
      }

      zipInputs.push({
        filePath: file.filePath,
        name: `${String(index + 1).padStart(3, "0")}-${downloadFileName(file.fileName)}`
      });
    }

    try {
      const zipFiles = await prepareZipFiles(zipInputs);
      return new Response(createZipStream(zipFiles), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${galleryExportFileName()}"`,
          "Content-Type": "application/zip"
        }
      });
    } catch {
      return c.json(errorResponse("gallery_export_asset_unavailable", "One or more Gallery assets are unavailable."), 404);
    }
  });

  app.delete("/api/gallery/:outputId", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const deleted = await deleteGalleryOutput(c.req.param("outputId"), auth.user);
    if (!deleted) {
      return c.json(errorResponse("not_found", "Gallery image record not found."), 404);
    }

    return c.json({
      ok: true
    });
  });

  app.patch("/api/gallery/:outputId/visibility", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseGalleryVisibilityPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    const outputId = c.req.param("outputId").trim();
    const visibility = outputId ? await updateGalleryVisibility(outputId, parsed.value, auth.user) : undefined;
    if (!visibility) {
      return c.json(errorResponse("not_found", "Gallery image record not found."), 404);
    }

    return c.json(visibility);
  });
}

function parsePublicGalleryLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 60) : 60;
}

type GalleryExportParseResult =
  | {
      ok: true;
      outputIds: string[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

async function parseGalleryExportRequest(request: Request): Promise<GalleryExportParseResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Request body must be valid JSON."
    };
  }

  if (!isRecord(body) || !Array.isArray(body.outputIds)) {
    return {
      ok: false,
      code: "invalid_gallery_export_request",
      message: "Gallery export requires outputIds."
    };
  }

  const exportRequest: GalleryExportRequest = {
    outputIds: body.outputIds.filter((outputId): outputId is string => typeof outputId === "string")
  };
  const outputIds = normalizeOutputIds(exportRequest.outputIds);
  if (outputIds.length === 0) {
    return {
      ok: false,
      code: "gallery_export_empty",
      message: "Gallery export requires at least one image."
    };
  }

  return {
    ok: true,
    outputIds
  };
}

function normalizeOutputIds(value: unknown[]): string[] {
  const seen = new Set<string>();
  const outputIds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const outputId = item.trim();
    if (!outputId || seen.has(outputId)) {
      continue;
    }

    seen.add(outputId);
    outputIds.push(outputId);
  }

  return outputIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function galleryExportFileName(now = new Date()): string {
  const parts = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    "-",
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds())
  ];
  return `gpt-image-canvas-gallery-${parts.join("")}.zip`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
