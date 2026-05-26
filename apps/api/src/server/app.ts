import { relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { initializeAuthFoundation } from "../domain/auth/auth-store.js";
import { runtimePaths } from "../infrastructure/runtime.js";
import { assertAssetStorageConfigured } from "../infrastructure/storage/asset-storage.js";
import { errorResponse } from "./http/errors.js";
import { registerAgentConfigRoutes } from "./routes/agent-config.js";
import { registerAgentConversationRoutes } from "./routes/agent-conversations.js";
import { registerAgentSkillRoutes } from "./routes/agent-skills.js";
import { registerAgentWebSocketRoutes } from "./routes/agent-ws.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerCreditRoutes } from "./routes/credits.js";
import { registerGalleryRoutes } from "./routes/gallery.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerProjectRoutes } from "./routes/project.js";
import { registerPromptFavoriteRoutes } from "./routes/prompt-favorites.js";
import { registerPromptPoolRoutes } from "./routes/prompt-pool.js";
import { registerProviderConfigRoutes } from "./routes/provider-config.js";
import { registerRedemptionCodeRoutes } from "./routes/redemption-codes.js";

export const agentWebSocketServer = new WebSocketServer({ noServer: true });
export const app = await createApp();

export async function createApp(): Promise<Hono> {
  assertAssetStorageConfigured();
  await initializeAuthFoundation();

  const app = new Hono();

  app.onError((error, c) => {
    console.error(error);
    return c.json(errorResponse("internal_error", "Internal server error."), 500);
  });

  registerCoreRoutes(app);
  registerAuthRoutes(app);
  registerCreditRoutes(app);
  registerRedemptionCodeRoutes(app);
  registerAdminRoutes(app);
  registerProviderConfigRoutes(app);
  registerAgentConfigRoutes(app);
  registerAgentConversationRoutes(app);
  registerAgentSkillRoutes(app);
  registerProjectRoutes(app);
  registerGalleryRoutes(app);
  registerPromptPoolRoutes(app);
  registerPromptFavoriteRoutes(app);
  registerAssetRoutes(app);
  registerImageRoutes(app);
  registerAgentWebSocketRoutes(app);

  const webDistRoot = relative(process.cwd(), runtimePaths.webDistDir) || ".";

  app.get("/api/*", (c) => c.json(errorResponse("not_found", "Not found."), 404));

  app.get("*", serveStatic({ root: webDistRoot }));
  app.get(
    "*",
    serveStatic({
      root: webDistRoot,
      path: "index.html",
      onNotFound: () => {
        console.error(`Built web bundle not found at ${runtimePaths.webDistDir}. Run pnpm build before pnpm start.`);
      }
    })
  );

  return app;
}
