import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  AuthSettings,
  CurrentUser,
  LoginRequest,
  AuthPendingRegistrationResponse,
  RegisterRequest,
  UserRole,
  UserStatus
} from "../contracts.js";
import {
  DEFAULT_CHECKIN_CREDIT,
  DEFAULT_GENERATION_CREDIT_COST,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_REGISTRATION_CREDITS
} from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import {
  agentConversations,
  appSettings,
  assets,
  creditTransactions,
  generationOutputs,
  generationRecords,
  projects,
  promptFavoriteGroups,
  promptFavorites,
  sessions,
  users
} from "../../infrastructure/schema.js";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./password.js";

const APP_SETTINGS_ID = "default";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  name: string;
  email: string;
  passwordSalt: string;
  passwordIterations: number;
  passwordHash: string;
  role: string;
  status: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

interface AppSettingsRow {
  id: string;
  allowRegistration: number;
  requireApproval: number;
  defaultCredits: number;
  generationCreditCost: number;
  checkinCredit: number;
  maxImagesPerRequest: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionPacket extends RowDataPacket {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface UserPacket extends RowDataPacket, UserRow {}
interface AppSettingsPacket extends RowDataPacket, AppSettingsRow {}

export class AuthDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "AuthDomainError";
  }
}

export interface CreatedSession {
  user: CurrentUser;
  token: string;
  expiresAt: string;
}

export type RegisterUserResult = CreatedSession | AuthPendingRegistrationResponse;

export async function initializeAuthFoundation(): Promise<void> {
  await ensureAppSettings();
  const adminConfig = readAdminBootstrapConfig();
  if (!adminConfig) {
    console.warn("ADMIN_EMAIL、ADMIN_PASSWORD、ADMIN_NAME 未完整设置；后台能力不可用，旧 owner 为空的数据不会归属给普通用户。");
    return;
  }

  const admin = await ensureAdminUser(adminConfig);
  await backfillLegacyOwnership(admin.id);
}

export async function getAuthSettings(): Promise<AuthSettings> {
  const row = await getAppSettingsRow();
  return {
    allowRegistration: row.allowRegistration === 1,
    requireApproval: row.requireApproval === 1,
    defaultCredits: row.defaultCredits,
    generationCreditCost: row.generationCreditCost,
    checkinCredit: row.checkinCredit,
    maxImagesPerRequest: row.maxImagesPerRequest,
    adminConfigured: await hasActiveAdminUser()
  };
}

export async function registerUser(input: RegisterRequest): Promise<RegisterUserResult> {
  const settings = await getAuthSettings();
  if (!settings.allowRegistration) {
    throw new AuthDomainError("registration_disabled", "当前未开放注册。", 403);
  }

  const email = normalizeEmail(input.email);
  if (await findUserByEmail(email)) {
    throw new AuthDomainError("email_already_registered", "该邮箱已注册。", 409);
  }

  const now = nowIso();
  const password = await hashPassword(input.password);
  const row: UserRow = {
    id: `user-${randomUUID()}`,
    name: input.name,
    email,
    passwordSalt: password.salt,
    passwordIterations: password.iterations,
    passwordHash: password.hash,
    role: "user",
    status: settings.requireApproval ? "pending" : "active",
    credits: settings.defaultCredits,
    createdAt: now,
    updatedAt: now
  };

  await insertUser(row);
  if (row.status !== "active") {
    return {
      status: "pending",
      message: "账号已提交审核，请等待管理员审核。"
    };
  }

  return createSessionForUser(row);
}

export async function loginUser(input: LoginRequest): Promise<CreatedSession> {
  const email = normalizeEmail(input.email);
  const user = await findUserByEmail(email);
  if (!user) {
    throw new AuthDomainError("invalid_credentials", "邮箱或密码不正确。", 401);
  }

  const passwordOk = await verifyPassword(input.password, {
    salt: user.passwordSalt,
    iterations: user.passwordIterations,
    hash: user.passwordHash
  });
  if (!passwordOk) {
    throw new AuthDomainError("invalid_credentials", "邮箱或密码不正确。", 401);
  }

  if (user.status !== "active") {
    throw new AuthDomainError("account_inactive", "账号不可用，请联系管理员。", 403);
  }

  return createSessionForUser(user);
}

