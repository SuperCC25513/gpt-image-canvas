import type {
  CreatePromptFavoriteGroupRequest,
  CreatePromptFavoriteRequest,
  PromptFavoriteGroup,
  PromptFavoriteItem,
  PromptFavoritesResponse,
  UpdatePromptFavoriteGroupRequest,
  UpdatePromptFavoriteRequest
} from "@gpt-image-canvas/shared";

export async function fetchPromptFavorites(signal?: AbortSignal): Promise<PromptFavoritesResponse> {
  const response = await fetch("/api/prompt-favorites", { signal });
  return parseJsonResponse(response, isPromptFavoritesResponse);
}

export async function createPromptFavorite(input: CreatePromptFavoriteRequest): Promise<PromptFavoriteItem> {
  const response = await fetch("/api/prompt-favorites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse(response, isPromptFavoriteItemResponse)).favorite;
}

export async function updatePromptFavorite(favoriteId: string, input: UpdatePromptFavoriteRequest): Promise<PromptFavoriteItem> {
  const response = await fetch(`/api/prompt-favorites/${encodeURIComponent(favoriteId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse(response, isPromptFavoriteItemResponse)).favorite;
}

export async function deletePromptFavorite(favoriteId: string): Promise<void> {
  const response = await fetch(`/api/prompt-favorites/${encodeURIComponent(favoriteId)}`, {
    method: "DELETE"
  });
  await parseJsonResponse(response, isOkResponse);
}

export async function markPromptFavoriteUsed(favoriteId: string): Promise<PromptFavoriteItem> {
  const response = await fetch(`/api/prompt-favorites/${encodeURIComponent(favoriteId)}/use`, {
    method: "POST"
  });
  return (await parseJsonResponse(response, isPromptFavoriteItemResponse)).favorite;
}

export async function createPromptFavoriteGroup(input: CreatePromptFavoriteGroupRequest): Promise<PromptFavoriteGroup> {
  const response = await fetch("/api/prompt-favorite-groups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse(response, isPromptFavoriteGroupResponse)).group;
}

export async function updatePromptFavoriteGroup(groupId: string, input: UpdatePromptFavoriteGroupRequest): Promise<PromptFavoriteGroup> {
  const response = await fetch(`/api/prompt-favorite-groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return (await parseJsonResponse(response, isPromptFavoriteGroupResponse)).group;
}

export async function deletePromptFavoriteGroup(groupId: string): Promise<void> {
  const response = await fetch(`/api/prompt-favorite-groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE"
  });
  await parseJsonResponse(response, isOkResponse);
}

async function parseJsonResponse<T>(response: Response, guard: (value: unknown) => value is T): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : undefined;
    throw new Error(message || `Request failed with status ${response.status}.`);
  }

  if (!guard(body)) {
    throw new Error("Prompt favorites returned unrecognized data.");
  }

  return body;
}

function isPromptFavoritesResponse(value: unknown): value is PromptFavoritesResponse {
  return isRecord(value) && Array.isArray(value.groups) && value.groups.every(isPromptFavoriteGroup) && Array.isArray(value.favorites) && value.favorites.every(isPromptFavoriteItem);
}

function isPromptFavoriteItemResponse(value: unknown): value is { favorite: PromptFavoriteItem } {
  return isRecord(value) && isPromptFavoriteItem(value.favorite);
}

function isPromptFavoriteGroupResponse(value: unknown): value is { group: PromptFavoriteGroup } {
  return isRecord(value) && isPromptFavoriteGroup(value.group);
}

function isOkResponse(value: unknown): value is { ok: boolean } {
  return isRecord(value) && value.ok === true;
}

function isPromptFavoriteGroup(value: unknown): value is PromptFavoriteGroup {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isFiniteNumber(value.sortOrder) &&
    typeof value.isDefault === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isPromptFavoriteItem(value: unknown): value is PromptFavoriteItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.sourceType === "pool" &&
    typeof value.sourceId === "string" &&
    typeof value.groupId === "string" &&
    typeof value.title === "string" &&
    typeof value.prompt === "string" &&
    typeof value.model === "string" &&
    (value.mediaType === "image" || value.mediaType === "video") &&
    typeof value.assetUrl === "string" &&
    (value.imageWidth === undefined || isFiniteNumber(value.imageWidth)) &&
    (value.imageHeight === undefined || isFiniteNumber(value.imageHeight)) &&
    (value.sourceUrl === undefined || typeof value.sourceUrl === "string") &&
    isFiniteNumber(value.useCount) &&
    (value.lastUsedAt === undefined || typeof value.lastUsedAt === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
