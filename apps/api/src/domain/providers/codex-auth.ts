import { and, eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import type {
  AuthStatusResponse,
  CodexDevicePollResponse,
  CodexDeviceStartResponse,
  CodexLogoutResponse
} from "../contracts.js";
import {
  CODEX_CLIENT_ID,
  classifyCodexRefreshFailure,
  parseCodexDevicePollPayload,
  parseCodexDeviceStartPayload,
  parseCodexTokenPayload
} from "./codex-auth-utils.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { getProviderConfig } from "./provider-config.js";
import { codexOAuthTokens } from "../../infrastructure/schema.js";

const CODEX_TOKEN_ROW_ID = "default";
const DEFAULT_CODEX_ISSUER = "https://auth.openai.com";
const DEFAULT_CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_CODEX_AUTH_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60 * 1000;
let activeRefreshPromise: Promise<CodexTokenRow | undefined> | undefined;

type CodexTokenRow = typeof codexOAuthTokens.$inferSelect;

interface MySqlCodexTokenRow extends RowDataPacket, CodexTokenRow {}

export interface CodexAccessSession {
  accessToken: string;
  accountId?: string;
  expiresAt?: string;
}

export async function getAuthStatus(options: { includeCodexDetails?: boolean } = {}): Promise<AuthStatusResponse> {
  const providerConfig = await getProviderConfig();
  const codex = providerConfig.sources.find((source) => source.id === "codex")?.details.codex ?? codexSessionView(await getCodexTokenRow());
  const openaiConfigured = providerConfig.sources.some(
    (source) => (source.id === "env-openai" || source.id === "local-openai") && source.available
  );

  return {
    provider: providerConfig.activeSource?.provider ?? "none",
    openaiConfigured,
    codex: options.includeCodexDetails ? codex : publicCodexSessionView(codex),
    activeSource: providerConfig.activeSource
  };
}

export function getCodexResponsesBaseURL(): string {
  return trimTrailingSlash(process.env.CODEX_RESPONSES_BASE_URL?.trim() || DEFAULT_CODEX_RESPONSES_BASE_URL);
}

export async function startCodexDeviceLogin(signal?: AbortSignal): Promise<CodexDeviceStartResponse> {
  const issuer = getCodexIssuer();
  const response = await fetchJson(
    `${issuer}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID
      })
    },
    signal
  );

  const parsed = parseCodexDeviceStartPayload(response, {
    verificationUrl: `${issuer}/codex/device`
  });

  if (!parsed) {
    throw new ProviderError("unsupported_provider_behavior", "Codex 登录服务返回内容无法识别。", 502);
  }

  return parsed;
}

export async function pollCodexDeviceLogin(
  input: {
    deviceAuthId: string;
    userCode: string;
  },
  signal?: AbortSignal
): Promise<CodexDevicePollResponse> {
  const issuer = getCodexIssuer();
  const timeout = timeoutSignal(signal, authTimeoutMs());
  const response = await fetch(`${issuer}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      device_auth_id: input.deviceAuthId,
      user_code: input.userCode
    }),
    signal: timeout.signal
  })
    .catch((error: unknown) => {
      throw fetchFailureToProviderError(error, "Codex 登录服务暂时不可用。");
    })
    .finally(timeout.cleanup);

  const body = await readResponseBody(response);
  const parsed = parseCodexDevicePollPayload(response.status, body);

  if (parsed.status === "pending") {
    return {
      status: "pending",
      interval: parsed.interval
    };
  }

  if (parsed.status === "expired" || parsed.status === "denied") {
    return {
      status: parsed.status,
      message: parsed.message
    };
  }

  if (parsed.status === "error") {
    throw new ProviderError("upstream_failure", parsed.message, providerHttpStatus(response.status));
  }

  if (parsed.status !== "authorized") {
    throw new ProviderError("upstream_failure", "Codex 登录轮询失败，请稍后重试。", providerHttpStatus(response.status));
  }

  const tokens = await exchangeAuthorizationCodeForTokens(issuer, parsed.exchange.authorizationCode, parsed.exchange.codeVerifier, signal);
  await storeCodexTokens(tokens);

  return {
    status: "authorized",
    auth: await getAuthStatus({ includeCodexDetails: true })
  };
}

