import { upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";
import { createAgentWebSocketEvents } from "../../domain/agent/websocket-session.js";
import type { CurrentUser } from "../../domain/contracts.js";
import { requireAuth } from "../http/auth.js";

type AgentWebSocketHono = Hono<{ Variables: { currentUser: CurrentUser } }>;

export function registerAgentWebSocketRoutes(app: Hono): void {
  const agentApp = app as unknown as AgentWebSocketHono;

  agentApp.use("/api/agent/ws", async (c, next) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    c.set("currentUser", auth.user);
    await next();
  });

  agentApp.get(
    "/api/agent/ws",
    upgradeWebSocket((c) =>
      createAgentWebSocketEvents(
        c.req.query("connectionId"),
        c.req.query("runId"),
        c.req.query("conversationId"),
        c.get("currentUser") as CurrentUser
      ), {
      onError(error) {
        console.error("Agent WebSocket error.", error);
      }
    })
  );
}
