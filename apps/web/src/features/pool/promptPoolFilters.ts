import type { PromptPoolItem, PromptPoolMediaType } from "@gpt-image-canvas/shared";

export type PromptPoolMediaFilter = "all" | PromptPoolMediaType;
export type PromptPoolSortMode = "latest" | "popular" | "ready";

export interface PromptPoolFilterState {
  mediaFilter: PromptPoolMediaFilter;
  modelFilter: string;
  query: string;
  sortMode: PromptPoolSortMode;
}

const PROMPT_POOL_FILTER_STORAGE_KEY = "gpt-image-canvas.prompt-pool.filters";

export const DEFAULT_PROMPT_POOL_FILTERS: PromptPoolFilterState = {
  mediaFilter: "all",
  modelFilter: "all",
  query: "",
  sortMode: "latest"
};

export function filterPromptPoolItems(
  items: PromptPoolItem[],
  query: string,
  mediaFilter: PromptPoolMediaFilter,
  modelFilter: string,
  sortMode: PromptPoolSortMode
): PromptPoolItem[] {
  const normalizedQuery = normalizeSearchText(query);
  const filtered = items.filter((item) => {
    if (mediaFilter !== "all" && item.mediaType !== mediaFilter) {
      return false;
    }

    if (modelFilter !== "all" && item.model !== modelFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return normalizeSearchText(`${item.title} ${item.prompt} ${item.model} ${item.author?.name ?? ""} ${item.author?.username ?? ""}`).includes(
      normalizedQuery
    );
  });

  if (sortMode === "latest") {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    if (sortMode === "ready") {
      return Number(b.promptReady) - Number(a.promptReady) || popularityScore(b) - popularityScore(a);
    }

    return popularityScore(b) - popularityScore(a);
  });
}

export function modelFilterOptions(items: PromptPoolItem[]): { count: number; model: string }[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    counts.set(item.model, (counts.get(item.model) ?? 0) + 1);
  });
  return Array.from(counts, ([model, count]) => ({ count, model })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
}

export function readPromptPoolFilterState(): PromptPoolFilterState {
  if (typeof window === "undefined") {
    return DEFAULT_PROMPT_POOL_FILTERS;
  }

  try {
    const raw = window.localStorage.getItem(PROMPT_POOL_FILTER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PROMPT_POOL_FILTERS;
    }

    const parsed = JSON.parse(raw) as Partial<PromptPoolFilterState>;
    return {
      mediaFilter: isPromptPoolMediaFilter(parsed.mediaFilter) ? parsed.mediaFilter : DEFAULT_PROMPT_POOL_FILTERS.mediaFilter,
      modelFilter: typeof parsed.modelFilter === "string" && parsed.modelFilter.trim() ? parsed.modelFilter : DEFAULT_PROMPT_POOL_FILTERS.modelFilter,
      query: typeof parsed.query === "string" ? parsed.query : DEFAULT_PROMPT_POOL_FILTERS.query,
      sortMode: isPromptPoolSortMode(parsed.sortMode) ? parsed.sortMode : DEFAULT_PROMPT_POOL_FILTERS.sortMode
    };
  } catch {
    return DEFAULT_PROMPT_POOL_FILTERS;
  }
}

export function writePromptPoolFilterState(filters: PromptPoolFilterState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PROMPT_POOL_FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // 过滤偏好只是体验增强；存储不可用时不影响提示池主流程。
  }
}

function isPromptPoolMediaFilter(value: unknown): value is PromptPoolMediaFilter {
  return value === "all" || value === "image" || value === "video";
}

function isPromptPoolSortMode(value: unknown): value is PromptPoolSortMode {
  return value === "latest" || value === "popular" || value === "ready";
}

function popularityScore(item: PromptPoolItem): number {
  return item.stats.views + item.stats.likes * 24 + item.stats.retweets * 40;
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
