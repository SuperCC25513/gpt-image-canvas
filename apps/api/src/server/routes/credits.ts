import type { Hono } from "hono";
import { listCreditTransactionsForUser } from "../../domain/credits/credit-store.js";
import { requireAuth } from "../http/auth.js";

export function registerCreditRoutes(app: Hono): void {
  app.get("/api/credits/transactions", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(
      await listCreditTransactionsForUser(auth.user.id, {
        limit: parseCreditTransactionLimit(c.req.query("limit"))
      })
    );
  });
}

function parseCreditTransactionLimit(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
