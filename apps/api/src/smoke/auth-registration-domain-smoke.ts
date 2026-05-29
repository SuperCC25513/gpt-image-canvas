import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS } from "@gpt-image-canvas/shared";
import { appSettings, creditTransactions, registrationEmailVerifications, users } from "../infrastructure/schema.js";
import type { SqliteDatabase } from "../infrastructure/sqlite-database.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `auth-registration-domain-smoke-${process.pid}-${Date.now()}`);
const adminEmail = "admin@example.com";
const adminPassword = "password123";

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "inline";
process.env.ADMIN_EMAIL = adminEmail;
process.env.ADMIN_PASSWORD = adminPassword;
process.env.ADMIN_NAME = "Smoke Admin";
process.env.MAIL_GATEWAY_API_KEY = "auth-registration-domain-smoke-secret";

mkdirSync(dataDir, { recursive: true });

interface RequestApp {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

interface JsonResult {
  response: Response;
  body: unknown;
}

async function main(): Promise<void> {
  try {
    const [{ app }, { closeDatabase, db }] = await Promise.all([import("../index.js"), import("../infrastructure/database.js")]);
    try {
      await smokeRegistrationDomainAllowlist(app, db);
    } finally {
      await closeDatabase();
    }

    console.log("auth registration domain smoke checks passed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function smokeRegistrationDomainAllowlist(app: RequestApp, db: SqliteDatabase): Promise<void> {
  const timestamp = Date.now();

  const authMe = await requestJson(app, "/api/auth/me");
  expect(authMe.response.status === 200, "auth/me returns 200");
  expectDomains(authMe.body, DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS, "auth/me returns default registration domains");

  const blockedDefault = await register(app, {
    name: "Blocked Default",
    email: `blocked-default-${timestamp}@example.com`,
    password: "password123"
  });
  expect(blockedDefault.response.status === 403, "unsupported default domain is blocked");
  expect(errorCode(blockedDefault.body) === "email_domain_not_allowed", "unsupported domain returns email_domain_not_allowed");
  expectNoUser(db, `blocked-default-${timestamp}@example.com`, "blocked unsupported domain does not create a user");

  db.update(appSettings).set({ allowedRegistrationEmailDomainsJson: null }).where(eq(appSettings.id, "default")).run();
  const nullAllowlist = await requestJson(app, "/api/auth/me");
  expectDomains(nullAllowlist.body, DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS, "null allowlist falls back to default domains");

  db.update(appSettings).set({ allowedRegistrationEmailDomainsJson: "not-json" }).where(eq(appSettings.id, "default")).run();
  const brokenAllowlist = await requestJson(app, "/api/auth/me");
  expectDomains(brokenAllowlist.body, DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS, "broken JSON allowlist falls back to default domains");

  const allowedDefault = await register(app, {
    name: "Allowed Default",
    email: `allowed-default-${timestamp}@qq.com`,
    password: "password123"
  });
  expect(allowedDefault.response.status === 201, "default allowed domain can register");

  const adminLogin = await requestJson(app, "/api/auth/login", {
    body: {
      email: adminEmail,
      password: adminPassword
    },
    method: "POST"
  });
  expect(adminLogin.response.status === 200, "admin can log in");
  const cookie = sessionCookie(adminLogin.response);
  expect(Boolean(cookie), "admin login returns session cookie");

  const invalidAllowlist = await requestJson(app, "/api/admin/settings", {
    body: {
      allowedRegistrationEmailDomains: ["bad_domain"]
    },
    cookie,
    method: "PATCH"
  });
  expect(invalidAllowlist.response.status === 400, "invalid allowlist returns 400");
  expect(errorCode(invalidAllowlist.body) === "invalid_admin_settings", "invalid allowlist uses invalid_admin_settings");

  const settingsAfterInvalid = await requestJson(app, "/api/admin/settings", { cookie });
  expectDomains(settingsAfterInvalid.body, DEFAULT_ALLOWED_REGISTRATION_EMAIL_DOMAINS, "invalid allowlist does not change settings");

  const normalizedAllowlist = await requestJson(app, "/api/admin/settings", {
    body: {
      allowedRegistrationEmailDomains: ["@QQ.COM", "", "qq.com"]
    },
    cookie,
    method: "PATCH"
  });
  expect(normalizedAllowlist.response.status === 200, "normalized allowlist saves");
  expectDomains(normalizedAllowlist.body, ["qq.com"], "allowlist trims, lowercases, strips @, and deduplicates");

  const emptyAllowlist = await requestJson(app, "/api/admin/settings", {
    body: {
      allowedRegistrationEmailDomains: []
    },
    cookie,
    method: "PATCH"
  });
  expect(emptyAllowlist.response.status === 200, "empty allowlist saves");
  expectDomains(emptyAllowlist.body, [], "empty allowlist is preserved as unrestricted");

  const openDomain = await register(app, {
    name: "Open Domain",
    email: `open-domain-${timestamp}@example.com`,
    password: "password123"
  });
  expect(openDomain.response.status === 201, "empty allowlist allows any valid domain");

  await requestJson(app, "/api/admin/settings", {
    body: {
      allowRegistration: false
    },
    cookie,
    method: "PATCH"
  });
  const closedRegistration = await register(app, {
    name: "Closed Registration",
    email: `closed-registration-${timestamp}@qq.com`,
    password: "password123"
  });
  expect(closedRegistration.response.status === 403, "closed registration blocks before domain logic");
  expect(errorCode(closedRegistration.body) === "registration_disabled", "closed registration keeps existing error code");
}

async function register(app: RequestApp, body: { name: string; email: string; password: string }): Promise<JsonResult> {
  const emailVerificationCode = "123456";
  await createVerificationChallenge(body.email, emailVerificationCode);
  return requestJson(app, "/api/auth/register", {
    body: {
      ...body,
      emailVerificationCode
    },
    method: "POST"
  });
}

async function createVerificationChallenge(email: string, code: string): Promise<void> {
  const { db } = await import("../infrastructure/database.js");
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();
  db.insert(registrationEmailVerifications)
    .values({
      email: normalizedEmail,
      codeHash: createHmac("sha256", process.env.MAIL_GATEWAY_API_KEY ?? "")
        .update(`${normalizedEmail}:${code}`)
        .digest("hex"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      verifyAttempts: 0,
      sendCount: 1,
      lastSentAt: now,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: registrationEmailVerifications.email,
      set: {
        codeHash: createHmac("sha256", process.env.MAIL_GATEWAY_API_KEY ?? "")
          .update(`${normalizedEmail}:${code}`)
          .digest("hex"),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        verifyAttempts: 0,
        sendCount: 1,
        lastSentAt: now,
        updatedAt: now
      }
    })
    .run();
}

async function requestJson(
  app: RequestApp,
  path: string,
  options: { body?: unknown; cookie?: string; method?: string } = {}
): Promise<JsonResult> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }

  const response = await app.request(path, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET"
  });
  const body = (await response.json().catch(() => undefined)) as unknown;
  return { response, body };
}

function expectDomains(body: unknown, expected: readonly string[], message: string): void {
  const domains = settingsDomains(body);
  expect(
    Array.isArray(domains) &&
      domains.length === expected.length &&
      domains.every((domain, index) => domain === expected[index]),
    message
  );
}

function settingsDomains(body: unknown): unknown {
  if (!isRecord(body)) {
    return undefined;
  }

  const settings = isRecord(body.settings) ? body.settings : undefined;
  return settings?.allowedRegistrationEmailDomains;
}

function errorCode(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.code !== "string") {
    return undefined;
  }
  return body.error.code;
}

function sessionCookie(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function expectNoUser(db: SqliteDatabase, email: string, message: string): void {
  const user = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  expect(!user, message);
  const transactions = db.select().from(creditTransactions).all();
  expect(transactions.length === 0, `${message}; no credit transaction is created`);
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
