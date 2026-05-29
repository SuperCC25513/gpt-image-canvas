import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { appSettings, creditTransactions, registrationEmailVerifications, users } from "../infrastructure/schema.js";
import type { SqliteDatabase } from "../infrastructure/sqlite-database.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `auth-registration-email-verification-smoke-${process.pid}-${Date.now()}`);
const adminEmail = "admin@example.com";
const adminPassword = "password123";
const mailApiKey = "mail-gateway-smoke-secret";

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "inline";
process.env.ADMIN_EMAIL = adminEmail;
process.env.ADMIN_PASSWORD = adminPassword;
process.env.ADMIN_NAME = "Smoke Admin";
process.env.MAIL_GATEWAY_API_KEY = mailApiKey;

mkdirSync(dataDir, { recursive: true });

interface RequestApp {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

interface JsonResult {
  response: Response;
  body: unknown;
}

interface MailGatewayState {
  capturedCodes: Map<string, string>;
  sendCount: number;
  status: number;
}

async function main(): Promise<void> {
  const gateway = await startMailGateway();
  process.env.MAIL_GATEWAY_BASE_URL = gateway.baseUrl;
  try {
    const [{ app }, { closeDatabase, db }] = await Promise.all([import("../index.js"), import("../infrastructure/database.js")]);
    try {
      await smokeRegistrationEmailVerification(app, db, gateway.state);
    } finally {
      await closeDatabase();
    }

    console.log("auth registration email verification smoke checks passed");
  } finally {
    await new Promise<void>((resolve) => gateway.server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function smokeRegistrationEmailVerification(
  app: RequestApp,
  db: SqliteDatabase,
  gateway: MailGatewayState
): Promise<void> {
  const timestamp = Date.now();

  const blockedEmail = `blocked-${timestamp}@example.com`;
  const blockedSend = await sendVerification(app, blockedEmail);
  expect(blockedSend.response.status === 403, "unsupported email domain cannot request a code");
  expect(errorCode(blockedSend.body) === "email_domain_not_allowed", "unsupported domain keeps existing error code");
  expect(gateway.sendCount === 0, "unsupported domain does not call mail gateway");

  const email = `verified-${timestamp}@qq.com`;
  const send = await sendVerification(app, email);
  expect(send.response.status === 200, "allowed domain can request a verification code");
  expect(typeof recordValue(send.body, "expiresAt") === "string", "send response includes expiresAt");
  expect(!Object.hasOwn(isRecord(send.body) ? send.body : {}, "code"), "send response does not include plaintext code");
  expect(gateway.sendCount === 1, "mail gateway receives one send request");
  const code = gateway.capturedCodes.get(email);
  expect(Boolean(code), "mail gateway captures verification code for the email");

  const resend = await sendVerification(app, email);
  expect(resend.response.status === 429, "same email inside cooldown is rate limited");
  expect(errorCode(resend.body) === "email_verification_rate_limited", "cooldown uses email_verification_rate_limited");
  expect(gateway.sendCount === 1, "cooldown does not call mail gateway again");

  await expectRejectedRegistration(app, db, {
    body: {
      name: "Missing Code",
      email,
      password: "password123"
    },
    code: "email_verification_required",
    message: "missing code cannot register",
    status: 400,
    userEmail: email
  });

  await expectRejectedRegistration(app, db, {
    body: {
      name: "Wrong Code",
      email,
      password: "password123",
      emailVerificationCode: "000000"
    },
    code: "email_verification_invalid",
    message: "wrong code cannot register",
    status: 400,
    userEmail: email
  });

  const mismatchSource = `mismatch-source-${timestamp}@qq.com`;
  const mismatchTarget = `mismatch-target-${timestamp}@qq.com`;
  await sendVerification(app, mismatchSource);
  const mismatchCode = gateway.capturedCodes.get(mismatchSource);
  expect(Boolean(mismatchCode), "mismatch source receives code");
  await expectRejectedRegistration(app, db, {
    body: {
      name: "Mismatch",
      email: mismatchTarget,
      password: "password123",
      emailVerificationCode: mismatchCode
    },
    code: "email_verification_invalid",
    message: "code for email A cannot register email B",
    status: 400,
    userEmail: mismatchTarget
  });

  const expiredEmail = `expired-${timestamp}@qq.com`;
  await sendVerification(app, expiredEmail);
  const expiredCode = gateway.capturedCodes.get(expiredEmail);
  expect(Boolean(expiredCode), "expired scenario receives code");
  db.update(registrationEmailVerifications)
    .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(registrationEmailVerifications.email, expiredEmail))
    .run();
  await expectRejectedRegistration(app, db, {
    body: {
      name: "Expired",
      email: expiredEmail,
      password: "password123",
      emailVerificationCode: expiredCode
    },
    code: "email_verification_expired",
    message: "expired code cannot register",
    status: 400,
    userEmail: expiredEmail
  });

  const attemptsEmail = `attempts-${timestamp}@qq.com`;
  await sendVerification(app, attemptsEmail);
  const attemptsCode = gateway.capturedCodes.get(attemptsEmail);
  expect(Boolean(attemptsCode), "attempts scenario receives code");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await register(app, {
      name: "Too Many Attempts",
      email: attemptsEmail,
      password: "password123",
      emailVerificationCode: "999999"
    });
    expect(failed.response.status === 400, "wrong attempt is rejected");
    expect(errorCode(failed.body) === "email_verification_invalid", "wrong attempt uses invalid code");
  }
  await expectRejectedRegistration(app, db, {
    body: {
      name: "Too Many Attempts",
      email: attemptsEmail,
      password: "password123",
      emailVerificationCode: attemptsCode
    },
    code: "email_verification_invalid",
    message: "correct code cannot register after attempt limit",
    status: 400,
    userEmail: attemptsEmail
  });

  const success = await register(app, {
    name: "Verified User",
    email,
    password: "password123",
    emailVerificationCode: code
  });
  expect(success.response.status === 201, "correct code creates active account");
  expect(Boolean(sessionCookie(success.response)), "active account receives session cookie");
  expectUser(db, email, "active", "active registration creates user");

  db.update(appSettings).set({ requireApproval: 1 }).where(eq(appSettings.id, "default")).run();
  const pendingEmail = `pending-${timestamp}@qq.com`;
  await sendVerification(app, pendingEmail);
  const pendingCode = gateway.capturedCodes.get(pendingEmail);
  expect(Boolean(pendingCode), "pending scenario receives code");
  const pending = await register(app, {
    name: "Pending User",
    email: pendingEmail,
    password: "password123",
    emailVerificationCode: pendingCode
  });
  expect(pending.response.status === 202, "correct code keeps requireApproval pending branch");
  expect(!sessionCookie(pending.response), "pending account does not receive session cookie");
  expectUser(db, pendingEmail, "pending", "pending registration creates pending user");

  gateway.status = 503;
  const unavailableEmail = `unavailable-${timestamp}@qq.com`;
  const unavailable = await sendVerification(app, unavailableEmail);
  expect(unavailable.response.status === 503, "gateway failure returns unavailable");
  expect(errorCode(unavailable.body) === "email_verification_unavailable", "gateway failure uses stable local code");
  expect(
    !db.select().from(registrationEmailVerifications).where(eq(registrationEmailVerifications.email, unavailableEmail)).get(),
    "gateway failure does not leave an unusable verification challenge"
  );
  gateway.status = 200;
  const retryAfterUnavailable = await sendVerification(app, unavailableEmail);
  expect(retryAfterUnavailable.response.status === 200, "same email can retry after gateway recovers");
  expect(Boolean(gateway.capturedCodes.get(unavailableEmail)), "retry after gateway recovery sends a usable code");

  const sendsBeforeClosed = gateway.sendCount;
  db.update(appSettings).set({ allowRegistration: 0 }).where(eq(appSettings.id, "default")).run();
  const closed = await sendVerification(app, `closed-${timestamp}@qq.com`);
  expect(closed.response.status === 403, "closed registration blocks verification send");
  expect(errorCode(closed.body) === "registration_disabled", "closed registration keeps existing error code");
  expect(gateway.sendCount === sendsBeforeClosed, "closed registration does not call mail gateway");
}

async function expectRejectedRegistration(
  app: RequestApp,
  db: SqliteDatabase,
  input: {
    body: Record<string, unknown>;
    code: string;
    message: string;
    status: number;
    userEmail: string;
  }
): Promise<void> {
  const creditCountBefore = db.select().from(creditTransactions).all().length;
  const response = await register(app, input.body);
  expect(response.response.status === input.status, input.message);
  expect(errorCode(response.body) === input.code, `${input.message}; expected ${input.code}`);
  expectNoUser(db, input.userEmail, input.message);
  expect(db.select().from(creditTransactions).all().length === creditCountBefore, `${input.message}; no credit transaction is created`);
}

async function startMailGateway(): Promise<{
  baseUrl: string;
  server: ReturnType<typeof createServer>;
  state: MailGatewayState;
}> {
  const state: MailGatewayState = {
    capturedCodes: new Map<string, string>(),
    sendCount: 0,
    status: 200
  };
  const server = createServer((request, response) => {
    void handleMailGatewayRequest(request, response, state);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    state
  };
}

async function handleMailGatewayRequest(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  state: MailGatewayState
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/v1/emails/send") {
    writeJson(response, 404, { error: { code: "not_found", message: "not found" } });
    return;
  }

  if (request.headers["x-api-key"] !== mailApiKey) {
    writeJson(response, 401, { request_id: "req-smoke", error: { code: "unauthorized", message: "unauthorized" } });
    return;
  }

  const body = await readRequestJson(request);
  state.sendCount += 1;
  if (state.status !== 200) {
    writeJson(response, state.status, {
      request_id: "req-smoke",
      error: { code: "provider_unavailable", message: "provider unavailable" }
    });
    return;
  }

  if (
    isRecord(body) &&
    body.type === "verification_code" &&
    typeof body.to === "string" &&
    typeof body.code === "string"
  ) {
    state.capturedCodes.set(body.to, body.code);
  }

  writeJson(response, 200, { request_id: "req-smoke", status: "sent", provider: "smoke" });
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJson(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

async function sendVerification(app: RequestApp, email: string): Promise<JsonResult> {
  return requestJson(app, "/api/auth/registration-email-verifications", {
    body: {
      email,
      locale: "zh-CN"
    },
    method: "POST"
  });
}

async function register(app: RequestApp, body: Record<string, unknown>): Promise<JsonResult> {
  return requestJson(app, "/api/auth/register", {
    body,
    method: "POST"
  });
}

async function requestJson(
  app: RequestApp,
  path: string,
  options: { body?: unknown; method?: string } = {}
): Promise<JsonResult> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await app.request(path, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET"
  });
  const body = (await response.json().catch(() => undefined)) as unknown;
  return { response, body };
}

function errorCode(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.code !== "string") {
    return undefined;
  }
  return body.error.code;
}

function recordValue(body: unknown, key: string): unknown {
  return isRecord(body) ? body[key] : undefined;
}

function sessionCookie(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function expectNoUser(db: SqliteDatabase, email: string, message: string): void {
  const user = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  expect(!user, `${message}; user should not exist`);
}

function expectUser(db: SqliteDatabase, email: string, status: string, message: string): void {
  const user = db.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, email)).get();
  expect(user?.status === status, message);
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
