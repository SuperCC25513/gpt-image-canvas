import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { closeAllAgentSessions } from "./domain/agent/websocket-session.js";
import { closeDatabase } from "./infrastructure/database.js";
import { closeRedisClient } from "./infrastructure/redis-runtime.js";
import { serverConfig } from "./infrastructure/runtime.js";
import { agentWebSocketServer, app } from "./server/app.js";

export { agentWebSocketServer, app } from "./server/app.js";

function isMainModule(): boolean {
  const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
  return entryUrl === import.meta.url;
}

if (isMainModule()) {
  const server = serve(
    {
      fetch: app.fetch,
      websocket: { server: agentWebSocketServer },
      hostname: serverConfig.host,
      port: serverConfig.port
    },
    (info) => {
      console.log(`API listening at http://${info.address}:${info.port}`);
    }
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    closeAllAgentSessions("server_shutdown");
    agentWebSocketServer.close();
    void Promise.allSettled([closeRedisClient(), closeDatabase()]).finally(() => {
      server.close();
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