export async function logoutCodex(): Promise<CodexLogoutResponse> {
  if (databaseDriver === "sqlite") {
    db.delete(codexOAuthTokens).where(eq(codexOAuthTokens.id, CODEX_TOKEN_ROW_ID)).run();
  } else {
    await getMySqlPool().execute("DELETE FROM codex_oauth_tokens WHERE id = ?", [CODEX_TOKEN_ROW_ID]);
  }

  return {
    ok: true,
    auth: await getAuthStatus({ includeCodexDetails: true })
  };
}

export async function getValidCodexSession(signal?: AbortSignal): Promise<CodexAccessSession | undefined> {
  const row = await getCodexTokenRow();
  if (!hasUsableTokenMaterial(row)) {
    return undefined;
  }

  const sessionRow = shouldRefreshCodexToken(row) ? await refreshCodexTokenSingleFlight(row, signal) : row;
  if (!hasUsableTokenMaterial(sessionRow)) {
    return undefined;
  }

  return {
    accessToken: sessionRow.accessToken,
    accountId: sessionRow.accountId ?? undefined,
    expiresAt: sessionRow.expiresAt ?? undefined
  };
}

async function getCodexTokenRow(): Promise<CodexTokenRow | undefined> {
  if (databaseDriver === "sqlite") {
    return db.select().from(codexOAuthTokens).where(eq(codexOAuthTokens.id, CODEX_TOKEN_ROW_ID)).get();
  }

  const [rows] = await getMySqlPool().execute<MySqlCodexTokenRow[]>(
    `SELECT
       id,
       access_token AS accessToken,
       refresh_token AS refreshToken,
       id_token AS idToken,
       email,
       account_id AS accountId,
       expires_at AS expiresAt,
       refreshed_at AS refreshedAt,
       unavailable_at AS unavailableAt,
       unavailable_reason AS unavailableReason,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM codex_oauth_tokens
     WHERE id = ?
     LIMIT 1`,
    [CODEX_TOKEN_ROW_ID]
  );
  return rows[0];
}

async function storeCodexTokens(payload: unknown, fallback?: CodexTokenRow): Promise<CodexTokenRow> {
  const now = new Date();
  const parsed = parseCodexTokenPayload(payload, {
    now,
    fallback: fallback
      ? {
          accessToken: fallback.accessToken,
          refreshToken: fallback.refreshToken,
          idToken: fallback.idToken,
          email: fallback.email,
          accountId: fallback.accountId,
          expiresAt: fallback.expiresAt
        }
      : undefined
  });

  if (!parsed) {
    throw new ProviderError("unsupported_provider_behavior", "Codex 登录服务没有返回完整令牌。", 502);
  }

  const createdAt = fallback?.createdAt ?? now.toISOString();
  const row: CodexTokenRow = {
    id: CODEX_TOKEN_ROW_ID,
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    idToken: parsed.idToken,
    email: parsed.email ?? null,
    accountId: parsed.accountId ?? null,
    expiresAt: parsed.expiresAt,
    refreshedAt: parsed.refreshedAt,
    unavailableAt: null,
    unavailableReason: null,
    createdAt,
    updatedAt: now.toISOString()
  };

  if (databaseDriver === "sqlite") {
    db.insert(codexOAuthTokens)
      .values(row)
      .onConflictDoUpdate({
        target: codexOAuthTokens.id,
        set: {
          accessToken: row.accessToken,
          refreshToken: row.refreshToken,
          idToken: row.idToken,
          email: row.email,
          accountId: row.accountId,
          expiresAt: row.expiresAt,
          refreshedAt: row.refreshedAt,
          unavailableAt: row.unavailableAt,
          unavailableReason: row.unavailableReason,
          updatedAt: row.updatedAt
        }
      })
      .run();
  } else {
    await saveMySqlCodexTokenRow(row);
  }

  return row;
}

