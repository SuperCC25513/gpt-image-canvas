import type { Hono } from "hono";
import {
  createAdminRedemptionCodes,
  deleteAdminRedemptionCode,
  listAdminRedemptionCodes,
  redeemCreditCode,
  RedemptionCodeDomainError,
  updateAdminRedemptionCode
} from "../../domain/redemption-codes/redemption-code-store.js";
import { requireAdmin, requireAuth } from "../http/auth.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import {
  parseAdminCreateRedemptionCodesPayload,
  parseAdminRedemptionCodePatchPayload,
  parseRedeemCreditCodePayload
} from "../http/validation.js";

export function registerRedemptionCodeRoutes(app: Hono): void {
  app.post("/api/credits/redeem", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseRedeemCreditCodePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await redeemCreditCode(auth.user, parsed.value));
    } catch (error) {
      return redemptionCodeErrorJson(error);
    }
  });

  app.get("/api/admin/redemption-codes", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(
      await listAdminRedemptionCodes({
        limit: parseLimit(c.req.query("limit"))
      })
    );
  });

  app.post("/api/admin/redemption-codes", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAdminCreateRedemptionCodesPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await createAdminRedemptionCodes(parsed.value, auth.user));
    } catch (error) {
      return redemptionCodeErrorJson(error);
    }
  });

  app.patch("/api/admin/redemption-codes/:id", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAdminRedemptionCodePatchPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await updateAdminRedemptionCode(c.req.param("id"), parsed.value));
    } catch (error) {
      return redemptionCodeErrorJson(error);
    }
  });

  app.delete("/api/admin/redemption-codes/:id", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      return c.json(await deleteAdminRedemptionCode(c.req.param("id")));
    } catch (error) {
      return redemptionCodeErrorJson(error);
    }
  });
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function redemptionCodeErrorJson(error: unknown): Response {
  if (error instanceof RedemptionCodeDomainError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: error.status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  throw error;
}
