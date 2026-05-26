import { randomInt, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  AdminCreateRedemptionCodesRequest,
  AdminCreateRedemptionCodesResponse,
  AdminDeleteRedemptionCodeResponse,
  AdminUpdateRedemptionCodeRequest,
  CurrentUser,
  CreditTransaction,
  RedeemCreditCodeRequest,
  RedeemCreditCodeResponse,
  RedemptionCodeListResponse,
  RedemptionCodeStatus,
  RedemptionCodeSummary
} from "../contracts.js";
import { REDEMPTION_CODE_MAX_CREATE_COUNT, REDEMPTION_CODE_PREFIX } from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { creditRedemptions, creditTransactions, redemptionCodes, users } from "../../infrastructure/schema.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_GROUP_LENGTH = 4;
const CODE_GROUP_COUNT = 3;
const DEFAULT_ADMIN_REDEMPTION_CODE_LIMIT = 200;
const MAX_CODE_GENERATION_ATTEMPTS = 1000;

interface RedemptionCodePacket extends RowDataPacket {
  id: string;
  code: string;
  credits: number;
  status: RedemptionCodeStatus;
  expiresAt: string | null;
  redeemedByUserId: string | null;
  redeemedByUserName: string | null;
  redeemedByUserEmail: string | null;
  redeemedAt: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CurrentUserPacket extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

interface RedemptionRecordPacket extends RowDataPacket {
  id: string;
}

interface CreditTransactionInsert {
  id: string;
  userId: string;
  delta: number;
  reason: "redemption_code";
  relatedGenerationId: null;
  relatedOutputId: null;
  relatedCheckinDate: null;
  relatedRedemptionCodeId: string;
  adminNote: string;
  createdAt: string;
}

export class RedemptionCodeDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "RedemptionCodeDomainError";
  }
}

export async function listAdminRedemptionCodes(options: { limit?: number } = {}): Promise<RedemptionCodeListResponse> {
  const limit = redemptionCodeLimit(options.limit);
  if (databaseDriver === "sqlite") {
    const rows = db
      .select({
        id: redemptionCodes.id,
        code: redemptionCodes.code,
        credits: redemptionCodes.credits,
        status: redemptionCodes.status,
        expiresAt: redemptionCodes.expiresAt,
        redeemedByUserId: redemptionCodes.redeemedByUserId,
        redeemedByUserName: users.name,
        redeemedByUserEmail: users.email,
        redeemedAt: redemptionCodes.redeemedAt,
        createdByAdminId: redemptionCodes.createdByAdminId,
        createdAt: redemptionCodes.createdAt,
        updatedAt: redemptionCodes.updatedAt
      })
      .from(redemptionCodes)
      .leftJoin(users, eq(redemptionCodes.redeemedByUserId, users.id))
      .orderBy(desc(redemptionCodes.createdAt), desc(redemptionCodes.id))
      .limit(limit)
      .all();

    return {
      items: rows.map(redemptionCodeResponse)
    };
  }

  const [rows] = await getMySqlPool().execute<RedemptionCodePacket[]>(
    `${redemptionCodeSelectSql()}
     ORDER BY redemption_codes.created_at DESC, redemption_codes.id DESC
     LIMIT ?`,
    [limit]
  );

  return {
    items: rows.map(redemptionCodeResponse)
  };
}

export async function createAdminRedemptionCodes(
  input: AdminCreateRedemptionCodesRequest,
  admin: CurrentUser
): Promise<AdminCreateRedemptionCodesResponse> {
  const now = nowIso();
  const codes = await generateUniqueRedemptionCodes(input.count);
  const rows = codes.map((code) => ({
    id: `redemption-code-${randomUUID()}`,
    code,
    credits: input.credits,
    status: "active" as RedemptionCodeStatus,
    expiresAt: input.expiresAt ?? null,
    redeemedByUserId: null,
    redeemedAt: null,
    createdByAdminId: admin.id,
    createdAt: now,
    updatedAt: now
  }));

  if (databaseDriver === "sqlite") {
    db.transaction((tx) => {
      tx.insert(redemptionCodes).values(rows).run();
    });
    return {
      items: rows.map((row) => redemptionCodeResponse({ ...row, redeemedByUserName: null, redeemedByUserEmail: null }))
    };
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO redemption_codes
          (id, code, credits, status, expires_at, redeemed_by_user_id, redeemed_at, created_by_admin_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.code,
          row.credits,
          row.status,
          row.expiresAt,
          row.redeemedByUserId,
          row.redeemedAt,
          row.createdByAdminId,
          row.createdAt,
          row.updatedAt
        ]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    items: rows.map((row) => redemptionCodeResponse({ ...row, redeemedByUserName: null, redeemedByUserEmail: null }))
  };
}