async function saveMySqlCodexTokenRow(row: CodexTokenRow): Promise<void> {
  await getMySqlPool().execute(
    `INSERT INTO codex_oauth_tokens
      (id, access_token, refresh_token, id_token, email, account_id, expires_at, refreshed_at, unavailable_at, unavailable_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       id_token = VALUES(id_token),
       email = VALUES(email),
       account_id = VALUES(account_id),
       expires_at = VALUES(expires_at),
       refreshed_at = VALUES(refreshed_at),
       unavailable_at = VALUES(unavailable_at),
       unavailable_reason = VALUES(unavailable_reason),
       updated_at = VALUES(updated_at)`,
    [
      row.id,
      row.accessToken,
      row.refreshToken,
      row.idToken,
      row.email,
      row.accountId,
      row.expiresAt,
      row.refreshedAt,
      row.unavailableAt,
      row.unavailableReason,
      row.createdAt,
      row.updatedAt
    ]
  );
}

async function refreshCodexToken(row: CodexTokenRow, signal?: AbortSignal): Promise<CodexTokenRow | undefined> {
  if (!row.refreshToken) {
    await markCodexSessionUnavailable("missing_refresh_token");
    return undefined;
  }

  const timeout = timeoutSignal(signal, authTimeoutMs());
  const response = await fetch(getCodexRefreshTokenURL(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: row.refreshToken
    }),
    signal: timeout.signal
  })
    .catch((error: unknown) => {
      throw fetchFailureToProviderError(error, "Codex 登录刷新失败，请稍后重试。");
    })
    .finally(timeout.cleanup);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (classifyCodexRefreshFailure(response.status, body) === "permanent") {
      await markCodexSessionUnavailable("refresh_rejected", row.refreshToken);
      return undefined;
    }

    throw new ProviderError("upstream_failure", "Codex 登录刷新失败，请稍后重试。", providerHttpStatus(response.status));
  }

  const payload = await response.json().catch(() => undefined);
  return storeCodexTokens(payload, row);
}

async function refreshCodexTokenSingleFlight(row: CodexTokenRow, signal?: AbortSignal): Promise<CodexTokenRow | undefined> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = refreshCodexToken(row, signal).finally(() => {
    activeRefreshPromise = undefined;
  });
  return activeRefreshPromise;
}

async function exchangeAuthorizationCodeForTokens(
  issuer: string,
  authorizationCode: string,
  codeVerifier: string,
  signal?: AbortSignal
): Promise<unknown> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    redirect_uri: `${issuer}/deviceauth/callback`,
    client_id: CODEX_CLIENT_ID,
    code_verifier: codeVerifier
  });

  const timeout = timeoutSignal(signal, authTimeoutMs());
  const response = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal: timeout.signal
  })
    .catch((error: unknown) => {
      throw fetchFailureToProviderError(error, "Codex 登录换取令牌失败。");
    })
    .finally(timeout.cleanup);

  if (!response.ok) {
    throw new ProviderError("upstream_failure", "Codex 登录换取令牌失败。", providerHttpStatus(response.status));
  }

  return response.json().catch(() => {
    throw new ProviderError("unsupported_provider_behavior", "Codex 登录令牌响应无法解析。", 502);
  });
}