export async function currentUserFromToken(token: string | undefined): Promise<CurrentUser | undefined> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return undefined;
  }

  const tokenHash = hashSessionToken(trimmed);
  const session = await findSession(tokenHash);
  if (!session) {
    return undefined;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    await deleteSession(tokenHash);
    return undefined;
  }

  const user = await findUserById(session.userId);
  if (!user || user.status !== "active") {
    await deleteSession(tokenHash);
    return undefined;
  }

  await touchSession(tokenHash);
  return toCurrentUser(user);
}

export async function logoutToken(token: string | undefined): Promise<void> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return;
  }

  await deleteSession(hashSessionToken(trimmed));
}

async function ensureAdminUser(input: { email: string; password: string; name: string }): Promise<CurrentUser> {
  const existing = await findUserByEmail(input.email);
  const now = nowIso();
  if (existing) {
    if (existing.role !== "admin" || existing.status !== "active") {
      await updateUserRoleAndStatus(existing.id, "admin", "active", now);
      return {
        ...toCurrentUser(existing),
        role: "admin",
        status: "active",
        updatedAt: now
      };
    }

    return toCurrentUser(existing);
  }

  const password = await hashPassword(input.password);
  const row: UserRow = {
    id: `user-${randomUUID()}`,
    name: input.name,
    email: input.email,
    passwordSalt: password.salt,
    passwordIterations: password.iterations,
    passwordHash: password.hash,
    role: "admin",
    status: "active",
    credits: 0,
    createdAt: now,
    updatedAt: now
  };
  await insertUser(row);
  return toCurrentUser(row);
}

function readAdminBootstrapConfig(): { email: string; password: string; name: string } | undefined {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim();
  const values = [email, password, name].filter((value) => value && value.length > 0);
  if (values.length === 0) {
    return undefined;
  }
  if (values.length !== 3 || !email || !password || !name) {
    throw new Error("ADMIN_EMAIL、ADMIN_PASSWORD、ADMIN_NAME 必须同时设置，或同时留空。");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("ADMIN_EMAIL 格式无效。");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD 至少需要 8 个字符。");
  }

  return {
    email,
    password,
    name
  };
}

async function createSessionForUser(user: UserRow): Promise<CreatedSession> {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  if (databaseDriver === "sqlite") {
    db.insert(sessions)
      .values({
        tokenHash,
        userId: user.id,
        expiresAt,
        createdAt,
        lastSeenAt: createdAt
      })
      .run();
  } else {
    await getMySqlPool().execute(
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
      [tokenHash, user.id, expiresAt, createdAt, createdAt]
    );
  }

  return {
    user: toCurrentUser(user),
    token,
    expiresAt
  };
}

