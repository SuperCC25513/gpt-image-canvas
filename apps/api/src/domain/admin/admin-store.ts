import { randomUUID } from "node:crypto";
import { desc, eq, inArray, like, or } from "drizzle-orm";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  AdminCreditAdjustmentRequest,
  AdminCreditAdjustmentResponse,
  AdminGenerationAuditOutput,
  AdminGenerationAuditRecord,
  AdminGenerationAuditsResponse,
  AdminSettings,
  AdminSettingsResponse,
  AdminSettingsUpdateRequest,
  AdminUserResponse,
  AdminUsersResponse,
  CreditTransaction,
  CreditTransactionReason,
  CurrentUser,
  GeneratedAsset,
  GenerationStatus,
  ImageMode,
  OutputStatus,
  UserRole,
  UserStatus
} from "../contracts.js";
import { DEFAULT_CHECKIN_CREDIT, DEFAULT_GENERATION_CREDIT_COST, DEFAULT_MAX_IMAGES_PER_REQUEST, DEFAULT_REGISTRATION_CREDITS } from "../contracts.js";
import { getAuthSettings } from "../auth/auth-store.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { appSettings, assets, creditTransactions, generationAudits, generationOutputs, users } from "../../infrastructure/schema.js";

const APP_SETTINGS_ID = "default";
const MAX_ADMIN_AUDIT_LIMIT = 200;

interface AdminUserPacket extends RowDataPacket {
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

interface AuditPacket extends RowDataPacket {
  id: string;
  generationId: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  mode: string;
  prompt: string;
  isPublic: number;
  status: string;
  errorSummary: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  outputsJson: string;
  createdAt: string;
  updatedAt: string;
}

interface AuditOutputPacket extends RowDataPacket {
  generationId: string;
  outputId: string;
  status: string;
  assetId: string | null;
  error: string | null;
  isPublic: number;
  fileName: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
}

interface StoredAuditOutputRef {
  outputId: string;
  status?: string;
  assetId?: string;
  error?: string;
  isPublic?: boolean;
}

export class AdminDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "AdminDomainError";
  }
}

