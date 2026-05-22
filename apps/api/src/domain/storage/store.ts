import { and, desc, eq, inArray, SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  GeneratedAsset,
  GalleryImageItem,
  GalleryResponse,
  GenerationRecord as ApiGenerationRecord,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  OutputFormat,
  OutputStatus,
  ProjectState
} from "../contracts.js";
import type { CurrentUser } from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { assets, generationOutputs, generationRecords, generationReferenceAssets, projects } from "../../infrastructure/schema.js";

const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default Project";
const fallbackWarnings = new Set<string>();

export interface ProjectSnapshotInput {
  name?: string;
  snapshotJson: string;
}

export interface GalleryExportAsset {
  outputId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
}

export interface AssetRow {
  id: string;
  userId: string | null;
  fileName: string;
  relativePath: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface GenerationRecordRow {
  id: string;
  userId: string | null;
  mode: string;
  prompt: string;
  effectivePrompt: string;
  presetId: string;
  width: number;
  height: number;
  quality: string;
  outputFormat: string;
  count: number;
  status: string;
  error: string | null;
  referenceAssetId: string | null;
  createdAt: string;
}

export interface GenerationOutputRow {
  id: string;
  userId: string | null;
  generationId: string;
  status: string;
  assetId: string | null;
  error: string | null;
  createdAt: string;
}

export interface GenerationReferenceAssetRow {
  generationId: string;
  assetId: string;
  position: number;
  createdAt: string;
}

export interface StoredGenerationOutputInput {
  id: string;
  status: OutputStatus;
  asset?: GeneratedAsset;
  error?: string;
}

function canAccessOwner(user: CurrentUser, ownerId: string | null | undefined): boolean {
  return user.role === "admin" || ownerId === user.id;
}

function sqliteOwnerWhere(column: SQLiteColumn, user: CurrentUser): SQL | undefined {
  return user.role === "admin" ? undefined : eq(column, user.id);
}

function defaultProjectId(userId: string): string {
  return `${DEFAULT_PROJECT_ID}:${userId}`;
}

interface ProjectRow {
  id: string;
  userId: string | null;
  name: string;
  snapshotJson: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectPacket extends RowDataPacket, ProjectRow {}
interface AssetPacket extends RowDataPacket, AssetRow {}
interface GenerationRecordPacket extends RowDataPacket, GenerationRecordRow {}
interface GenerationOutputPacket extends RowDataPacket, GenerationOutputRow {}
interface GenerationReferenceAssetPacket extends RowDataPacket, GenerationReferenceAssetRow {}

interface GalleryPacket extends RowDataPacket {
  outputId: string;
  generationId: string;
  mode: string;
  prompt: string;
  effectivePrompt: string;
  presetId: string;
  width: number;
  height: number;
  quality: string;
  outputFormat: string;
  createdAt: string;
  assetId: string;
  fileName: string;
  relativePath: string;
  mimeType: string;
  assetWidth: number;
  assetHeight: number;
  assetCreatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSnapshot(snapshotJson: string): unknown | null {
  return JSON.parse(snapshotJson) as unknown;
}

export async function ensureDefaultProject(user: CurrentUser): Promise<void> {
  const existing = await getDefaultProjectRow(user);

  if (existing) {
    return;
  }
  const projectId = defaultProjectId(user.id);
  if (await defaultProjectRowExists(projectId)) {
    return;
  }

  const createdAt = nowIso();
  if (databaseDriver === "sqlite") {
    db.insert(projects)
      .values({
        id: projectId,
        userId: user.id,
        name: DEFAULT_PROJECT_NAME,
        snapshotJson: "null",
        createdAt,
        updatedAt: createdAt
      })
      .run();
    return;
  }

  await getMySqlPool().execute(
    `INSERT INTO projects (id, user_id, name, snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, user.id, DEFAULT_PROJECT_NAME, "null", createdAt, createdAt]
  );
}

export async function saveProjectSnapshot(input: ProjectSnapshotInput, user: CurrentUser): Promise<ProjectState> {
  await ensureDefaultProject(user);

  const updatedAt = nowIso();
  const current = await getDefaultProjectRow(user);
  const name = input.name ?? current?.name ?? DEFAULT_PROJECT_NAME;

  if (databaseDriver === "sqlite") {
    db.update(projects)
      .set({
        name,
        snapshotJson: input.snapshotJson,
        updatedAt
      })
      .where(eq(projects.id, current?.id ?? defaultProjectId(user.id)))
      .run();
  } else {
    await getMySqlPool().execute(
      `UPDATE projects
       SET name = ?, snapshot_json = ?, updated_at = ?
       WHERE id = ?`,
      [name, input.snapshotJson, updatedAt, current?.id ?? defaultProjectId(user.id)]
    );
  }

  return getProjectState(user);
}

export async function getProjectState(user: CurrentUser): Promise<ProjectState> {
  await ensureDefaultProject(user);

  const project = await getDefaultProjectRow(user);

  if (!project) {
    return {
      id: defaultProjectId(user.id),
      name: DEFAULT_PROJECT_NAME,
      snapshot: null,
      history: await getGenerationHistory(user),
      updatedAt: nowIso()
    };
  }

  return {
    id: project.id,
    name: project.name,
    snapshot: parseSnapshot(project.snapshotJson),
    history: await getGenerationHistory(user),
    updatedAt: project.updatedAt
  };
}

export async function getGalleryImages(user: CurrentUser): Promise<GalleryResponse> {
  if (databaseDriver === "sqlite") {
    const rows = db
      .select({
        output: generationOutputs,
        generation: generationRecords,
        asset: assets
      })
      .from(generationOutputs)
      .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
      .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
      .where(and(eq(generationOutputs.status, "succeeded"), sqliteOwnerWhere(generationOutputs.userId, user)))
      .orderBy(desc(generationOutputs.createdAt))
      .all();

    return {
      items: rows
        .map(({ output, generation, asset }) => galleryItemFromRows(output.id, output.createdAt, generation, asset))
        .filter((item): item is GalleryImageItem => Boolean(item))
    };
  }

  const [rows] = await getMySqlPool().execute<GalleryPacket[]>(
    `SELECT
       generation_outputs.id AS outputId,
       generation_records.id AS generationId,
       generation_records.mode AS mode,
       generation_records.prompt AS prompt,
       generation_records.effective_prompt AS effectivePrompt,
       generation_records.preset_id AS presetId,
       generation_records.width AS width,
       generation_records.height AS height,
       generation_records.quality AS quality,
       generation_records.output_format AS outputFormat,
       generation_outputs.created_at AS createdAt,
       assets.id AS assetId,
       assets.file_name AS fileName,
       assets.relative_path AS relativePath,
       assets.mime_type AS mimeType,
       assets.width AS assetWidth,
       assets.height AS assetHeight,
       assets.created_at AS assetCreatedAt
     FROM generation_outputs
     INNER JOIN generation_records ON generation_outputs.generation_id = generation_records.id
     INNER JOIN assets ON generation_outputs.asset_id = assets.id
     WHERE generation_outputs.status = ?
       ${user.role === "admin" ? "" : "AND generation_outputs.user_id = ?"}
     ORDER BY generation_outputs.created_at DESC`,
    user.role === "admin" ? ["succeeded"] : ["succeeded", user.id]
  );

  return {
    items: rows
      .map((row) =>
        galleryItemFromRows(
          row.outputId,
          row.createdAt,
          {
            id: row.generationId,
            userId: null,
            mode: row.mode,
            prompt: row.prompt,
            effectivePrompt: row.effectivePrompt,
            presetId: row.presetId,
            width: row.width,
            height: row.height,
            quality: row.quality,
            outputFormat: row.outputFormat,
            count: 1,
            status: "succeeded",
            error: null,
            referenceAssetId: null,
            createdAt: row.createdAt
          },
          {
            id: row.assetId,
            userId: null,
            fileName: row.fileName,
            relativePath: row.relativePath,
            mimeType: row.mimeType,
            width: row.assetWidth,
            height: row.assetHeight,
            createdAt: row.assetCreatedAt
          }
        )
      )
      .filter((item): item is GalleryImageItem => Boolean(item))
  };
}

export async function deleteGalleryOutput(outputId: string, user: CurrentUser): Promise<boolean> {
  if (databaseDriver === "sqlite") {
    const result = db
      .delete(generationOutputs)
      .where(and(eq(generationOutputs.id, outputId), sqliteOwnerWhere(generationOutputs.userId, user)))
      .run();
    return result.changes > 0;
  }

  const [result] = await getMySqlPool().execute<ResultSetHeader>(
    `DELETE FROM generation_outputs
     WHERE id = ?
       ${user.role === "admin" ? "" : "AND user_id = ?"}`,
    user.role === "admin" ? [outputId] : [outputId, user.id]
  );
  return result.affectedRows > 0;
}

export async function getGalleryExportAssets(outputIds: string[], user: CurrentUser): Promise<GalleryExportAsset[]> {
  if (outputIds.length === 0) {
    return [];
  }

  if (databaseDriver === "sqlite") {
    const rows = db
      .select({
        outputId: generationOutputs.id,
        assetId: assets.id,
        fileName: assets.fileName,
        mimeType: assets.mimeType
      })
      .from(generationOutputs)
      .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
      .where(
        and(
          inArray(generationOutputs.id, outputIds),
          eq(generationOutputs.status, "succeeded"),
          sqliteOwnerWhere(generationOutputs.userId, user)
        )
      )
      .all();

    return orderRowsByOutputIds(outputIds, rows);
  }

  const [rows] = await getMySqlPool().execute<Array<RowDataPacket & GalleryExportAsset>>(
    `SELECT generation_outputs.id AS outputId,
            assets.id AS assetId,
            assets.file_name AS fileName,
            assets.mime_type AS mimeType
     FROM generation_outputs
     INNER JOIN assets ON generation_outputs.asset_id = assets.id
     WHERE generation_outputs.id IN (${placeholders(outputIds)})
       AND generation_outputs.status = ?
       ${user.role === "admin" ? "" : "AND generation_outputs.user_id = ?"}`,
    user.role === "admin" ? [...outputIds, "succeeded"] : [...outputIds, "succeeded", user.id]
  );

  return orderRowsByOutputIds(outputIds, rows);
}

export async function findAssetById(assetId: string): Promise<AssetRow | undefined> {
  if (databaseDriver === "sqlite") {
    return db.select().from(assets).where(eq(assets.id, assetId)).get();
  }

  const [rows] = await getMySqlPool().execute<AssetPacket[]>(
    `SELECT id,
            user_id AS userId,
            file_name AS fileName,
            relative_path AS relativePath,
            mime_type AS mimeType,
            width,
            height,
            created_at AS createdAt
     FROM assets
     WHERE id = ?`,
    [assetId]
  );

  return rows[0];
}

export async function userCanReadAsset(assetId: string, user: CurrentUser): Promise<boolean> {
  const asset = await findAssetById(assetId);
  return Boolean(asset && canAccessOwner(user, asset.userId));
}

export async function assetExists(assetId: string, user?: CurrentUser): Promise<boolean> {
  if (user) {
    return userCanReadAsset(assetId, user);
  }

  if (databaseDriver === "sqlite") {
    return Boolean(db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).get());
  }

  const [rows] = await getMySqlPool().execute<Array<RowDataPacket & { id: string }>>(
    "SELECT id FROM assets WHERE id = ?",
    [assetId]
  );
  return Boolean(rows[0]?.id);
}

export async function insertAsset(asset: AssetRow): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.insert(assets).values(asset).run();
    return;
  }

  await getMySqlPool().execute(
    `INSERT INTO assets (id, user_id, file_name, relative_path, mime_type, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [asset.id, asset.userId, asset.fileName, asset.relativePath, asset.mimeType, asset.width, asset.height, asset.createdAt]
  );
}

export async function insertGenerationRecord(record: GenerationRecordRow, referenceAssetIds: string[]): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.insert(generationRecords).values(record).run();
    insertSqliteGenerationReferenceAssets(record.id, referenceAssetIds, record.createdAt);
    return;
  }

