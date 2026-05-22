import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  CreatePromptFavoriteGroupRequest,
  CreatePromptFavoriteRequest,
  CurrentUser,
  PromptFavoriteGroup,
  PromptFavoriteItem,
  PromptFavoritesResponse,
  UpdatePromptFavoriteGroupRequest,
  UpdatePromptFavoriteRequest
} from "../contracts.js";
import { databaseDriver, db } from "../../infrastructure/database.js";
import { promptFavoriteGroups, promptFavorites } from "../../infrastructure/schema.js";
import { getPromptPool } from "../prompt-pool/prompt-pool.js";

const DEFAULT_GROUP_ID = "default";
const DEFAULT_GROUP_NAME = "常用";
const MAX_GROUP_NAME_LENGTH = 32;

export class PromptFavoriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export function listPromptFavorites(user: CurrentUser): PromptFavoritesResponse {
  if (databaseDriver !== "sqlite") {
    return {
      groups: [defaultPromptFavoriteGroupView(user.id)],
      favorites: []
    };
  }

  ensureDefaultGroup(user.id);
  return {
    groups: db
      .select()
      .from(promptFavoriteGroups)
      .where(eq(promptFavoriteGroups.userId, user.id))
      .orderBy(asc(promptFavoriteGroups.sortOrder), asc(promptFavoriteGroups.createdAt))
      .all()
      .map(toPromptFavoriteGroup),
    favorites: db
      .select()
      .from(promptFavorites)
      .where(eq(promptFavorites.userId, user.id))
      .orderBy(desc(promptFavorites.lastUsedAt), desc(promptFavorites.updatedAt), desc(promptFavorites.createdAt))
      .all()
      .map(toPromptFavoriteItem)
  };
}