async function ensureAppSettings(): Promise<void> {
  const existing = await getAppSettingsRowOrUndefined();
  if (existing) {
    return;
  }

  const now = nowIso();
  if (databaseDriver === "sqlite") {
    db.insert(appSettings)
      .values({
        id: APP_SETTINGS_ID,
        allowRegistration: 1,
        requireApproval: 0,
        defaultCredits: DEFAULT_REGISTRATION_CREDITS,
        generationCreditCost: DEFAULT_GENERATION_CREDIT_COST,
        checkinCredit: DEFAULT_CHECKIN_CREDIT,
        maxImagesPerRequest: DEFAULT_MAX_IMAGES_PER_REQUEST,
        createdAt: now,
        updatedAt: now
      })
      .run();
  } else {
    await getMySqlPool().execute(
      `INSERT INTO app_settings
        (id, allow_registration, require_approval, default_credits, generation_credit_cost, checkin_credit, max_images_per_request, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        APP_SETTINGS_ID,
        1,
        0,
        DEFAULT_REGISTRATION_CREDITS,
        DEFAULT_GENERATION_CREDIT_COST,
        DEFAULT_CHECKIN_CREDIT,
        DEFAULT_MAX_IMAGES_PER_REQUEST,
        now,
        now
      ]
    );
  }
}

async function getAppSettingsRow(): Promise<AppSettingsRow> {
  await ensureAppSettings();
  const row = await getAppSettingsRowOrUndefined();
  if (row) {
    return row;
  }

  const now = nowIso();
  return {
    id: APP_SETTINGS_ID,
    allowRegistration: 1,
    requireApproval: 0,
    defaultCredits: DEFAULT_REGISTRATION_CREDITS,
    generationCreditCost: DEFAULT_GENERATION_CREDIT_COST,
    checkinCredit: DEFAULT_CHECKIN_CREDIT,
    maxImagesPerRequest: DEFAULT_MAX_IMAGES_PER_REQUEST,
    createdAt: now,
    updatedAt: now
  };
}

async function getAppSettingsRowOrUndefined(): Promise<AppSettingsRow | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(appSettings).where(eq(appSettings.id, APP_SETTINGS_ID)).get();
    return row
      ? {
          id: row.id,
          allowRegistration: row.allowRegistration,
          requireApproval: row.requireApproval,
          defaultCredits: row.defaultCredits,
          generationCreditCost: row.generationCreditCost,
          checkinCredit: row.checkinCredit,
          maxImagesPerRequest: row.maxImagesPerRequest,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }
      : undefined;
  }

  const [rows] = await getMySqlPool().execute<AppSettingsPacket[]>(
    `SELECT id,
            allow_registration AS allowRegistration,
            require_approval AS requireApproval,
            default_credits AS defaultCredits,
            generation_credit_cost AS generationCreditCost,
            checkin_credit AS checkinCredit,
            max_images_per_request AS maxImagesPerRequest,
            created_at AS createdAt,
            updated_at AS updatedAt
     FROM app_settings
     WHERE id = ?`,
    [APP_SETTINGS_ID]
  );
  return rows[0];
}

async function insertUser(user: UserRow): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.transaction((tx) => {
      tx.insert(users)
        .values({
          id: user.id,
          name: user.name,
          email: user.email,
          passwordSalt: user.passwordSalt,
          passwordIterations: user.passwordIterations,
          passwordHash: user.passwordHash,
          role: user.role,
          status: user.status,
          credits: user.credits,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        })
        .run();

      if (user.credits > 0) {
        tx.insert(creditTransactions)
          .values(registrationCreditTransaction(user.id, user.credits, user.createdAt))
          .run();
      }
    });
    return;
  }

  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO users
        (id, name, email, password_salt, password_iterations, password_hash, role, status, credits, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.name,
        user.email,
        user.passwordSalt,
        user.passwordIterations,
        user.passwordHash,
        user.role,
        user.status,
        user.credits,
        user.createdAt,
        user.updatedAt
      ]
    );

    if (user.credits > 0) {
      const transaction = registrationCreditTransaction(user.id, user.credits, user.createdAt);
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

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function registrationCreditTransaction(userId: string, credits: number, createdAt: string) {
  return {
    id: `credit-${randomUUID()}`,
    userId,
    delta: credits,
    reason: "registration_bonus" as const,
    relatedGenerationId: null,
    relatedOutputId: null,
    relatedCheckinDate: null,
    adminNote: null,
    createdAt
  };
}

async function updateUserRoleAndStatus(userId: string, role: UserRole, status: UserStatus, updatedAt: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.update(users).set({ role, status, updatedAt }).where(eq(users.id, userId)).run();
    return;
  }

  await getMySqlPool().execute("UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?", [
    role,
    status,
    updatedAt,
    userId
  ]);
}

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
    return row ? userRowFromSqlite(row) : undefined;
  }

  const [rows] = await getMySqlPool().execute<UserPacket[]>(`${userSelectSql()} WHERE email = ?`, [
    normalizeEmail(email)
  ]);
  return rows[0];
}

async function findUserById(userId: string): Promise<UserRow | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(users).where(eq(users.id, userId)).get();
    return row ? userRowFromSqlite(row) : undefined;
  }

  const [rows] = await getMySqlPool().execute<UserPacket[]>(`${userSelectSql()} WHERE id = ?`, [userId]);
  return rows[0];
}

async function hasActiveAdminUser(): Promise<boolean> {
  if (databaseDriver === "sqlite") {
    return Boolean(
      db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.status, "active")))
        .get()
    );
  }

  const [rows] = await getMySqlPool().execute<Array<RowDataPacket & { id: string }>>(
    "SELECT id FROM users WHERE role = ? AND status = ? LIMIT 1",
    ["admin", "active"]
  );
  return Boolean(rows[0]?.id);
}

async function findSession(tokenHash: string): Promise<SessionPacket | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
    return row
      ? ({
          tokenHash: row.tokenHash,
          userId: row.userId,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          lastSeenAt: row.lastSeenAt
        } as SessionPacket)
      : undefined;
  }

  const [rows] = await getMySqlPool().execute<SessionPacket[]>(
    `SELECT token_hash AS tokenHash,
            user_id AS userId,
            expires_at AS expiresAt,
            created_at AS createdAt,
            last_seen_at AS lastSeenAt
     FROM sessions
     WHERE token_hash = ?`,
    [tokenHash]
  );
  return rows[0];
}

async function touchSession(tokenHash: string): Promise<void> {
  const lastSeenAt = nowIso();
  if (databaseDriver === "sqlite") {
    db.update(sessions).set({ lastSeenAt }).where(eq(sessions.tokenHash, tokenHash)).run();
    return;
  }

  await getMySqlPool().execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", [lastSeenAt, tokenHash]);
}

async function deleteSession(tokenHash: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return;
  }

  await getMySqlPool().execute<ResultSetHeader>("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
}

async function backfillLegacyOwnership(adminUserId: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.update(projects).set({ userId: adminUserId }).where(or(isNull(projects.userId), eq(projects.userId, ""))).run();
    db.update(assets).set({ userId: adminUserId }).where(or(isNull(assets.userId), eq(assets.userId, ""))).run();
    db.update(generationRecords)
      .set({ userId: adminUserId })
      .where(or(isNull(generationRecords.userId), eq(generationRecords.userId, "")))
      .run();
    db.update(generationOutputs)
      .set({ userId: adminUserId })
      .where(or(isNull(generationOutputs.userId), eq(generationOutputs.userId, "")))
      .run();
    db.update(agentConversations)
      .set({ userId: adminUserId })
      .where(or(isNull(agentConversations.userId), eq(agentConversations.userId, "")))
      .run();
    db.update(promptFavoriteGroups)
      .set({ userId: adminUserId })
      .where(or(isNull(promptFavoriteGroups.userId), eq(promptFavoriteGroups.userId, "")))
      .run();
    db.update(promptFavorites)
      .set({ userId: adminUserId })
      .where(or(isNull(promptFavorites.userId), eq(promptFavorites.userId, "")))
      .run();
    return;
  }

  for (const tableName of [
    "projects",
    "assets",
    "generation_records",
    "generation_outputs",
    "agent_conversations",
    "prompt_favorite_groups",
    "prompt_favorites"
  ]) {
    await getMySqlPool().execute(`UPDATE ${tableName} SET user_id = ? WHERE user_id IS NULL OR user_id = ''`, [
      adminUserId
    ]);
  }
}

function userSelectSql(): string {
  return `SELECT id,
                 name,
                 email,
                 password_salt AS passwordSalt,
                 password_iterations AS passwordIterations,
                 password_hash AS passwordHash,
                 role,
                 status,
                 credits,
                 created_at AS createdAt,
                 updated_at AS updatedAt
          FROM users`;
}

function userRowFromSqlite(row: typeof users.$inferSelect): UserRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordSalt: row.passwordSalt,
    passwordIterations: row.passwordIterations,
    passwordHash: row.passwordHash,
    role: row.role,
    status: row.status,
    credits: row.credits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toCurrentUser(user: UserRow): CurrentUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    status: user.status === "pending" || user.status === "disabled" ? user.status : "active",
    credits: user.credits,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}