export async function listAdminUsers(input: { query?: string; limit?: number } = {}): Promise<AdminUsersResponse> {
  const limit = clampLimit(input.limit, 100);
  const query = input.query?.trim();

  if (databaseDriver === "sqlite") {
    const pattern = query ? `%${query}%` : undefined;
    const rows = db
      .select()
      .from(users)
      .where(pattern ? or(like(users.name, pattern), like(users.email, pattern), like(users.id, pattern)) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .all();

    return {
      users: rows.map(currentUserFromSqlite)
    };
  }

  const params: Array<string | number> = [];
  let where = "";
  if (query) {
    where = "WHERE name LIKE ? OR email LIKE ? OR id LIKE ?";
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const [rows] = await getMySqlPool().execute<AdminUserPacket[]>(
    `${userSelectSql()} ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params
  );

  return {
    users: rows.map(currentUserFromPacket)
  };
}

export async function updateAdminUser(
  userId: string,
  input: { role?: UserRole; status?: UserStatus },
  admin: CurrentUser
): Promise<AdminUserResponse> {
  const existing = await findAdminUser(userId);
  if (!existing) {
    throw new AdminDomainError("not_found", "找不到该用户。", 404);
  }

  const nextRole = input.role ?? existing.role;
  const nextStatus = input.status ?? existing.status;
  if (existing.id === admin.id && nextRole !== "admin") {
    throw new AdminDomainError("admin_self_demotion", "不能降级当前会话管理员账号。", 400);
  }
  if (existing.id === admin.id && nextStatus !== "active") {
    throw new AdminDomainError("admin_self_disable", "不能禁用当前会话管理员账号。", 400);
  }

  const updatedAt = nowIso();
  if (databaseDriver === "sqlite") {
    db.update(users)
      .set({
        role: nextRole,
        status: nextStatus,
        updatedAt
      })
      .where(eq(users.id, userId))
      .run();
  } else {
    await getMySqlPool().execute("UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?", [
      nextRole,
      nextStatus,
      updatedAt,
      userId
    ]);
  }

  return {
    user: (await findAdminUser(userId)) ?? { ...existing, role: nextRole, status: nextStatus, updatedAt }
  };
}

export async function adjustAdminUserCredits(
  userId: string,
  input: AdminCreditAdjustmentRequest,
  admin: CurrentUser
): Promise<AdminCreditAdjustmentResponse> {
  if (databaseDriver === "sqlite") {
    return db.transaction((tx) => {
      const row = tx.select().from(users).where(eq(users.id, userId)).get();
      if (!row) {
        throw new AdminDomainError("not_found", "找不到该用户。", 404);
      }

      const current = currentUserFromSqlite(row);
      const nextCredits = nextCreditBalance(current.credits, input);
      const delta = nextCredits - current.credits;
      const now = nowIso();
      const transaction = adminCreditTransaction(userId, delta, admin, input, now);

      tx.update(users)
        .set({
          credits: nextCredits,
          updatedAt: now
        })
        .where(eq(users.id, userId))
        .run();
      tx.insert(creditTransactions).values(transaction).run();

      const updated = tx.select().from(users).where(eq(users.id, userId)).get();
      return {
        user: currentUserFromSqlite(updated ?? { ...row, credits: nextCredits, updatedAt: now }),
        transaction: creditTransactionResponse(transaction)
      };
    });
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<AdminUserPacket[]>(`${userSelectSql()} WHERE id = ? FOR UPDATE`, [userId]);
    const row = rows[0];
    if (!row) {
      throw new AdminDomainError("not_found", "找不到该用户。", 404);
    }

    const current = currentUserFromPacket(row);
    const nextCredits = nextCreditBalance(current.credits, input);
    const delta = nextCredits - current.credits;
    const now = nowIso();
    const transaction = adminCreditTransaction(userId, delta, admin, input, now);

    await connection.execute("UPDATE users SET credits = ?, updated_at = ? WHERE id = ?", [nextCredits, now, userId]);
    await insertMySqlCreditTransaction(connection, transaction);
    await connection.commit();

    return {
      user: {
        ...current,
        credits: nextCredits,
        updatedAt: now
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

export async function readAdminSettings(): Promise<AdminSettingsResponse> {
  const settings = await getAuthSettings();
  return {
    settings: {
      allowRegistration: settings.allowRegistration,
      requireApproval: settings.requireApproval,
      defaultCredits: settings.defaultCredits,
      generationCreditCost: settings.generationCreditCost,
      checkinCredit: settings.checkinCredit,
      maxImagesPerRequest: settings.maxImagesPerRequest
    }
  };
}

export async function updateAdminSettings(input: AdminSettingsUpdateRequest): Promise<AdminSettingsResponse> {
  const current = (await readAdminSettings()).settings;
  const settings = normalizeSettings({
    ...current,
    ...input
  });
  const updatedAt = nowIso();

  if (databaseDriver === "sqlite") {
    db.update(appSettings)
      .set({
        allowRegistration: settings.allowRegistration ? 1 : 0,
        requireApproval: settings.requireApproval ? 1 : 0,
        defaultCredits: settings.defaultCredits,
        generationCreditCost: settings.generationCreditCost,
        checkinCredit: settings.checkinCredit,
        maxImagesPerRequest: settings.maxImagesPerRequest,
        updatedAt
      })
      .where(eq(appSettings.id, APP_SETTINGS_ID))
      .run();
  } else {
    await getMySqlPool().execute(
      `UPDATE app_settings
       SET allow_registration = ?,
           require_approval = ?,
           default_credits = ?,
           generation_credit_cost = ?,
           checkin_credit = ?,
           max_images_per_request = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        settings.allowRegistration ? 1 : 0,
        settings.requireApproval ? 1 : 0,
        settings.defaultCredits,
        settings.generationCreditCost,
        settings.checkinCredit,
        settings.maxImagesPerRequest,
        updatedAt,
        APP_SETTINGS_ID
      ]
    );
  }

  return {
    settings
  };
}

export async function listGenerationAudits(input: { limit?: number } = {}): Promise<AdminGenerationAuditsResponse> {
  const limit = clampLimit(input.limit, MAX_ADMIN_AUDIT_LIMIT);

  const auditRows =
    databaseDriver === "sqlite"
      ? db.select().from(generationAudits).orderBy(desc(generationAudits.createdAt)).limit(limit).all()
      : await getMySqlPool()
          .execute<AuditPacket[]>(`${auditSelectSql()} ORDER BY created_at DESC LIMIT ${limit}`)
          .then(([rows]) => rows);

  const generationIds = auditRows.map((row) => row.generationId);
  const outputRows = await findAuditOutputs(generationIds);
  const outputsByGenerationId = new Map<string, AdminGenerationAuditOutput[]>();
  for (const output of outputRows) {
    const existing = outputsByGenerationId.get(output.generationId) ?? [];
    existing.push(auditOutputFromRow(output));
    outputsByGenerationId.set(output.generationId, existing);
  }

  return {
    items: auditRows.map((row) => auditRecordFromRow(row, outputsByGenerationId.get(row.generationId) ?? fallbackAuditOutputs(row)))
  };
}

