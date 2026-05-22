import type { RowDataPacket } from "mysql2/promise";
import type { CurrentUser, GenerationOutput, GenerationRecord, GenerationStatus } from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { generationAudits } from "../../infrastructure/schema.js";
import { eq, inArray } from "drizzle-orm";

export interface GenerationAuditRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

interface AuditRow extends RowDataPacket {
  id: string;
  generationId: string;
  isPublic: number;
}

export async function recordGenerationAuditStart(input: {
  record: GenerationRecord;
  user: CurrentUser;
  isPublic: boolean;
  context?: GenerationAuditRequestContext;
}): Promise<void> {
  const now = nowIso();
  const values = {
    id: auditIdForGeneration(input.record.id),
    generationId: input.record.id,
    userId: input.user.id,
    userName: input.user.name,
    userEmail: input.user.email,
    mode: input.record.mode,
    prompt: input.record.prompt,
    isPublic: input.isPublic ? 1 : 0,
    status: input.record.status,
    errorSummary: sanitizeAuditError(input.record.error),
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
    outputsJson: JSON.stringify(outputRefs(input.record.outputs)),
    createdAt: input.record.createdAt,
    updatedAt: now
  };

  if (databaseDriver === "sqlite") {
    const existing = db
      .select({ id: generationAudits.id })
      .from(generationAudits)
      .where(eq(generationAudits.generationId, input.record.id))
      .get();

    if (existing) {
      db.update(generationAudits)
        .set({
          userId: values.userId,
          userName: values.userName,
          userEmail: values.userEmail,
          mode: values.mode,
          prompt: values.prompt,
          isPublic: values.isPublic,
          status: values.status,
          errorSummary: values.errorSummary,
          ipAddress: values.ipAddress,
          userAgent: values.userAgent,
          outputsJson: values.outputsJson,
          updatedAt: values.updatedAt
        })
        .where(eq(generationAudits.generationId, input.record.id))
        .run();
      return;
    }

    db.insert(generationAudits).values(values).run();
    return;
  }

  await getMySqlPool().execute(
    `INSERT INTO generation_audits
      (id, generation_id, user_id, user_name, user_email, mode, prompt, is_public, status, error_summary, ip_address, user_agent, outputs_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       user_name = VALUES(user_name),
       user_email = VALUES(user_email),
       mode = VALUES(mode),
       prompt = VALUES(prompt),
       is_public = VALUES(is_public),
       status = VALUES(status),
       error_summary = VALUES(error_summary),
       ip_address = VALUES(ip_address),
       user_agent = VALUES(user_agent),
       outputs_json = VALUES(outputs_json),
       updated_at = VALUES(updated_at)`,
    [
      values.id,
      values.generationId,
      values.userId,
      values.userName,
      values.userEmail,
      values.mode,
      values.prompt,
      values.isPublic,
      values.status,
      values.errorSummary,
      values.ipAddress,
      values.userAgent,
      values.outputsJson,
      values.createdAt,
      values.updatedAt
    ]
  );
}

export async function updateGenerationAuditFromRecord(record: GenerationRecord): Promise<void> {
  const existing = await findAuditRow(record.id);
  if (!existing) {
    return;
  }

  const outputIsPublic = record.outputs.some((output) => output.isPublic === true);
  const nextIsPublic = existing.isPublic === 1 || outputIsPublic;
  const updatedAt = nowIso();
  const errorSummary = sanitizeAuditError(record.error ?? firstOutputError(record.outputs));
  const outputsJson = JSON.stringify(outputRefs(record.outputs));

  if (databaseDriver === "sqlite") {
    db.update(generationAudits)
      .set({
        isPublic: nextIsPublic ? 1 : 0,
        status: record.status,
        errorSummary,
        outputsJson,
        updatedAt
      })
      .where(eq(generationAudits.generationId, record.id))
      .run();
    return;
  }

  await getMySqlPool().execute(
    `UPDATE generation_audits
     SET is_public = ?,
         status = ?,
         error_summary = ?,
         outputs_json = ?,
         updated_at = ?
     WHERE generation_id = ?`,
    [nextIsPublic ? 1 : 0, record.status, errorSummary, outputsJson, updatedAt, record.id]
  );
}

export async function markInterruptedGenerationAuditsFailed(error: string): Promise<void> {
  const updatedAt = nowIso();
  const errorSummary = sanitizeAuditError(error);
  const runningStatuses: GenerationStatus[] = ["pending", "running"];

  if (databaseDriver === "sqlite") {
    db.update(generationAudits)
      .set({
        status: "failed",
        errorSummary,
        updatedAt
      })
      .where(inArray(generationAudits.status, runningStatuses))
      .run();
    return;
  }

  await getMySqlPool().execute(
    `UPDATE generation_audits
     SET status = ?,
         error_summary = ?,
         updated_at = ?
     WHERE status IN (?, ?)`,
    ["failed", errorSummary, updatedAt, "pending", "running"]
  );
}

async function findAuditRow(generationId: string): Promise<AuditRow | undefined> {
  if (databaseDriver === "sqlite") {
    const row = db
      .select({
        id: generationAudits.id,
        generationId: generationAudits.generationId,
        isPublic: generationAudits.isPublic
      })
      .from(generationAudits)
      .where(eq(generationAudits.generationId, generationId))
      .get();
    return row as AuditRow | undefined;
  }

  const [rows] = await getMySqlPool().execute<AuditRow[]>(
    `SELECT id,
            generation_id AS generationId,
            is_public AS isPublic
     FROM generation_audits
     WHERE generation_id = ?`,
    [generationId]
  );
  return rows[0];
}

function outputRefs(outputs: GenerationOutput[]): Array<{
  outputId: string;
  status: GenerationOutput["status"];
  assetId?: string;
  error?: string;
  isPublic: boolean;
}> {
  return outputs.map((output) => ({
    outputId: output.id,
    status: output.status,
    assetId: output.asset?.id,
    error: sanitizeAuditError(output.error) ?? undefined,
    isPublic: output.isPublic === true
  }));
}

function firstOutputError(outputs: GenerationOutput[]): string | undefined {
  return outputs.find((output) => output.error?.trim())?.error;
}

function sanitizeAuditError(message: string | undefined): string | null {
  const sanitized = message
    ?.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .trim()
    .slice(0, 1200);

  return sanitized || null;
}

function auditIdForGeneration(generationId: string): string {
  return `audit-${generationId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}
