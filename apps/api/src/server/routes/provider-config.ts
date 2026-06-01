import type { Hono } from "hono";
import { getProviderConfig, saveProviderConfig } from "../../domain/providers/provider-config.js";
import { requireAdmin } from "../http/auth.js";
import { errorResponse } from "../http/errors.js";
import { jsonErrorStatus, readJson } from "../http/json.js";
import { parseProviderConfigPayload } from "../http/validation.js";

export function registerProviderConfigRoutes(app: Hono): void {
  app.get("/api/provider-config", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(await getProviderConfig());
  });

  app.put("/api/provider-config", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, jsonErrorStatus(payload.error));
    }

    const parsed = parseProviderConfigPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await saveProviderConfig(parsed.value));
    } catch {
      return c.json(errorResponse("provider_config_error", "Provider config could not be saved."), 400);
    }
  });
}