async function findAdminUser(userId: string): Promise<CurrentUser | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(users).where(eq(users.id, userId)).get();
    return row ? currentUserFromSqlite(row) : undefined;
  }

  const [rows] = await getMySqlPool().execute<AdminUserPacket[]>(`${userSelectSql()} WHERE id = ?`, [userId]);
  return rows[0] ? currentUserFromPacket(rows[0]) : undefined;
}

function nextCreditBalance(currentCredits: number, input: AdminCreditAdjustmentRequest): number {
  const nextCredits = input.mode === "set" ? input.amount : currentCredits + input.amount;
  if (!Number.isInteger(nextCredits) || nextCredits < 0) {
    throw new AdminDomainError("invalid_admin_credit_adjustment", "积分余额不能小于 0。", 400);
  }

  return nextCredits;
}

function adminCreditTransaction(
  userId: string,
  delta: number,
  admin: CurrentUser,
  input: AdminCreditAdjustmentRequest,
  createdAt: string
): CreditTransactionInsert {
  const noteParts = [
    input.mode === "set" ? `set:${input.amount}` : `delta:${input.amount}`,
    `admin:${admin.id}`,
    input.note?.trim()
  ].filter((value): value is string => Boolean(value));

  return {
    id: `credit-${randomUUID()}`,
    userId,
    delta,
    reason: "admin_adjustment",
    relatedGenerationId: null,
    relatedOutputId: null,
    relatedCheckinDate: null,
    adminNote: noteParts.join(" | ").slice(0, 500),
    createdAt
  };
}

