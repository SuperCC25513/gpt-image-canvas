import type { Hono } from "hono";
import { getAgentLlmConfig, saveAgentLlmConfig } from "../../domain/agent/config.js";
import { requireAdmin } from "../http/auth.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseAgentLlmConfigPayload } from "../http/validation.js";

export function registerAgentConfigRoutes(app: Hono): void {
  app.get("/api/agent-config", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(await getAgentLlmConfig());
  });

  app.put("/api/agent-config", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAgentLlmConfigPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await saveAgentLlmConfig(parsed.value));
    } catch {
      return c.json(errorResponse("agent_config_error", "Agent LLM config could not be saved."), 400);
    }
  });
}
