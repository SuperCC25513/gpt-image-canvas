import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  CheckinResponse,
  CheckinStatus,
  CreditTransaction,
  CreditTransactionReason,
  CurrentUser
} from "../contracts.js";
import {
  DEFAULT_CHECKIN_CREDIT,
  DEFAULT_GENERATION_CREDIT_COST,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_REGISTRATION_CREDITS
} from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { appSettings, creditTransactions, generationRecords, userCheckins, users } from "../../infrastructure/schema.js";

const APP_SETTINGS_ID = "default";

interface CreditSettings {
  defaultCredits: number;
  generationCreditCost: number;
  checkinCredit: number;
  maxImagesPerRequest: number;
}

interface CreditTransactionRow extends RowDataPacket {
  id: string;
  userId: string;
  delta: number;
  reason: CreditTransactionReason;
  relatedGenerationId: string | null;
  relatedOutputId: string | null;
  relatedCheckinDate: string | null;
  adminNote: string | null;
  createdAt: string;
}

interface UserPacket extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

interface CreditTransactionInsert {
  id: string;
  userId: string;
  delta: number;
  reason: CreditTransactionReason;
  relatedGenerationId: string | null;
  relatedOutputId: string | null;
  relatedCheckinDate: string | null;
  adminNote: string | null;
  createdAt: string;
}

export class CreditDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "CreditDomainError";
  }
}

export async function getCheckinStatus(userId: string): Promise<CheckinStatus> {
  const settings = await readCreditSettings();
  const checkinDate = localDateKey();
  const existing = await findCheckin(userId, checkinDate);

  return {
    checkedInToday: Boolean(existing),
    checkinDate,
    creditAward: existing?.creditsAwarded ?? settings.checkinCredit
  };
}