async function insertMySqlCreditTransaction(
  connection: PoolConnection,
  transaction: CreditTransactionInsert
): Promise<void> {
  await connection.execute<ResultSetHeader>(
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

function normalizeSettings(input: AdminSettings): AdminSettings {
  const settings = {
    allowRegistration: input.allowRegistration === true,
    requireApproval: input.requireApproval === true,
    defaultCredits: nonNegativeInteger(input.defaultCredits, DEFAULT_REGISTRATION_CREDITS),
    generationCreditCost: nonNegativeInteger(input.generationCreditCost, DEFAULT_GENERATION_CREDIT_COST),
    checkinCredit: nonNegativeInteger(input.checkinCredit, DEFAULT_CHECKIN_CREDIT),
    maxImagesPerRequest: positiveInteger(input.maxImagesPerRequest, DEFAULT_MAX_IMAGES_PER_REQUEST)
  };
  if (settings.maxImagesPerRequest > DEFAULT_MAX_IMAGES_PER_REQUEST) {
    throw new AdminDomainError(
      "invalid_admin_settings",
      `单次生成数量上限不能超过 ${DEFAULT_MAX_IMAGES_PER_REQUEST}。`,
      400
    );
  }

  return settings;
}

async function findAuditOutputs(generationIds: string[]): Promise<AuditOutputPacket[]> {
  if (generationIds.length === 0) {
    return [];
  }

  if (databaseDriver === "sqlite") {
    const rows = db
      .select({
        generationId: generationOutputs.generationId,
        outputId: generationOutputs.id,
        status: generationOutputs.status,
        assetId: generationOutputs.assetId,
        error: generationOutputs.error,
        isPublic: generationOutputs.isPublic,
        fileName: assets.fileName,
        mimeType: assets.mimeType,
        width: assets.width,
        height: assets.height
      })
      .from(generationOutputs)
      .leftJoin(assets, eq(generationOutputs.assetId, assets.id))
      .where(inArray(generationOutputs.generationId, generationIds))
      .all();
    return rows as AuditOutputPacket[];
  }

  const [rows] = await getMySqlPool().execute<AuditOutputPacket[]>(
    `SELECT generation_outputs.generation_id AS generationId,
            generation_outputs.id AS outputId,
            generation_outputs.status AS status,
            generation_outputs.asset_id AS assetId,
            generation_outputs.error AS error,
            generation_outputs.is_public AS isPublic,
            assets.file_name AS fileName,
            assets.mime_type AS mimeType,
            assets.width AS width,
            assets.height AS height
     FROM generation_outputs
     LEFT JOIN assets ON generation_outputs.asset_id = assets.id
     WHERE generation_outputs.generation_id IN (${placeholders(generationIds)})`,
    generationIds
  );
  return rows;
}

function auditRecordFromRow(row: typeof generationAudits.$inferSelect | AuditPacket, outputs: AdminGenerationAuditOutput[]): AdminGenerationAuditRecord {
  return {
    id: row.id,
    generationId: row.generationId,
    user: row.userId
      ? {
          id: row.userId,
          name: row.userName ?? "",
          email: row.userEmail ?? ""
        }
      : undefined,
    mode: row.mode === "edit" ? "edit" : "generate",
    prompt: row.prompt,
    isPublic: row.isPublic === 1,
    status: generationStatus(row.status),
    errorSummary: row.errorSummary ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    outputs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function auditOutputFromRow(row: AuditOutputPacket): AdminGenerationAuditOutput {
  return {
    outputId: row.outputId,
    status: outputStatus(row.status),
    asset: assetFromAuditOutput(row),
    error: row.error ?? undefined,
    isPublic: row.isPublic === 1
  };
}

function assetFromAuditOutput(row: AuditOutputPacket): GeneratedAsset | undefined {
  if (!row.assetId || !row.fileName || !row.mimeType || !row.width || !row.height) {
    return undefined;
  }

  return {
    id: row.assetId,
    url: `/api/assets/${row.assetId}`,
    fileName: row.fileName,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height
  };
}

function fallbackAuditOutputs(row: typeof generationAudits.$inferSelect | AuditPacket): AdminGenerationAuditOutput[] {
  return parseAuditOutputRefs(row.outputsJson).map((output) => ({
    outputId: output.outputId,
    status: outputStatus(output.status),
    error: output.error,
    isPublic: output.isPublic === true
  }));
}

function parseAuditOutputRefs(value: string): StoredAuditOutputRef[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item) || typeof item.outputId !== "string") {
        return [];
      }
      return [
        {
          outputId: item.outputId,
          status: typeof item.status === "string" ? item.status : undefined,
          assetId: typeof item.assetId === "string" ? item.assetId : undefined,
          error: typeof item.error === "string" ? item.error : undefined,
          isPublic: item.isPublic === true
        }
      ];
    });
  } catch {
    return [];
  }
}

function currentUserFromSqlite(row: typeof users.$inferSelect): CurrentUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    status: userStatus(row.status),
    credits: row.credits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function currentUserFromPacket(row: AdminUserPacket): CurrentUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    status: userStatus(row.status),
    credits: row.credits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function userStatus(value: string): UserStatus {
  return value === "pending" || value === "disabled" ? value : "active";
}

function generationStatus(value: string | undefined): GenerationStatus {
  switch (value) {
    case "pending":
    case "running":
    case "succeeded":
    case "partial":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "failed";
  }
}

function outputStatus(value: string | undefined): OutputStatus {
  return value === "succeeded" ? "succeeded" : "failed";
}

function creditTransactionResponse(transaction: CreditTransactionInsert): CreditTransaction {
  return {
    id: transaction.id,
    userId: transaction.userId,
    delta: transaction.delta,
    reason: transaction.reason,
    relatedGenerationId: transaction.relatedGenerationId ?? undefined,
    relatedOutputId: transaction.relatedOutputId ?? undefined,
    relatedCheckinDate: transaction.relatedCheckinDate ?? undefined,
    adminNote: transaction.adminNote ?? undefined,
    createdAt: transaction.createdAt
  };
}

function userSelectSql(): string {
  return `SELECT id,
                 name,
                 email,
                 role,
                 status,
                 credits,
                 created_at AS createdAt,
                 updated_at AS updatedAt
          FROM users`;
}

function auditSelectSql(): string {
  return `SELECT id,
                 generation_id AS generationId,
                 user_id AS userId,
                 user_name AS userName,
                 user_email AS userEmail,
                 mode,
                 prompt,
                 is_public AS isPublic,
                 status,
                 error_summary AS errorSummary,
                 ip_address AS ipAddress,
                 user_agent AS userAgent,
                 outputs_json AS outputsJson,
                 created_at AS createdAt,
                 updated_at AS updatedAt
          FROM generation_audits`;
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, fallback);
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}
