import type { Hono } from "hono";
import { getProjectState, saveProjectSnapshot } from "../../domain/project/project-store.js";
import { requireAuth } from "../http/auth.js";
import { readJson } from "../http/json.js";
import { logProjectSaveRejected, parseProjectPayload } from "../http/validation.js";

export function registerProjectRoutes(app: Hono): void {
  app.get("/api/project", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(await getProjectState(auth.user));
  });

  app.put("/api/project", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      logProjectSaveRejected(payload.error, c.req.raw);
      return c.json(payload.error, 400);
    }

    const parsed = parseProjectPayload(payload.value);
    if (!parsed.ok) {
      logProjectSaveRejected(parsed.error, c.req.raw);
      return c.json(parsed.error, 400);
    }

    return c.json(await saveProjectSnapshot(parsed.value, auth.user));
  });
}
