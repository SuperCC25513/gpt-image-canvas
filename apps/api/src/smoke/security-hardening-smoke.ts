import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `security-hardening-smoke-${process.pid}-${Date.now()}`);
const adminEmail = "admin@example.com";
const adminPassword = "admin-password-123";
const userEmail = "user@example.com";
const userPassword = "user-password-123";

process.env.DATA_DIR = dataDir;
process.env.USE_MYSQL = "false";
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.GENERATION_QUEUE_DRIVER = "inline";
process.env.ADMIN_EMAIL = adminEmail;
process.env.ADMIN_PASSWORD = adminPassword;
process.env.ADMIN_NAME = "Security Smoke Admin";

mkdirSync(dataDir, { recursive: true });

interface RequestApp {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
}

async function main(): Promise<void> {
  try {
    const [{ app }, { closeDatabase, db }, { users }, { hashPassword }] = await Promise.all([
      import("../index.js"),
      import("../infrastructure/database.js"),
      import("../infrastructure/schema.js"),
      import("../domain/auth/password.js")
    ]);

    try {
      const password = await hashPassword(userPassword);
      const now = new Date().toISOString();
      db.insert(users)
        .values({
          id: "security-smoke-user",
          name: "Security Smoke User",
          email: userEmail,
          passwordSalt: password.salt,
          passwordIterations: password.iterations,
          passwordHash: password.hash,
          role: "user",
          status: "active",
          credits: 0,
          createdAt: now,
          updatedAt: now
        })
        .run();

      await smokeSecurityHeaders(app);
      await smokeJsonBodyLimit(app);
      await smokeLoginRateLimit(app);
      await smokeAgentSkillAdminWrites(app);
    } finally {
      await closeDatabase();
    }

    console.log("security hardening smoke checks passed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function smokeSecurityHeaders(app: RequestApp): Promise<void> {
  const response = await app.request("/api/config");
  expect(response.status === 200, "config endpoint responds");
  expect(response.headers.get("x-content-type-options") === "nosniff", "API response includes nosniff");
  expect(response.headers.get("x-frame-options") === "DENY", "API response denies framing");
  expect(Boolean(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")), "API response includes CSP");
}

async function smokeJsonBodyLimit(app: RequestApp): Promise<void> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "large@example.com", password: "x".repeat(2 * 1024 * 1024) })
  });
  const body = (await response.json()) as unknown;
  expect(response.status === 413, "oversized JSON returns 413");
  expect(errorCode(body) === "request_body_too_large", "oversized JSON uses stable code");
}

async function smokeLoginRateLimit(app: RequestApp): Promise<void> {
  const missingEmail = `missing-${Date.now()}@example.com`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await login(app, missingEmail, "wrong-password");
    expect(failed.response.status === 401, "missing account failed login returns invalid credentials before lock");
    expect(errorCode(failed.body) === "invalid_credentials", "missing account keeps invalid credentials code");
  }

  const limited = await login(app, missingEmail, "wrong-password");
  expect(limited.response.status === 429, "login failures are rate limited");
  expect(errorCode(limited.body) === "auth_rate_limited", "login rate limit uses stable code");
}

async function smokeAgentSkillAdminWrites(app: RequestApp): Promise<void> {
  const userCookie = await loginCookie(app, userEmail, userPassword);
  const adminCookie = await loginCookie(app, adminEmail, adminPassword);

  const userList = await requestJson(app, "/api/agent-skills", { cookie: userCookie });
  expect(userList.response.status === 200, `normal user can read Agent skills (${userList.response.status}: ${JSON.stringify(userList.body)})`);

  const forbidden = await requestJson(app, "/api/agent-skills", {
    cookie: userCookie,
    method: "POST",
    body: agentSkillBody("security-smoke-forbidden")
  });
  expect(forbidden.response.status === 403, "normal user cannot create Agent skills");
  expect(errorCode(forbidden.body) === "forbidden", "normal user write uses forbidden code");

  const created = await requestJson(app, "/api/agent-skills", {
    cookie: adminCookie,
    method: "POST",
    body: agentSkillBody("security-smoke-admin")
  });
  expect(created.response.status === 201, "admin can create Agent skills");
  expect(isRecord(created.body.skill) && created.body.skill.slug === "security-smoke-admin", "admin-created Agent skill persists");
}

function agentSkillBody(slug: string): Record<string, unknown> {
  return {
    slug,
    name: "Security Smoke Skill",
    description: "Security smoke test custom skill.",
    enabled: true,
    triggerMode: "auto",
    triggerKeywords: ["security-smoke"],
    files: [
      {
        path: "SKILL.md",
        content: `---\nname: ${slug}\ndescription: Security smoke test custom skill.\n---\n# Security Smoke`
      }
    ]
  };
}

async function loginCookie(app: RequestApp, email: string, password: string): Promise<string> {
  const result = await login(app, email, password);
  expect(result.response.status === 200, `login succeeds for ${email}`);
  const cookie = result.response.headers.get("set-cookie");
  expect(Boolean(cookie), `login returns a session cookie for ${email}`);
  return cookie?.split(";", 1)[0] ?? "";
}

async function login(app: RequestApp, email: string, password: string): Promise<{ response: Response; body: unknown }> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
    body: JSON.stringify({ email, password })
  });
  return {
    response,
    body: await response.json()
  };
}

async function requestJson(
  app: RequestApp,
  path: string,
  options: { body?: unknown; cookie?: string; method?: string } = {}
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.cookie) {
    headers.cookie = options.cookie;
  }

  const response = await app.request(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = (await response.json()) as unknown;
  expect(isRecord(body), `${path} response body is an object`);
  return { response, body };
}

function errorCode(body: unknown): string | undefined {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string" ? body.error.code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
