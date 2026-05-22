import type { Hono } from "hono";
import {
  adjustAdminUserCredits,
  AdminDomainError,
  listAdminUsers,
  listGenerationAudits,
  readAdminSettings,
  updateAdminSettings,
  updateAdminUser
} from "../../domain/admin/admin-store.js";
import { requireAdmin } from "../http/auth.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import {
  parseAdminCreditAdjustmentPayload,
  parseAdminSettingsPayload,
  parseAdminUserPatchPayload
} from "../http/validation.js";

export function registerAdminRoutes(app: Hono): void {
  app.get("/api/admin/users", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(
      await listAdminUsers({
        query: c.req.query("q"),
        limit: parseLimit(c.req.query("limit"))
      })
    );
  });

  app.patch("/api/admin/users/:id", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAdminUserPatchPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await updateAdminUser(c.req.param("id"), parsed.value, auth.user));
    } catch (error) {
      return adminErrorJson(error);
    }
  });

  app.post("/api/admin/users/:id/credits", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAdminCreditAdjustmentPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await adjustAdminUserCredits(c.req.param("id"), parsed.value, auth.user));
    } catch (error) {
      return adminErrorJson(error);
    }
  });

  app.get("/api/admin/settings", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(await readAdminSettings());
  });

  app.patch("/api/admin/settings", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAdminSettingsPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await updateAdminSettings(parsed.value));
    } catch (error) {
      return adminErrorJson(error);
    }
  });

  app.get("/api/admin/generation-requests", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(
      await listGenerationAudits({
        limit: parseLimit(c.req.query("limit"))
      })
    );
  });
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function adminErrorJson(error: unknown): Response {
  if (error instanceof AdminDomainError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: error.status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  throw error;
}
