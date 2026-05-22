import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CurrentUser } from "../../domain/contracts.js";
import { currentUserFromToken, getAuthSettings } from "../../domain/auth/auth-store.js";
import { getCheckinStatus } from "../../domain/credits/credit-store.js";
import { errorResponse } from "./errors.js";

export const SESSION_COOKIE_NAME = "gic_session";

type AuthResult =
  | {
      ok: true;
      user: CurrentUser;
    }
  | {
      ok: false;
      response: Response;
    };

export async function requireAuth(c: Context): Promise<AuthResult> {
  const user = await currentUserFromRequest(c);
  if (!user) {
    return {
      ok: false,
      response: c.json(errorResponse("unauthorized", "请先登录。"), 401)
    };
  }

  return {
    ok: true,
    user
  };
}

export async function requireAdmin(c: Context): Promise<AuthResult> {
  const auth = await requireAuth(c);
  if (!auth.ok) {
    return auth;
  }

  if (auth.user.role !== "admin") {
    return {
      ok: false,
      response: c.json(errorResponse("forbidden", "需要管理员权限。"), 403)
    };
  }

  return auth;
}

export async function currentUserFromRequest(c: Context): Promise<CurrentUser | undefined> {
  return currentUserFromToken(getCookie(c, SESSION_COOKIE_NAME));
}

export function setSessionCookie(c: Context, token: string, expiresAt: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: isSecureCookie()
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: "/"
  });
}

export async function authMeResponse(c: Context) {
  const user = await currentUserFromRequest(c);
  return c.json({
    authenticated: Boolean(user),
    user,
    settings: await getAuthSettings(),
    checkin: user ? await getCheckinStatus(user.id) : undefined
  });
}

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
}