async function fetchJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const timeout = timeoutSignal(signal, authTimeoutMs());
  try {
    const response = await fetch(url, {
      ...init,
      signal: timeout.signal
    }).catch((error: unknown) => {
      throw fetchFailureToProviderError(error, "Codex 登录服务暂时不可用。");
    });

    if (!response.ok) {
      throw new ProviderError("upstream_failure", "Codex 登录服务请求失败。", providerHttpStatus(response.status));
    }

    return response.json().catch(() => {
      throw new ProviderError("unsupported_provider_behavior", "Codex 登录服务响应无法解析。", 502);
    });
  } finally {
    timeout.cleanup();
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }

  return response.text().catch(() => "");
}

async function markCodexSessionUnavailable(reason: string, expectedRefreshToken?: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    const now = new Date().toISOString();
    db.update(codexOAuthTokens)
      .set({
        accessToken: null,
        refreshToken: null,
        idToken: null,
        unavailableAt: now,
        unavailableReason: reason,
        updatedAt: now
      })
      .where(
        expectedRefreshToken
          ? and(eq(codexOAuthTokens.id, CODEX_TOKEN_ROW_ID), eq(codexOAuthTokens.refreshToken, expectedRefreshToken))
          : eq(codexOAuthTokens.id, CODEX_TOKEN_ROW_ID)
      )
      .run();
    return;
  }

  const now = new Date().toISOString();
  await getMySqlPool().execute(
    `UPDATE codex_oauth_tokens
     SET access_token = NULL,
         refresh_token = NULL,
         id_token = NULL,
         unavailable_at = ?,
         unavailable_reason = ?,
         updated_at = ?
     WHERE id = ?
       ${expectedRefreshToken ? "AND refresh_token = ?" : ""}`,
    expectedRefreshToken ? [now, reason, now, CODEX_TOKEN_ROW_ID, expectedRefreshToken] : [now, reason, now, CODEX_TOKEN_ROW_ID]
  );
}

function publicCodexSessionView(codex: AuthStatusResponse["codex"]): AuthStatusResponse["codex"] {
  return {
    available: codex.available,
    unavailableReason: codex.available ? undefined : codex.unavailableReason
  };
}

function codexSessionView(row: CodexTokenRow | undefined): AuthStatusResponse["codex"] {
  const available = hasUsableTokenMaterial(row);

  return {
    available,
    email: row?.email ?? undefined,
    accountId: row?.accountId ?? undefined,
    expiresAt: row?.expiresAt ?? undefined,
    refreshedAt: row?.refreshedAt ?? undefined,
    unavailableReason: !available ? (row?.unavailableReason ?? undefined) : undefined
  };
}

function hasUsableTokenMaterial(row: CodexTokenRow | undefined): row is CodexTokenRow & {
  accessToken: string;
  refreshToken: string;
} {
  return Boolean(row?.accessToken && row.refreshToken && !row.unavailableAt);
}

function shouldRefreshCodexToken(row: CodexTokenRow): boolean {
  if (!row.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(row.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS) {
    return true;
  }

  if (!row.refreshedAt) {
    return true;
  }

  const refreshedAt = Date.parse(row.refreshedAt);
  return !Number.isFinite(refreshedAt) || Date.now() - refreshedAt >= TOKEN_REFRESH_INTERVAL_MS;
}

function getCodexIssuer(): string {
  return trimTrailingSlash(process.env.CODEX_AUTH_ISSUER?.trim() || DEFAULT_CODEX_ISSUER);
}

function getCodexRefreshTokenURL(): string {
  return process.env.CODEX_REFRESH_TOKEN_URL?.trim() || `${getCodexIssuer()}/oauth/token`;
}

function authTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.CODEX_AUTH_TIMEOUT_MS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CODEX_AUTH_TIMEOUT_MS;
}

function providerHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function fetchFailureToProviderError(error: unknown, message: string): ProviderError | Error {
  if (isAbortError(error)) {
    return new ProviderError("upstream_failure", message, 504);
  }

  return new ProviderError("upstream_failure", message, 502);
}

function isAbortError(error: unknown): error is Error {
  return error instanceof DOMException && error.name === "AbortError";
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
