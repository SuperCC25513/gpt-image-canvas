import type { Hono } from "hono";
import { getPromptPool } from "../../domain/prompt-pool/prompt-pool.js";
import { requireAuth } from "../http/auth.js";

export function registerPromptPoolRoutes(app: Hono): void {
  app.get("/api/pool", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(await getPromptPool());
  });
}
