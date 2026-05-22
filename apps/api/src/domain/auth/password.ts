import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Callback);
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";

export interface PasswordHash {
  salt: string;
  iterations: number;
  hash: string;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16).toString("base64url");
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  return {
    salt,
    iterations: PASSWORD_ITERATIONS,
    hash
  };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await derivePasswordHash(password, stored.salt, stored.iterations);
  const candidateBuffer = Buffer.from(candidate, "base64url");
  const storedBuffer = Buffer.from(stored.hash, "base64url");
  if (candidateBuffer.byteLength !== storedBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(candidateBuffer, storedBuffer);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<string> {
  const key = await pbkdf2(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);
  return key.toString("base64url");
}
