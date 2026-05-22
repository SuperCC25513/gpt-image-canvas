import type { Hono } from "hono";
import { AuthDomainError, loginUser, logoutToken, registerUser } from "../../domain/auth/auth-store.js";
import { checkInUser, CreditDomainError } from "../../domain/credits/credit-store.js";
import { getAuthStatus, logoutCodex, pollCodexDeviceLogin, startCodexDeviceLogin } from "../../domain/providers/codex-auth.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { authMeResponse, clearSessionCookie, requireAdmin, requireAuth, SESSION_COOKIE_NAME, setSessionCookie } from "../http/auth.js";
import { errorResponse, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseCodexPollPayload, parseLoginPayload, parseRegisterPayload } from "../http/validation.js";

export function registerAuthRoutes(app: Hono): void {
  app.get("/api/auth/me", (c) => authMeResponse(c));

  app.post("/api/auth/register", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseRegisterPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      const result = await registerUser(parsed.value);
      if ("token" in result) {
        setSessionCookie(c, result.token, result.expiresAt);
        return c.json({ user: result.user }, 201);
      }

      return c.json(result, 202);
    } catch (error) {
      return authErrorJson(error);
    }
  });

  app.post("/api/auth/login", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseLoginPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      const session = await loginUser(parsed.value);
      setSessionCookie(c, session.token, session.expiresAt);
      return c.json({ user: session.user });
    } catch (error) {
      return authErrorJson(error);
    }
  });

  app.post("/api/auth/logout", async (c) => {
    await logoutToken(c.req.header("cookie") ? cookieValue(c.req.header("cookie"), SESSION_COOKIE_NAME) : undefined);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post("/api/checkin", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      return c.json(await checkInUser(auth.user));
    } catch (error) {
      return authErrorJson(error);
    }
  });

  app.get("/api/auth/status", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(getAuthStatus());
  });

  app.post("/api/auth/codex/device/start", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      return c.json(await startCodexDeviceLogin(c.req.raw.signal));
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/auth/codex/device/poll", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseCodexPollPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await pollCodexDeviceLogin(parsed.value, c.req.raw.signal));
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/auth/codex/logout", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(logoutCodex());
  });
}

function authErrorJson(error: unknown): Response {
  if (error instanceof AuthDomainError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: error.status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  if (error instanceof CreditDomainError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: error.status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  return new Response(JSON.stringify(errorResponse("invalid_auth_request", "认证请求失败。")), {
    status: 400,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const segment of header.split(";")) {
    const [rawKey, ...rawValue] = segment.split("=");
    if (rawKey?.trim() === name) {
      return rawValue.join("=").trim();
    }
  }

  return undefined;
}