export async function checkInUser(user: CurrentUser): Promise<CheckinResponse> {
  const settings = await readCreditSettings();
  const checkinDate = localDateKey();
  const now = nowIso();

  if (databaseDriver === "sqlite") {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(userCheckins)
        .where(and(eq(userCheckins.userId, user.id), eq(userCheckins.checkinDate, checkinDate)))
        .get();

      if (existing) {
        return {
          user: currentUserFromSqlite(selectSqliteUser(tx, user.id) ?? user),
          checkin: {
            checkedInToday: true,
            checkinDate,
            creditAward: existing.creditsAwarded
          }
        };
      }

      tx.insert(userCheckins)
        .values({
          userId: user.id,
          checkinDate,
          creditsAwarded: settings.checkinCredit,
          createdAt: now
        })
        .run();

      tx.update(users)
        .set({
          credits: sql`${users.credits} + ${settings.checkinCredit}`,
          updatedAt: now
        })
        .where(eq(users.id, user.id))
        .run();

      const transaction = creditTransaction({
        userId: user.id,
        delta: settings.checkinCredit,
        reason: "daily_checkin",
        relatedCheckinDate: checkinDate,
        createdAt: now
      });
      tx.insert(creditTransactions).values(transaction).run();

      return {
        user: currentUserFromSqlite(selectSqliteUser(tx, user.id) ?? { ...user, credits: user.credits + settings.checkinCredit, updatedAt: now }),
        checkin: {
          checkedInToday: true,
          checkinDate,
          creditAward: settings.checkinCredit
        },
        transaction: creditTransactionResponse(transaction)
      };
    });
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.execute<Array<RowDataPacket & { creditsAwarded: number }>>(
      `SELECT credits_awarded AS creditsAwarded
       FROM user_checkins
       WHERE user_id = ? AND checkin_date = ?
       FOR UPDATE`,
      [user.id, checkinDate]
    );

    if (existingRows[0]) {
      const currentUser = (await selectMySqlCurrentUser(user.id, connection)) ?? user;
      await connection.commit();
      return {
        user: currentUser,
        checkin: {
          checkedInToday: true,
          checkinDate,
          creditAward: existingRows[0].creditsAwarded
        }
      };
    }

    await connection.execute(
      `INSERT INTO user_checkins (user_id, checkin_date, credits_awarded, created_at)
       VALUES (?, ?, ?, ?)`,
      [user.id, checkinDate, settings.checkinCredit, now]
    );
    await connection.execute("UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?", [
      settings.checkinCredit,
      now,
      user.id
    ]);

    const transaction = creditTransaction({
      userId: user.id,
      delta: settings.checkinCredit,
      reason: "daily_checkin",
      relatedCheckinDate: checkinDate,
      createdAt: now
    });
    await insertMySqlCreditTransaction(connection, transaction);

    const currentUser = (await selectMySqlCurrentUser(user.id, connection)) ?? {
      ...user,
      credits: user.credits + settings.checkinCredit,
      updatedAt: now
    };
    await connection.commit();

    return {
      user: currentUser,
      checkin: {
        checkedInToday: true,
        checkinDate,
        creditAward: settings.checkinCredit
      },
      transaction: creditTransactionResponse(transaction)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reserveGenerationCredits(user: CurrentUser, generationId: string, count: number): Promise<number> {
  const settings = await readCreditSettings();
  const safeCount = Math.max(1, Math.trunc(count));
  if (safeCount > settings.maxImagesPerRequest) {
    throw new CreditDomainError(
      "generation_limit_exceeded",
      `单次最多生成 ${settings.maxImagesPerRequest} 张图像。`,
      400
    );
  }

  const cost = safeCount * settings.generationCreditCost;
  if (cost <= 0) {
    return 0;
  }

  const now = nowIso();
  if (databaseDriver === "sqlite") {
    return db.transaction((tx) => {
      const existingCharge = tx
        .select({ delta: creditTransactions.delta })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.relatedGenerationId, generationId),
            eq(creditTransactions.reason, "generation_charge")
          )
        )
        .get();
      if (existingCharge) {
        return Math.abs(existingCharge.delta);
      }

      const userRow = tx.select().from(users).where(eq(users.id, user.id)).get();
      if (!userRow) {
        throw new CreditDomainError("unauthorized", "请先登录。", 401);
      }
      if (userRow.credits < cost) {
        throw new CreditDomainError("insufficient_credits", "积分不足，无法开始生成。", 402);
      }

      tx.update(users)
        .set({
          credits: userRow.credits - cost,
          updatedAt: now
        })
        .where(eq(users.id, user.id))
        .run();
      tx.insert(creditTransactions)
        .values(
          creditTransaction({
            userId: user.id,
            delta: -cost,
            reason: "generation_charge",
            relatedGenerationId: generationId,
            createdAt: now
          })
        )
        .run();

      return cost;
    });
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<Array<RowDataPacket & { delta: number }>>(
      `SELECT delta
       FROM credit_transactions
       WHERE related_generation_id = ? AND reason = ?
       LIMIT 1
       FOR UPDATE`,
      [generationId, "generation_charge"]
    );
    if (existingRows[0]) {
      await connection.commit();
      return Math.abs(existingRows[0].delta);
    }

    const [userRows] = await connection.execute<Array<RowDataPacket & { credits: number }>>(
      "SELECT credits FROM users WHERE id = ? FOR UPDATE",
      [user.id]
    );
    const userRow = userRows[0];
    if (!userRow) {
      throw new CreditDomainError("unauthorized", "请先登录。", 401);
    }
    if (userRow.credits < cost) {
      throw new CreditDomainError("insufficient_credits", "积分不足，无法开始生成。", 402);
    }

    await connection.execute("UPDATE users SET credits = credits - ?, updated_at = ? WHERE id = ?", [
      cost,
      now,
      user.id
    ]);
    await insertMySqlCreditTransaction(
      connection,
      creditTransaction({
        userId: user.id,
        delta: -cost,
        reason: "generation_charge",
        relatedGenerationId: generationId,
        createdAt: now
      })
    );

    await connection.commit();
    return cost;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function refundGenerationCreditsForFailures(generationId: string, failedCount: number, fallbackCount?: number): Promise<void> {
  const safeFailedCount = Math.max(0, Math.trunc(failedCount));
  if (safeFailedCount <= 0) {
    return;
  }

  const now = nowIso();
  if (databaseDriver === "sqlite") {
    db.transaction((tx) => {
      const charge = tx
        .select()
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.relatedGenerationId, generationId),
            eq(creditTransactions.reason, "generation_charge")
          )
        )
        .get();
      if (!charge || charge.delta >= 0) {
        return;
      }

      const existingRefund = tx
        .select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.relatedGenerationId, generationId),
            eq(creditTransactions.reason, "generation_refund")
          )
        )
        .get();
      if (existingRefund) {
        return;
      }

      const generation = tx
        .select({ count: generationRecords.count })
        .from(generationRecords)
        .where(eq(generationRecords.id, generationId))
        .get();
      const refundAmount = refundAmountForCharge(Math.abs(charge.delta), safeFailedCount, generation?.count ?? fallbackCount);
      if (refundAmount <= 0) {
        return;
      }

      tx.update(users)
        .set({
          credits: sql`${users.credits} + ${refundAmount}`,
          updatedAt: now
        })
        .where(eq(users.id, charge.userId))
        .run();
      tx.insert(creditTransactions)
        .values(
          creditTransaction({
            userId: charge.userId,
            delta: refundAmount,
            reason: "generation_refund",
            relatedGenerationId: generationId,
            createdAt: now
          })
        )
        .run();
    });
    return;
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [chargeRows] = await connection.execute<CreditTransactionRow[]>(
      `${creditTransactionSelectSql()}
       WHERE related_generation_id = ? AND reason = ?
       LIMIT 1
       FOR UPDATE`,
      [generationId, "generation_charge"]
    );
    const charge = chargeRows[0];
    if (!charge || charge.delta >= 0) {
      await connection.commit();
      return;
    }

    const [refundRows] = await connection.execute<Array<RowDataPacket & { id: string }>>(
      `SELECT id
       FROM credit_transactions
       WHERE related_generation_id = ? AND reason = ?
       LIMIT 1
       FOR UPDATE`,
      [generationId, "generation_refund"]
    );
    if (refundRows[0]) {
      await connection.commit();
      return;
    }

    const [generationRows] = await connection.execute<Array<RowDataPacket & { count: number }>>(
      "SELECT count FROM generation_records WHERE id = ?",
      [generationId]
    );
    const refundAmount = refundAmountForCharge(Math.abs(charge.delta), safeFailedCount, generationRows[0]?.count ?? fallbackCount);
    if (refundAmount <= 0) {
      await connection.commit();
      return;
    }

    await connection.execute("UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?", [
      refundAmount,
      now,
      charge.userId
    ]);
    await insertMySqlCreditTransaction(
      connection,
      creditTransaction({
        userId: charge.userId,
        delta: refundAmount,
        reason: "generation_refund",
        relatedGenerationId: generationId,
        createdAt: now
      })
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function refundInterruptedGenerationCredits(): Promise<void> {
  const rows =
    databaseDriver === "sqlite"
      ? db
          .select({ id: generationRecords.id, count: generationRecords.count })
          .from(generationRecords)
          .where(sql`${generationRecords.status} IN ('pending', 'running')`)
          .all()
      : await getMySqlPool()
          .execute<Array<RowDataPacket & { id: string; count: number }>>(
            "SELECT id, count FROM generation_records WHERE status IN (?, ?)",
            ["pending", "running"]
          )
          .then(([items]) => items);

  for (const row of rows) {
    await refundGenerationCreditsForFailures(row.id, row.count, row.count);
  }
}

async function readCreditSettings(): Promise<CreditSettings> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(appSettings).where(eq(appSettings.id, APP_SETTINGS_ID)).get();
    return {
      defaultCredits: positiveOrDefault(row?.defaultCredits, DEFAULT_REGISTRATION_CREDITS),
      generationCreditCost: nonNegativeOrDefault(row?.generationCreditCost, DEFAULT_GENERATION_CREDIT_COST),
      checkinCredit: nonNegativeOrDefault(row?.checkinCredit, DEFAULT_CHECKIN_CREDIT),
      maxImagesPerRequest: positiveOrDefault(row?.maxImagesPerRequest, DEFAULT_MAX_IMAGES_PER_REQUEST)
    };
  }

  const [rows] = await getMySqlPool().execute<Array<RowDataPacket & CreditSettings>>(
    `SELECT default_credits AS defaultCredits,
            generation_credit_cost AS generationCreditCost,
            checkin_credit AS checkinCredit,
            max_images_per_request AS maxImagesPerRequest
     FROM app_settings
     WHERE id = ?`,
    [APP_SETTINGS_ID]
  );
  const row = rows[0];
  return {
    defaultCredits: positiveOrDefault(row?.defaultCredits, DEFAULT_REGISTRATION_CREDITS),
    generationCreditCost: nonNegativeOrDefault(row?.generationCreditCost, DEFAULT_GENERATION_CREDIT_COST),
    checkinCredit: nonNegativeOrDefault(row?.checkinCredit, DEFAULT_CHECKIN_CREDIT),
    maxImagesPerRequest: positiveOrDefault(row?.maxImagesPerRequest, DEFAULT_MAX_IMAGES_PER_REQUEST)
  };
}