export async function createPromptFavorite(input: CreatePromptFavoriteRequest, user: CurrentUser): Promise<PromptFavoriteItem> {
  assertPromptFavoritesWritable();

  const promptPoolItemId = normalizeId(input.promptPoolItemId);
  if (!promptPoolItemId) {
    throw new PromptFavoriteError("invalid_prompt_favorite", "Prompt pool item id is required.");
  }

  const requestedGroupId = normalizeGroupId(input.groupId);
  const groupId = requestedGroupId ?? defaultGroupId(user.id);
  if (!requestedGroupId || groupId === defaultGroupId(user.id)) {
    ensureDefaultGroup(user.id);
  }
  const group = getPromptFavoriteGroupRow(groupId, user.id);
  if (!group) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const pool = await getPromptPool();
  const item = pool.items.find((candidate) => candidate.id === promptPoolItemId);
  if (!item) {
    throw new PromptFavoriteError("prompt_pool_item_not_found", "Prompt pool item was not found.", 404);
  }

  const existing = getPromptFavoriteBySource("pool", item.id, user.id);
  const now = nowIso();
  if (existing) {
    db.update(promptFavorites)
      .set({
        groupId,
        title: item.title,
        prompt: item.prompt,
        model: item.model,
        mediaType: item.mediaType,
        assetUrl: item.assetUrl,
        imageWidth: item.imageWidth ?? null,
        imageHeight: item.imageHeight ?? null,
        sourceUrl: item.sourceUrl ?? null,
        updatedAt: now
      })
      .where(eq(promptFavorites.id, existing.id))
      .run();
    return getPromptFavoriteById(existing.id, user.id) ?? toPromptFavoriteItem(existing);
  }

  const id = `favorite-${randomUUID()}`;
  db.insert(promptFavorites)
    .values({
      id,
      userId: user.id,
      sourceType: "pool",
      sourceId: item.id,
      groupId,
      title: item.title,
      prompt: item.prompt,
      model: item.model,
      mediaType: item.mediaType,
      assetUrl: item.assetUrl,
      imageWidth: item.imageWidth ?? null,
      imageHeight: item.imageHeight ?? null,
      sourceUrl: item.sourceUrl ?? null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return getPromptFavoriteById(id, user.id) ?? {
    id,
    sourceType: "pool",
    sourceId: item.id,
    groupId,
    title: item.title,
    prompt: item.prompt,
    model: item.model,
    mediaType: item.mediaType,
    assetUrl: item.assetUrl,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    sourceUrl: item.sourceUrl,
    useCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

export function updatePromptFavorite(favoriteId: string, input: UpdatePromptFavoriteRequest, user: CurrentUser): PromptFavoriteItem {
  assertPromptFavoritesWritable();

  const id = normalizeId(favoriteId);
  if (!id) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  const existing = getPromptFavoriteById(id, user.id);
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  const groupId = normalizeGroupId(input.groupId);
  if (!groupId || !getPromptFavoriteGroupRow(groupId, user.id)) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  db.update(promptFavorites)
    .set({
      groupId,
      updatedAt: nowIso()
    })
    .where(eq(promptFavorites.id, id))
    .run();

  return getPromptFavoriteById(id, user.id) ?? existing;
}

export function deletePromptFavorite(favoriteId: string, user: CurrentUser): void {
  assertPromptFavoritesWritable();

  const id = normalizeId(favoriteId);
  if (!id || !getPromptFavoriteById(id, user.id)) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  db.delete(promptFavorites).where(eq(promptFavorites.id, id)).run();
}

export function markPromptFavoriteUsed(favoriteId: string, user: CurrentUser): PromptFavoriteItem {
  assertPromptFavoritesWritable();

  const id = normalizeId(favoriteId);
  const existing = id ? getPromptFavoriteById(id, user.id) : undefined;
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_not_found", "Prompt favorite was not found.", 404);
  }

  const now = nowIso();
  db.update(promptFavorites)
    .set({
      useCount: existing.useCount + 1,
      lastUsedAt: now,
      updatedAt: now
    })
    .where(eq(promptFavorites.id, existing.id))
    .run();

  return getPromptFavoriteById(existing.id, user.id) ?? {
    ...existing,
    useCount: existing.useCount + 1,
    lastUsedAt: now,
    updatedAt: now
  };
}

export function createPromptFavoriteGroup(input: CreatePromptFavoriteGroupRequest, user: CurrentUser): PromptFavoriteGroup {
  assertPromptFavoritesWritable();

  const name = normalizeGroupName(input.name);
  if (!name) {
    throw new PromptFavoriteError("invalid_prompt_favorite_group", "Prompt favorite group name is required.");
  }

  const existing = getPromptFavoriteGroups(user.id).find((group) => group.name === name);
  if (existing) {
    return toPromptFavoriteGroup(existing);
  }

  const now = nowIso();
  const id = `group-${randomUUID()}`;
  const sortOrder = nextGroupSortOrder(user.id);
  db.insert(promptFavoriteGroups)
    .values({
      id,
      userId: user.id,
      name,
      sortOrder,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return getPromptFavoriteGroup(id, user.id) ?? {
    id,
    name,
    sortOrder,
    isDefault: false,
    createdAt: now,
    updatedAt: now
  };
}

export function updatePromptFavoriteGroup(groupIdValue: string, input: UpdatePromptFavoriteGroupRequest, user: CurrentUser): PromptFavoriteGroup {
  assertPromptFavoritesWritable();

  const groupId = normalizeGroupId(groupIdValue);
  if (!groupId) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const existing = getPromptFavoriteGroupRow(groupId, user.id);
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const name = normalizeGroupName(input.name);
  if (!name) {
    throw new PromptFavoriteError("invalid_prompt_favorite_group", "Prompt favorite group name is required.");
  }

  db.update(promptFavoriteGroups)
    .set({
      name,
      updatedAt: nowIso()
    })
    .where(eq(promptFavoriteGroups.id, groupId))
    .run();

  return getPromptFavoriteGroup(groupId, user.id) ?? toPromptFavoriteGroup(existing);
}

export function deletePromptFavoriteGroup(groupIdValue: string, user: CurrentUser): void {
  assertPromptFavoritesWritable();

  const groupId = normalizeGroupId(groupIdValue);
  if (!groupId) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  const existing = getPromptFavoriteGroupRow(groupId, user.id);
  if (!existing) {
    throw new PromptFavoriteError("prompt_favorite_group_not_found", "Prompt favorite group was not found.", 404);
  }

  if (groupId === defaultGroupId(user.id)) {
    throw new PromptFavoriteError("prompt_favorite_default_group", "The default prompt favorite group cannot be deleted.");
  }

  ensureDefaultGroup(user.id);
  const now = nowIso();
  db.update(promptFavorites)
    .set({
      groupId: defaultGroupId(user.id),
      updatedAt: now
    })
    .where(and(eq(promptFavorites.groupId, groupId), eq(promptFavorites.userId, user.id)))
    .run();
  db.delete(promptFavoriteGroups).where(and(eq(promptFavoriteGroups.id, groupId), eq(promptFavoriteGroups.userId, user.id))).run();
}

function ensureDefaultGroup(userId: string): void {
  const id = defaultGroupId(userId);
  if (getPromptFavoriteGroupRow(id, userId)) {
    return;
  }

  const now = nowIso();
  db.insert(promptFavoriteGroups)
    .values({
      id,
      userId,
      name: DEFAULT_GROUP_NAME,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now
    })
    .run();
}

function getPromptFavoriteById(id: string, userId: string): PromptFavoriteItem | undefined {
  const row = db.select().from(promptFavorites).where(and(eq(promptFavorites.id, id), eq(promptFavorites.userId, userId))).get();
  return row ? toPromptFavoriteItem(row) : undefined;
}

function getPromptFavoriteBySource(sourceType: "pool", sourceId: string, userId: string): (typeof promptFavorites.$inferSelect) | undefined {
  return db
    .select()
    .from(promptFavorites)
    .where(and(eq(promptFavorites.sourceType, sourceType), eq(promptFavorites.sourceId, sourceId), eq(promptFavorites.userId, userId)))
    .get();
}

function getPromptFavoriteGroup(id: string, userId: string): PromptFavoriteGroup | undefined {
  const row = getPromptFavoriteGroupRow(id, userId);
  return row ? toPromptFavoriteGroup(row) : undefined;
}

function getPromptFavoriteGroupRow(id: string, userId: string): (typeof promptFavoriteGroups.$inferSelect) | undefined {
  return db.select().from(promptFavoriteGroups).where(and(eq(promptFavoriteGroups.id, id), eq(promptFavoriteGroups.userId, userId))).get();
}

function getPromptFavoriteGroups(userId: string): Array<typeof promptFavoriteGroups.$inferSelect> {
  ensureDefaultGroup(userId);
  return db
    .select()
    .from(promptFavoriteGroups)
    .where(eq(promptFavoriteGroups.userId, userId))
    .orderBy(asc(promptFavoriteGroups.sortOrder))
    .all();
}

function nextGroupSortOrder(userId?: string): number {
  const groups = userId ? getPromptFavoriteGroups(userId) : db.select().from(promptFavoriteGroups).all();
  return Math.max(0, ...groups.map((group) => group.sortOrder)) + 100;
}

function toPromptFavoriteGroup(row: typeof promptFavoriteGroups.$inferSelect): PromptFavoriteGroup {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isDefault: row.id.startsWith(`${DEFAULT_GROUP_ID}:`) || row.id === DEFAULT_GROUP_ID,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function defaultPromptFavoriteGroupView(userId: string): PromptFavoriteGroup {
  return {
    id: defaultGroupId(userId),
    name: DEFAULT_GROUP_NAME,
    sortOrder: 0,
    isDefault: true,
    createdAt: "",
    updatedAt: ""
  };
}

function defaultGroupId(userId: string): string {
  return `${DEFAULT_GROUP_ID}:${userId}`;
}

function assertPromptFavoritesWritable(): void {
  if (databaseDriver !== "sqlite") {
    throw new PromptFavoriteError(
      "unsupported_storage_driver",
      "MySQL 模式当前不支持写入提示词收藏；后续任务会接入完整 store。",
      400
    );
  }
}

function toPromptFavoriteItem(row: typeof promptFavorites.$inferSelect): PromptFavoriteItem {
  return {
    id: row.id,
    sourceType: "pool",
    sourceId: row.sourceId,
    groupId: row.groupId,
    title: row.title,
    prompt: row.prompt,
    model: row.model,
    mediaType: row.mediaType === "video" ? "video" : "image",
    assetUrl: row.assetUrl,
    imageWidth: row.imageWidth ?? undefined,
    imageHeight: row.imageHeight ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeGroupName(value: string | undefined): string | undefined {
  const name = value?.trim().replace(/\s+/gu, " ");
  return name ? name.slice(0, MAX_GROUP_NAME_LENGTH) : undefined;
}

function normalizeGroupId(value: string | undefined): string | undefined {
  return normalizeId(value);
}

function normalizeId(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id && /^[a-zA-Z0-9:_-]{1,160}$/u.test(id) ? id : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}