  await getMySqlPool().execute(
    `INSERT INTO generation_records
      (id, user_id, mode, prompt, effective_prompt, preset_id, width, height, quality, output_format, count, status, error, reference_asset_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.userId,
      record.mode,
      record.prompt,
      record.effectivePrompt,
      record.presetId,
      record.width,
      record.height,
      record.quality,
      record.outputFormat,
      record.count,
      record.status,
      record.error,
      record.referenceAssetId,
      record.createdAt
    ]
  );
  await insertMySqlGenerationReferenceAssets(record.id, referenceAssetIds, record.createdAt);
}

export async function updateGenerationRecordCompletion(
  generationId: string,
  status: GenerationStatus,
  error: string | null,
  referenceAssetId: string | null
): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.update(generationRecords)
      .set({
        status,
        error,
        referenceAssetId
      })
      .where(eq(generationRecords.id, generationId))
      .run();
    return;
  }

  await getMySqlPool().execute(
    `UPDATE generation_records
     SET status = ?, error = ?, reference_asset_id = ?
     WHERE id = ?`,
    [status, error, referenceAssetId, generationId]
  );
}

export async function updateGenerationRecordStatus(
  generationId: string,
  status: Extract<GenerationStatus, "cancelled" | "failed">,
  error: string
): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.update(generationRecords)
      .set({
        status,
        error
      })
      .where(eq(generationRecords.id, generationId))
      .run();
    return;
  }

  await getMySqlPool().execute("UPDATE generation_records SET status = ?, error = ? WHERE id = ?", [
    status,
    error,
    generationId
  ]);
}

export async function replaceGenerationOutputs(generationId: string, outputs: StoredGenerationOutputInput[]): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.delete(generationOutputs).where(eq(generationOutputs.generationId, generationId)).run();
  } else {
    await getMySqlPool().execute("DELETE FROM generation_outputs WHERE generation_id = ?", [generationId]);
  }

  await insertGenerationOutputs(generationId, outputs);
}

export async function insertGenerationOutputs(generationId: string, outputs: StoredGenerationOutputInput[]): Promise<void> {
  const createdAt = nowIso();
  const generation = await findGenerationRecordRow(generationId);
  const userId = generation?.userId ?? null;

  for (const output of outputs) {
    if (output.asset) {
      await insertAsset({
        id: output.asset.id,
        userId,
        fileName: output.asset.fileName,
        relativePath: `assets/${output.asset.fileName}`,
        mimeType: output.asset.mimeType,
        width: output.asset.width,
        height: output.asset.height,
        createdAt
      });
    }

    if (databaseDriver === "sqlite") {
      db.insert(generationOutputs)
        .values({
          id: output.id,
          userId,
          generationId,
          status: output.status,
          assetId: output.asset?.id ?? null,
          error: output.error ?? null,
          createdAt
        })
        .run();
    } else {
      await getMySqlPool().execute(
        `INSERT INTO generation_outputs (id, user_id, generation_id, status, asset_id, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [output.id, userId, generationId, output.status, output.asset?.id ?? null, output.error ?? null, createdAt]
      );
    }
  }
}

export async function markInterruptedGenerationRecordsFailed(error: string): Promise<void> {
  if (databaseDriver === "sqlite") {
    db.update(generationRecords)
      .set({
        status: "failed",
        error
      })
      .where(inArray(generationRecords.status, ["pending", "running"]))
      .run();
    return;
  }

  await getMySqlPool().execute(
    `UPDATE generation_records
     SET status = ?, error = ?
     WHERE status IN (?, ?)`,
    ["failed", error, "pending", "running"]
  );
}

export async function readGenerationRecord(generationId: string, user?: CurrentUser): Promise<ApiGenerationRecord | undefined> {
  const record = await findGenerationRecordRow(generationId);
  if (!record || (user && !canAccessOwner(user, record.userId))) {
    return undefined;
  }

  const outputRows = await findGenerationOutputRows(generationId);
  const referenceRows = await findGenerationReferenceAssetRows(generationId);
  const assetIds = outputRows.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows = await findAssetsByIds(assetIds);
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  const referenceAssetIds = referenceRows.map((referenceRow) => referenceRow.assetId);

  return generationRecordFromRows(record, outputRows, assetById, referenceAssetIds);
}

async function getDefaultProjectRow(user: CurrentUser): Promise<ProjectRow | undefined> {
  try {
    if (databaseDriver === "sqlite") {
      const row = db.select().from(projects).where(eq(projects.userId, user.id)).get();
      return row
        ? {
            id: row.id,
            userId: row.userId,
            name: row.name,
            snapshotJson: row.snapshotJson,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
          }
        : undefined;
    }

    const [rows] = await getMySqlPool().execute<ProjectPacket[]>(
      `SELECT id,
              name,
              user_id AS userId,
              snapshot_json AS snapshotJson,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM projects
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [user.id]
    );
    return rows[0];
  } catch (error) {
    warnOnce(
      "project-read-fallback",
      `Project row could not be read; returning a blank canvas fallback. ${formatErrorSummary(error)}`
    );
    return undefined;
  }
}

async function defaultProjectRowExists(projectId: string): Promise<boolean> {
  try {
    if (databaseDriver === "sqlite") {
      const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
      return Boolean(row);
    }

    const [rows] = await getMySqlPool().execute<Array<RowDataPacket & { id: string }>>(
      "SELECT id FROM projects WHERE id = ?",
      [projectId]
    );
    return Boolean(rows[0]?.id);
  } catch {
    return true;
  }
}

async function getGenerationHistory(user: CurrentUser): Promise<ApiGenerationRecord[]> {
  try {
    return await readGenerationHistory(user);
  } catch (error) {
    warnOnce(
      "history-read-fallback",
      `Generation history could not be read; returning an empty history. ${formatErrorSummary(error)}`
    );
    return [];
  }
}

async function readGenerationHistory(user: CurrentUser): Promise<ApiGenerationRecord[]> {
  const records =
    databaseDriver === "sqlite"
      ? db
          .select()
          .from(generationRecords)
          .where(sqliteOwnerWhere(generationRecords.userId, user))
          .orderBy(desc(generationRecords.createdAt))
          .limit(20)
          .all()
      : await findRecentMySqlGenerationRows(user);
  if (records.length === 0) {
    return [];
  }

  const generationIds = records.map((record) => record.id);
  const outputs = await findGenerationOutputsByGenerationIds(generationIds);
  const referenceRows = (await findReferenceAssetsByGenerationIds(generationIds)).sort((left, right) =>
    left.generationId === right.generationId
      ? left.position - right.position
      : left.generationId.localeCompare(right.generationId)
  );

  const assetIds = outputs.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows = await findAssetsByIds(assetIds);
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

  const outputsByGenerationId = new Map<string, GenerationOutputRow[]>();
  for (const output of outputs) {
    const existing = outputsByGenerationId.get(output.generationId) ?? [];
    existing.push(output);
    outputsByGenerationId.set(output.generationId, existing);
  }
  const referenceAssetIdsByGenerationId = new Map<string, string[]>();
  for (const referenceRow of referenceRows) {
    const existing = referenceAssetIdsByGenerationId.get(referenceRow.generationId) ?? [];
    existing.push(referenceRow.assetId);
    referenceAssetIdsByGenerationId.set(referenceRow.generationId, existing);
  }

  return records.map((record) =>
    generationRecordFromRows(
      record,
      outputsByGenerationId.get(record.id) ?? [],
      assetById,
      referenceAssetIdsByGenerationId.get(record.id) ?? []
    )
  );
}

async function findGenerationRecordRow(generationId: string): Promise<GenerationRecordRow | undefined> {
  if (databaseDriver === "sqlite") {
    return db.select().from(generationRecords).where(eq(generationRecords.id, generationId)).get();
  }

  const [rows] = await getMySqlPool().execute<GenerationRecordPacket[]>(
    generationRecordSelectSql("WHERE id = ?"),
    [generationId]
  );
  return rows[0];
}

async function findGenerationOutputRows(generationId: string): Promise<GenerationOutputRow[]> {
  if (databaseDriver === "sqlite") {
    return db
      .select()
      .from(generationOutputs)
      .where(eq(generationOutputs.generationId, generationId))
      .orderBy(generationOutputs.createdAt)
      .all();
  }

  const [rows] = await getMySqlPool().execute<GenerationOutputPacket[]>(
    `${generationOutputSelectSql()} WHERE generation_id = ? ORDER BY created_at`,
    [generationId]
  );
  return rows;
}

async function findGenerationReferenceAssetRows(generationId: string): Promise<GenerationReferenceAssetRow[]> {
  if (databaseDriver === "sqlite") {
    return db
      .select()
      .from(generationReferenceAssets)
      .where(eq(generationReferenceAssets.generationId, generationId))
      .all()
      .sort((left, right) => left.position - right.position);
  }

  const [rows] = await getMySqlPool().execute<GenerationReferenceAssetPacket[]>(
    `${generationReferenceAssetSelectSql()} WHERE generation_id = ? ORDER BY position`,
    [generationId]
  );
  return rows;
}

async function findRecentMySqlGenerationRows(user: CurrentUser): Promise<GenerationRecordRow[]> {
  const [rows] = await getMySqlPool().execute<GenerationRecordPacket[]>(
    `${generationRecordSelectSql(user.role === "admin" ? "" : "WHERE user_id = ?")} ORDER BY created_at DESC LIMIT 20`,
    user.role === "admin" ? [] : [user.id]
  );
  return rows;
}

async function findGenerationOutputsByGenerationIds(generationIds: string[]): Promise<GenerationOutputRow[]> {
  if (generationIds.length === 0) {
    return [];
  }

  if (databaseDriver === "sqlite") {
    return db
      .select()
      .from(generationOutputs)
      .where(inArray(generationOutputs.generationId, generationIds))
      .orderBy(generationOutputs.createdAt)
      .all();
  }

  const [rows] = await getMySqlPool().execute<GenerationOutputPacket[]>(
    `${generationOutputSelectSql()} WHERE generation_id IN (${placeholders(generationIds)}) ORDER BY created_at`,
    generationIds
  );
  return rows;
}

async function findReferenceAssetsByGenerationIds(generationIds: string[]): Promise<GenerationReferenceAssetRow[]> {
  if (generationIds.length === 0) {
    return [];
  }

  if (databaseDriver === "sqlite") {
    return db
      .select()
      .from(generationReferenceAssets)
      .where(inArray(generationReferenceAssets.generationId, generationIds))
      .all();
  }

  const [rows] = await getMySqlPool().execute<GenerationReferenceAssetPacket[]>(
    `${generationReferenceAssetSelectSql()} WHERE generation_id IN (${placeholders(generationIds)})`,
    generationIds
  );
  return rows;
}

async function findAssetsByIds(assetIds: string[]): Promise<AssetRow[]> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return [];
  }

  if (databaseDriver === "sqlite") {
    return db.select().from(assets).where(inArray(assets.id, uniqueAssetIds)).all();
  }

  const [rows] = await getMySqlPool().execute<AssetPacket[]>(
    `${assetSelectSql()} WHERE id IN (${placeholders(uniqueAssetIds)})`,
    uniqueAssetIds
  );
  return rows;
}

function insertSqliteGenerationReferenceAssets(generationId: string, referenceAssetIds: string[], createdAt: string): void {
  referenceAssetIds.forEach((assetId, position) => {
    db.insert(generationReferenceAssets)
      .values({
        generationId,
        assetId,
        position,
        createdAt
      })
      .run();
  });
}

async function insertMySqlGenerationReferenceAssets(
  generationId: string,
  referenceAssetIds: string[],
  createdAt: string
): Promise<void> {
  for (const [position, assetId] of referenceAssetIds.entries()) {
    await getMySqlPool().execute(
      `INSERT INTO generation_reference_assets (generation_id, asset_id, position, created_at)
       VALUES (?, ?, ?, ?)`,
      [generationId, assetId, position, createdAt]
    );
  }
}

function generationRecordSelectSql(whereClause: string): string {
  return `SELECT id,
                 user_id AS userId,
                 mode,
                 prompt,
                 effective_prompt AS effectivePrompt,
                 preset_id AS presetId,
                 width,
                 height,
                 quality,
                 output_format AS outputFormat,
                 count,
                 status,
                 error,
                 reference_asset_id AS referenceAssetId,
                 created_at AS createdAt
          FROM generation_records ${whereClause}`;
}

function generationOutputSelectSql(): string {
  return `SELECT id,
                 user_id AS userId,
                 generation_id AS generationId,
                 status,
                 asset_id AS assetId,
                 error,
                 created_at AS createdAt
          FROM generation_outputs`;
}

function generationReferenceAssetSelectSql(): string {
  return `SELECT generation_id AS generationId,
                 asset_id AS assetId,
                 position,
                 created_at AS createdAt
          FROM generation_reference_assets`;
}

function assetSelectSql(): string {
  return `SELECT id,
                 user_id AS userId,
                 file_name AS fileName,
                 relative_path AS relativePath,
                 mime_type AS mimeType,
                 width,
                 height,
                 created_at AS createdAt
          FROM assets`;
}

function generationRecordFromRows(
  record: GenerationRecordRow,
  outputRows: GenerationOutputRow[],
  assetById: Map<string, AssetRow>,
  referenceAssetIds: string[]
): ApiGenerationRecord {
  return {
    id: record.id,
    mode: record.mode as ImageMode,
    prompt: record.prompt,
    effectivePrompt: record.effectivePrompt,
    presetId: record.presetId,
    size: {
      width: record.width,
      height: record.height
    },
    quality: record.quality as ImageQuality,
    outputFormat: record.outputFormat as OutputFormat,
    count: record.count,
    status: record.status as GenerationStatus,
    error: record.error ?? undefined,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : record.referenceAssetId ? [record.referenceAssetId] : undefined,
    referenceAssetId: record.referenceAssetId ?? undefined,
    createdAt: record.createdAt,
    outputs: outputRows.map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }))
  };
}

function galleryItemFromRows(
  outputId: string,
  createdAt: string,
  generation: GenerationRecordRow,
  asset: AssetRow | undefined
): GalleryImageItem | undefined {
  const generatedAsset = toGeneratedAsset(asset);
  if (!generatedAsset) {
    return undefined;
  }

  return {
    outputId,
    generationId: generation.id,
    mode: generation.mode as ImageMode,
    prompt: generation.prompt,
    effectivePrompt: generation.effectivePrompt,
    presetId: generation.presetId,
    size: {
      width: generation.width,
      height: generation.height
    },
    quality: generation.quality as ImageQuality,
    outputFormat: generation.outputFormat as OutputFormat,
    createdAt,
    asset: generatedAsset
  };
}

function toGeneratedAsset(asset: AssetRow | undefined): GeneratedAsset | undefined {
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height
  };
}

function orderRowsByOutputIds<T extends { outputId: string }>(outputIds: string[], rows: T[]): T[] {
  const rowByOutputId = new Map(rows.map((row) => [row.outputId, row]));
  return outputIds.flatMap((outputId) => {
    const row = rowByOutputId.get(outputId);
    return row ? [row] : [];
  });
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function warnOnce(key: string, message: string): void {
  if (fallbackWarnings.has(key)) {
    return;
  }

  fallbackWarnings.add(key);
  console.warn(message);
}

function formatErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    const codeValue = (error as { code?: unknown }).code;
    const code = typeof codeValue === "string" ? `${codeValue}: ` : "";
    return `${code}${error.message}`;
  }

  return String(error);
}
