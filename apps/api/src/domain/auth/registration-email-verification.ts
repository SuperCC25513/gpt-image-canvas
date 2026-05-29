import { createHmac, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  AuthSettings,
  RegisterEmailVerificationRequest,
  RegisterEmailVerificationResponse
} from "../contracts.js";
import { isRegistrationEmailDomainAllowed } from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { registrationEmailVerifications } from "../../infrastructure/schema.js";
import { AuthDomainError } from "./auth-errors.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const DEFAULT_MAIL_GATEWAY_TIMEOUT_MS = 5000;
const EMAIL_CODE_DIGITS = 6;

interface RegistrationEmailVerificationRow {
  email: string;
  codeHash: string;
  expiresAt: string;
  verifyAttempts: number;
  sendCount: number;
  lastSentAt: string;
  createdAt: string;
  updatedAt: string;
}

interface RegistrationEmailVerificationPacket extends RowDataPacket {
  email: string;
  codeHash: string;
  expiresAt: string;
  verifyAttempts: number;
  sendCount: number;
  lastSentAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function sendRegistrationEmailVerification(
  input: RegisterEmailVerificationRequest,
  settings: AuthSettings,
  signal?: AbortSignal
): Promise<RegisterEmailVerificationResponse> {
  assertRegistrationPolicyAllowsEmail(input.email, settings);

  const email = normalizeEmail(input.email);
  const existing = await getVerificationRow(email);
  const nowMs = Date.now();
  if (existing && nowMs - Date.parse(existing.lastSentAt) < SEND_COOLDOWN_MS) {
    throw new AuthDomainError("email_verification_rate_limited", "验证码发送过于频繁，请稍后再试。", 429);
  }

  const config = readMailGatewayConfig();
  const code = generateVerificationCode();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + CODE_TTL_MS).toISOString();
  const row: RegistrationEmailVerificationRow = {
    email,
    codeHash: hashVerificationCode(email, code, config.apiKey),
    expiresAt,
    verifyAttempts: 0,
    sendCount: (existing?.sendCount ?? 0) + 1,
    lastSentAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await upsertVerificationRow(row);
  try {
    await sendVerificationCodeEmail({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      code,
      locale: input.locale,
      signal,
      timeoutMs: config.timeoutMs,
      to: email
    });
  } catch (error) {
    await restoreVerificationRow(email, existing);
    throw error;
  }

  return {
    ok: true,
    expiresAt
  };
}

export async function consumeRegistrationEmailVerification(input: { email: string; code: string }): Promise<void> {
  const email = normalizeEmail(input.email);
  const code = input.code.trim();
  if (!code) {
    throw new AuthDomainError("email_verification_required", "请输入邮箱验证码。", 400);
  }

  const secret = readMailGatewayApiKey();
  const row = await getVerificationRow(email);
  if (!row) {
    throw new AuthDomainError("email_verification_invalid", "邮箱验证码无效。", 400);
  }

  if (Date.parse(row.expiresAt) <= Date.now()) {
    await deleteVerificationRow(email);
    throw new AuthDomainError("email_verification_expired", "邮箱验证码已过期，请重新发送。", 400);
  }

  if (row.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
    await deleteVerificationRow(email);
    throw new AuthDomainError("email_verification_invalid", "邮箱验证码无效。", 400);
  }

  const expected = hashVerificationCode(email, code, secret);
  if (row.codeHash !== expected) {
    const nextAttempts = row.verifyAttempts + 1;
    if (nextAttempts >= MAX_VERIFY_ATTEMPTS) {
      await deleteVerificationRow(email);
    } else {
      await updateVerificationAttempts(email, nextAttempts, new Date().toISOString());
    }
    throw new AuthDomainError("email_verification_invalid", "邮箱验证码无效。", 400);
  }

  await deleteVerificationRow(email);
}

function assertRegistrationPolicyAllowsEmail(email: string, settings: AuthSettings): void {
  if (!settings.allowRegistration) {
    throw new AuthDomainError("registration_disabled", "当前未开放注册。", 403);
  }

  if (!isRegistrationEmailDomainAllowed(normalizeEmail(email), settings.allowedRegistrationEmailDomains)) {
    throw new AuthDomainError("email_domain_not_allowed", "当前邮箱后缀不支持注册。", 403);
  }
}

function readMailGatewayConfig(): { apiKey: string; baseUrl: string; timeoutMs: number } {
  const baseUrl = process.env.MAIL_GATEWAY_BASE_URL?.trim().replace(/\/+$/u, "");
  const apiKey = readMailGatewayApiKey();
  if (!baseUrl) {
    throw new AuthDomainError("email_verification_unavailable", "邮箱验证码服务暂不可用，请稍后重试。", 503);
  }

  return {
    apiKey,
    baseUrl,
    timeoutMs: parsePositiveInteger(process.env.MAIL_GATEWAY_TIMEOUT_MS, DEFAULT_MAIL_GATEWAY_TIMEOUT_MS)
  };
}

function readMailGatewayApiKey(): string {
  const apiKey = process.env.MAIL_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new AuthDomainError("email_verification_unavailable", "邮箱验证码服务暂不可用，请稍后重试。", 503);
  }
  return apiKey;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function generateVerificationCode(): string {
  return randomInt(0, 10 ** EMAIL_CODE_DIGITS).toString().padStart(EMAIL_CODE_DIGITS, "0");
}

function hashVerificationCode(email: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

async function sendVerificationCodeEmail(input: {
  apiKey: string;
  baseUrl: string;
  code: string;
  locale?: "zh-CN" | "en";
  signal?: AbortSignal;
  timeoutMs: number;
  to: string;
}): Promise<void> {
  const timeout = timeoutSignal(input.signal, input.timeoutMs);
  try {
    const response = await fetch(`${input.baseUrl}/v1/emails/send`, {
      body: JSON.stringify({
        type: "verification_code",
        to: input.to,
        code: input.code,
        locale: input.locale ?? "zh-CN"
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": input.apiKey
      },
      method: "POST",
      signal: timeout.signal
    });
    if (!response.ok) {
      throw new AuthDomainError("email_verification_unavailable", "邮箱验证码服务暂不可用，请稍后重试。", 503);
    }
  } catch (error) {
    if (error instanceof AuthDomainError) {
      throw error;
    }
    throw new AuthDomainError("email_verification_unavailable", "邮箱验证码服务暂不可用，请稍后重试。", 503);
  } finally {
    timeout.cleanup();
  }
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
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

async function getVerificationRow(email: string): Promise<RegistrationEmailVerificationRow | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(registrationEmailVerifications).where(eq(registrationEmailVerifications.email, email)).get();
    return row
      ? {
          email: row.email,
          codeHash: row.codeHash,
          expiresAt: row.expiresAt,
          verifyAttempts: row.verifyAttempts,
          sendCount: row.sendCount,
          lastSentAt: row.lastSentAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }
      : undefined;
  }

  const [rows] = await getMySqlPool().execute<RegistrationEmailVerificationPacket[]>(
    `SELECT email,
            code_hash AS codeHash,
            expires_at AS expiresAt,
            verify_attempts AS verifyAttempts,
            send_count AS sendCount,
            last_sent_at AS lastSentAt,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM registration_email_verifications
     WHERE email = ?`,
    [email]
  );
  return rows[0];
}

async function upsertVerificationRow(row: RegistrationEmailVerificationRow): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.insert(registrationEmailVerifications)
      .values(row)
      .onConflictDoUpdate({
        target: registrationEmailVerifications.email,
        set: {
          codeHash: row.codeHash,
          expiresAt: row.expiresAt,
          verifyAttempts: row.verifyAttempts,
          sendCount: row.sendCount,
          lastSentAt: row.lastSentAt,
          updatedAt: row.updatedAt
        }
      })
      .run();
    return;
  }