function findCheckin(userId: string, checkinDate: string): Promise<{ creditsAwarded: number } | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db
      .select({ creditsAwarded: userCheckins.creditsAwarded })
      .from(userCheckins)
      .where(and(eq(userCheckins.userId, userId), eq(userCheckins.checkinDate, checkinDate)))
      .get();
    return Promise.resolve(row);
  }

  return getMySqlPool()
    .execute<Array<RowDataPacket & { creditsAwarded: number }>>(
      `SELECT credits_awarded AS creditsAwarded
       FROM user_checkins
       WHERE user_id = ? AND checkin_date = ?`,
      [userId, checkinDate]
    )
    .then(([rows]) => rows[0]);
}

function selectSqliteUser(tx: Pick<typeof db, "select">, userId: string): typeof users.$inferSelect | undefined {
  return tx.select().from(users).where(eq(users.id, userId)).get();
}

async function selectMySqlCurrentUser(
  userId: string,
  connection: Pick<Pool | PoolConnection, "execute"> = getMySqlPool()
): Promise<CurrentUser | undefined> {
  const [rows] = await connection.execute<UserPacket[]>(
    `SELECT id,
            name,
            email,
            role,
            status,
            credits,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM users
     WHERE id = ?`,
    [userId]
  );
  return rows[0] ? currentUserFromPacket(rows[0]) : undefined;
}