export async function updateAdminRedemptionCode(
  codeId: string,
  input: AdminUpdateRedemptionCodeRequest
): Promise<RedemptionCodeSummary> {
  const now = nowIso();
  if (databaseDriver === "sqlite") {
    const existing = db.select().from(redemptionCodes).where(eq(redemptionCodes.id, codeId)).get();
    if (!existing) {
      throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);
    }

    db.update(redemptionCodes)
      .set({
        status: input.status,
        updatedAt: now
      })
      .where(eq(redemptionCodes.id, codeId))
      .run();

    const updated = db
      .select({
        id: redemptionCodes.id,
        code: redemptionCodes.code,
        credits: redemptionCodes.credits,
        status: redemptionCodes.status,
        expiresAt: redemptionCodes.expiresAt,
        redeemedByUserId: redemptionCodes.redeemedByUserId,
        redeemedByUserName: users.name,
        redeemedByUserEmail: users.email,
        redeemedAt: redemptionCodes.redeemedAt,
        createdByAdminId: redemptionCodes.createdByAdminId,
        createdAt: redemptionCodes.createdAt,
        updatedAt: redemptionCodes.updatedAt
      })
      .from(redemptionCodes)
      .leftJoin(users, eq(redemptionCodes.redeemedByUserId, users.id))
      .where(eq(redemptionCodes.id, codeId))
      .get();

    return redemptionCodeResponse(updated ?? { ...existing, status: input.status, updatedAt: now, redeemedByUserName: null, redeemedByUserEmail: null });
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<RedemptionCodePacket[]>(
      `${redemptionCodeSelectSql()}
       WHERE redemption_codes.id = ?
       LIMIT 1
       FOR UPDATE`,
      [codeId]
    );
    if (!existingRows[0]) {
      throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);
    }

    await connection.execute("UPDATE redemption_codes SET status = ?, updated_at = ? WHERE id = ?", [
      input.status,
      now,
      codeId
    ]);
    await connection.commit();

    return {
      ...redemptionCodeResponse(existingRows[0]),
      status: input.status,
      updatedAt: now
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteAdminRedemptionCode(codeId: string): Promise<AdminDeleteRedemptionCodeResponse> {
  if (databaseDriver === "sqlite") {
    return db.transaction((tx) => {
      const existing = tx.select().from(redemptionCodes).where(eq(redemptionCodes.id, codeId)).get();
      if (!existing) {
        throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);
      }
      if (existing.redeemedByUserId || existing.redeemedAt) {
        throw new RedemptionCodeDomainError("redemption_code_has_redemption", "已兑换的兑换码不能删除。", 409);
      }

      const redemption = tx.select({ id: creditRedemptions.id }).from(creditRedemptions).where(eq(creditRedemptions.codeId, codeId)).get();
      if (redemption) {
        throw new RedemptionCodeDomainError("redemption_code_has_redemption", "已有兑换记录的兑换码不能删除。", 409);
      }

      tx.delete(redemptionCodes).where(eq(redemptionCodes.id, codeId)).run();
      return {
        ok: true,
        id: codeId
      };
    });
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<Array<RowDataPacket & { redeemedByUserId: string | null; redeemedAt: string | null }>>(
      `SELECT redeemed_by_user_id AS redeemedByUserId,
              redeemed_at AS redeemedAt
       FROM redemption_codes
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [codeId]
    );
    const existing = existingRows[0];
    if (!existing) {
      throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);
    }
    if (existing.redeemedByUserId || existing.redeemedAt) {
      throw new RedemptionCodeDomainError("redemption_code_has_redemption", "已兑换的兑换码不能删除。", 409);
    }

    const [redemptions] = await connection.execute<RedemptionRecordPacket[]>(
      "SELECT id FROM credit_redemptions WHERE code_id = ? LIMIT 1 FOR UPDATE",
      [codeId]
    );
    if (redemptions[0]) {
      throw new RedemptionCodeDomainError("redemption_code_has_redemption", "已有兑换记录的兑换码不能删除。", 409);
    }

    await connection.execute("DELETE FROM redemption_codes WHERE id = ?", [codeId]);
    await connection.commit();
    return {
      ok: true,
      id: codeId
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function redeemCreditCode(user: CurrentUser, input: RedeemCreditCodeRequest): Promise<RedeemCreditCodeResponse> {
  const normalizedCode = normalizeRedemptionCode(input.code);
  const now = nowIso();

  if (databaseDriver === "sqlite") {
    return db.transaction((tx) => {
      const code = tx.select().from(redemptionCodes).where(eq(redemptionCodes.code, normalizedCode)).get();
      if (!code) {
        throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);
      }
      assertRedeemableCode(code, now);

      const userRow = tx.select().from(users).where(eq(users.id, user.id)).get();
      if (!userRow) {
        throw new RedemptionCodeDomainError("unauthorized", "请先登录。", 401);
      }

      const transaction = redemptionCreditTransaction({
        userId: user.id,
        codeId: code.id,
        credits: code.credits,
        codeShort: shortRedemptionCode(code.code),
        createdAt: now
      });
      tx.update(users)
        .set({
          credits: userRow.credits + code.credits,
          updatedAt: now
        })
        .where(eq(users.id, user.id))
        .run();
      tx.insert(creditTransactions).values(transaction).run();
      tx.insert(creditRedemptions)
        .values({
          id: `credit-redemption-${randomUUID()}`,
          codeId: code.id,
          userId: user.id,
          creditsAwarded: code.credits,
          transactionId: transaction.id,
          createdAt: now
        })
        .run();
      tx.update(redemptionCodes)
        .set({
          redeemedByUserId: user.id,
          redeemedAt: now,
          updatedAt: now
        })
        .where(eq(redemptionCodes.id, code.id))
        .run();

      return {
        user: currentUserFromSqlite({ ...userRow, credits: userRow.credits + code.credits, updatedAt: now }),
        transaction: creditTransactionResponse(transaction),
        redemption: {
          codeId: code.id,
          codeShort: shortRedemptionCode(code.code),
          creditsAwarded: code.credits,
          redeemedAt: now
        }
      };
    });
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [codeRows] = await connection.execute<RedemptionCodePacket[]>(
      `${redemptionCodeSelectSql()}
       WHERE redemption_codes.code = ?
       LIMIT 1
       FOR UPDATE`,
      [normalizedCode]
    );
    const code = codeRows[0];
    if (!code) {
      throw new RedemptionCodeDomainError("redemption_code_not_found", "找不到该兑换码。", 404);
    }
    assertRedeemableCode(code, now);

    const [userRows] = await connection.execute<CurrentUserPacket[]>(
      `SELECT id,
              name,
              email,
              role,
              status,
              credits,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [user.id]
    );
    const userRow = userRows[0];
    if (!userRow) {
      throw new RedemptionCodeDomainError("unauthorized", "请先登录。", 401);
    }

    const transaction = redemptionCreditTransaction({
      userId: user.id,
      codeId: code.id,
      credits: code.credits,
      codeShort: shortRedemptionCode(code.code),
      createdAt: now
    });
    await connection.execute("UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?", [
      code.credits,
      now,
      user.id
    ]);
    await insertMySqlCreditTransaction(connection, transaction);
    await connection.execute(
      `INSERT INTO credit_redemptions (id, code_id, user_id, credits_awarded, transaction_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`credit-redemption-${randomUUID()}`, code.id, user.id, code.credits, transaction.id, now]
    );
    await connection.execute(
      `UPDATE redemption_codes
       SET redeemed_by_user_id = ?, redeemed_at = ?, updated_at = ?
       WHERE id = ?`,
      [user.id, now, now, code.id]
    );
    await connection.commit();

    return {
      user: currentUserFromPacket({
        ...userRow,
        credits: userRow.credits + code.credits,
        updatedAt: now
      }),
      transaction: creditTransactionResponse(transaction),
      redemption: {
        codeId: code.id,
        codeShort: shortRedemptionCode(code.code),
        creditsAwarded: code.credits,
        redeemedAt: now
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function assertRedeemableCode(
  code: Pick<typeof redemptionCodes.$inferSelect, "status" | "expiresAt" | "redeemedByUserId" | "redeemedAt"> | RedemptionCodePacket,
  now: string
): void {
  if (code.status !== "active") {
    throw new RedemptionCodeDomainError("redemption_code_disabled", "该兑换码已停用。", 400);
  }
  if (code.expiresAt && Date.parse(code.expiresAt) <= Date.parse(now)) {
    throw new RedemptionCodeDomainError("redemption_code_expired", "该兑换码已过期。", 400);
  }
  if (code.redeemedByUserId || code.redeemedAt) {
    throw new RedemptionCodeDomainError("redemption_code_redeemed", "该兑换码已被使用。", 409);
  }
}

async function generateUniqueRedemptionCodes(count: number): Promise<string[]> {
  const values = new Set<string>();
  let attempts = 0;
  while (values.size < count) {
    attempts += 1;
    if (attempts > MAX_CODE_GENERATION_ATTEMPTS) {
      throw new RedemptionCodeDomainError("redemption_code_generation_failed", "兑换码生成失败，请重试。", 500);
    }

    const candidate = generateRedemptionCode();
    if (values.has(candidate) || (await redemptionCodeExists(candidate))) {
      continue;
    }
    values.add(candidate);
  }

  return [...values];
}

function generateRedemptionCode(): string {
  const groups = Array.from({ length: CODE_GROUP_COUNT }, () =>
    Array.from({ length: CODE_GROUP_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")
  );
  return `${REDEMPTION_CODE_PREFIX}-${groups.join("-")}`;
}

async function redemptionCodeExists(code: string): Promise<boolean> {
  if (databaseDriver === "sqlite") {
    const row = db.select({ id: redemptionCodes.id }).from(redemptionCodes).where(eq(redemptionCodes.code, code)).get();
    return Boolean(row);
  }

  const [rows] = await getMySqlPool().execute<Array<RowDataPacket & { id: string }>>(
    "SELECT id FROM redemption_codes WHERE code = ? LIMIT 1",
    [code]
  );
  return rows.length > 0;
}

function redemptionCodeResponse(
  row:
    | RedemptionCodePacket
    | (typeof redemptionCodes.$inferSelect & {
        redeemedByUserName?: string | null;
        redeemedByUserEmail?: string | null;
      })
): RedemptionCodeSummary {
  return {
    id: row.id,
    code: row.code,
    credits: row.credits,
    status: row.status === "disabled" ? "disabled" : "active",
    expiresAt: row.expiresAt ?? undefined,
    redeemedByUserId: row.redeemedByUserId ?? undefined,
    redeemedByUserName: row.redeemedByUserName ?? undefined,
    redeemedByUserEmail: row.redeemedByUserEmail ?? undefined,
    redeemedAt: row.redeemedAt ?? undefined,
    createdByAdminId: row.createdByAdminId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function redemptionCreditTransaction(input: {
  userId: string;
  codeId: string;
  credits: number;
  codeShort: string;
  createdAt: string;
}): CreditTransactionInsert {
  return {
    id: `credit-${randomUUID()}`,
    userId: input.userId,
    delta: input.credits,
    reason: "redemption_code",
    relatedGenerationId: null,
    relatedOutputId: null,
    relatedCheckinDate: null,
    relatedRedemptionCodeId: input.codeId,
    adminNote: `code:${input.codeShort}`,
    createdAt: input.createdAt
  };
}

async function insertMySqlCreditTransaction(
  connection: PoolConnection,
  transaction: CreditTransactionInsert
): Promise<void> {
  await connection.execute(
    `INSERT INTO credit_transactions
      (id, user_id, delta, reason, related_generation_id, related_output_id, related_checkin_date, related_redemption_code_id, admin_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transaction.id,
      transaction.userId,
      transaction.delta,
      transaction.reason,
      transaction.relatedGenerationId,
      transaction.relatedOutputId,
      transaction.relatedCheckinDate,
      transaction.relatedRedemptionCodeId,
      transaction.adminNote,
      transaction.createdAt
    ]
  );
}

function creditTransactionResponse(transaction: CreditTransactionInsert): CreditTransaction {
  return {
    id: transaction.id,
    userId: transaction.userId,
    delta: transaction.delta,
    reason: transaction.reason,
    relatedRedemptionCodeId: transaction.relatedRedemptionCodeId,
    adminNote: transaction.adminNote,
    createdAt: transaction.createdAt
  };
}

function currentUserFromSqlite(row: typeof users.$inferSelect): CurrentUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "pending" || row.status === "disabled" ? row.status : "active",
    credits: row.credits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function currentUserFromPacket(row: CurrentUserPacket): CurrentUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "pending" || row.status === "disabled" ? row.status : "active",
    credits: row.credits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function redemptionCodeSelectSql(): string {
  return `SELECT redemption_codes.id,
                 redemption_codes.code,
                 redemption_codes.credits,
                 redemption_codes.status,
                 redemption_codes.expires_at AS expiresAt,
                 redemption_codes.redeemed_by_user_id AS redeemedByUserId,
                 redeemed_users.name AS redeemedByUserName,
                 redeemed_users.email AS redeemedByUserEmail,
                 redemption_codes.redeemed_at AS redeemedAt,
                 redemption_codes.created_by_admin_id AS createdByAdminId,
                 redemption_codes.created_at AS createdAt,
                 redemption_codes.updated_at AS updatedAt
          FROM redemption_codes
          LEFT JOIN users AS redeemed_users ON redemption_codes.redeemed_by_user_id = redeemed_users.id`;
}

function redemptionCodeLimit(value: number | undefined): number {
  return Math.min(positiveOrDefault(value, DEFAULT_ADMIN_REDEMPTION_CODE_LIMIT), REDEMPTION_CODE_MAX_CREATE_COUNT);
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeRedemptionCode(value: string): string {
  return value.trim().toUpperCase();
}

function shortRedemptionCode(value: string): string {
  const normalized = normalizeRedemptionCode(value);
  return normalized.length > 12 ? `${normalized.slice(0, 8)}...${normalized.slice(-4)}` : normalized;
}

function nowIso(): string {
  return new Date().toISOString();
}