  await getMySqlPool().execute<ResultSetHeader>(
    `INSERT INTO registration_email_verifications
      (email, code_hash, expires_at, verify_attempts, send_count, last_sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       code_hash = VALUES(code_hash),
       expires_at = VALUES(expires_at),
       verify_attempts = VALUES(verify_attempts),
       send_count = VALUES(send_count),
       last_sent_at = VALUES(last_sent_at),
       updated_at = VALUES(updated_at)`,
    [row.email, row.codeHash, row.expiresAt, row.verifyAttempts, row.sendCount, row.lastSentAt, row.createdAt, row.updatedAt]
  );
}

async function updateVerificationAttempts(email: string, verifyAttempts: number, updatedAt: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.update(registrationEmailVerifications)
      .set({ verifyAttempts, updatedAt })
      .where(eq(registrationEmailVerifications.email, email))
      .run();
    return;
  }

  await getMySqlPool().execute<ResultSetHeader>(
    "UPDATE registration_email_verifications SET verify_attempts = ?, updated_at = ? WHERE email = ?",
    [verifyAttempts, updatedAt, email]
  );
}

async function deleteVerificationRow(email: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.delete(registrationEmailVerifications).where(eq(registrationEmailVerifications.email, email)).run();
    return;
  }

  await getMySqlPool().execute<ResultSetHeader>("DELETE FROM registration_email_verifications WHERE email = ?", [email]);
}

async function restoreVerificationRow(email: string, existing: RegistrationEmailVerificationRow | undefined): Promise<void> {
  if (existing) {
    await upsertVerificationRow(existing);
    return;
  }

  await deleteVerificationRow(email);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