function currentUserFromSqlite(row: typeof users.$inferSelect | CurrentUser): CurrentUser {
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

function currentUserFromPacket(row: UserPacket): CurrentUser {
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

function creditTransaction(input: {
  userId: string;
  delta: number;
  reason: CreditTransactionReason;
  relatedGenerationId?: string;
  relatedOutputId?: string;
  relatedCheckinDate?: string;
  adminNote?: string;
  createdAt: string;
}): CreditTransactionInsert {
  return {
    id: `credit-${randomUUID()}`,
    userId: input.userId,
    delta: input.delta,
    reason: input.reason,
    relatedGenerationId: input.relatedGenerationId ?? null,
    relatedOutputId: input.relatedOutputId ?? null,
    relatedCheckinDate: input.relatedCheckinDate ?? null,
    adminNote: input.adminNote ?? null,
    createdAt: input.createdAt
  };
}

async function insertMySqlCreditTransaction(
  connection: PoolConnection,
  transaction: CreditTransactionInsert
): Promise<void> {
  await connection.execute(
    `INSERT INTO credit_transactions
      (id, user_id, delta, reason, related_generation_id, related_output_id, related_checkin_date, admin_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transaction.id,
      transaction.userId,
      transaction.delta,
      transaction.reason,
      transaction.relatedGenerationId,
      transaction.relatedOutputId,
      transaction.relatedCheckinDate,
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
    reason: transaction.reason as CreditTransactionReason,
    relatedGenerationId: transaction.relatedGenerationId ?? undefined,
    relatedOutputId: transaction.relatedOutputId ?? undefined,
    relatedCheckinDate: transaction.relatedCheckinDate ?? undefined,
    adminNote: transaction.adminNote ?? undefined,
    createdAt: transaction.createdAt
  };
}

function creditTransactionSelectSql(): string {
  return `SELECT id,
                 user_id AS userId,
                 delta,
                 reason,
                 related_generation_id AS relatedGenerationId,
                 related_output_id AS relatedOutputId,
                 related_checkin_date AS relatedCheckinDate,
                 admin_note AS adminNote,
                 created_at AS createdAt
          FROM credit_transactions`;
}

function refundAmountForCharge(totalCharge: number, failedCount: number, count: number | undefined): number {
  const chargedCount = Math.max(1, Math.trunc(count ?? failedCount));
  const unitCost = Math.trunc(totalCharge / chargedCount);
  return Math.min(totalCharge, unitCost * failedCount);
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nowIso(): string {
  return new Date().toISOString();
}
