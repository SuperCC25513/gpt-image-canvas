import type { Hono } from "hono";
import type {
  CreatePromptFavoriteGroupRequest,
  CreatePromptFavoriteRequest,
  UpdatePromptFavoriteGroupRequest,
  UpdatePromptFavoriteRequest
} from "../../domain/contracts.js";
import {
  createPromptFavorite,
  createPromptFavoriteGroup,
  deletePromptFavorite,
  deletePromptFavoriteGroup,
  listPromptFavorites,
  markPromptFavoriteUsed,
  PromptFavoriteError,
  updatePromptFavorite,
  updatePromptFavoriteGroup
} from "../../domain/prompt-favorites/prompt-favorites.js";
import { requireAuth } from "../http/auth.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";

export function registerPromptFavoriteRoutes(app: Hono): void {
  app.get("/api/prompt-favorites", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(listPromptFavorites(auth.user));
  });

  app.post("/api/prompt-favorites", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json({ favorite: await createPromptFavorite(payload.value as CreatePromptFavoriteRequest, auth.user) }, 201);
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });

  app.patch("/api/prompt-favorites/:id", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json({ favorite: updatePromptFavorite(c.req.param("id"), payload.value as UpdatePromptFavoriteRequest, auth.user) });
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });

  app.delete("/api/prompt-favorites/:id", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      deletePromptFavorite(c.req.param("id"), auth.user);
      return c.json({ ok: true });
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });

  app.post("/api/prompt-favorites/:id/use", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      return c.json({ favorite: markPromptFavoriteUsed(c.req.param("id"), auth.user) });
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });

  app.post("/api/prompt-favorite-groups", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json({ group: createPromptFavoriteGroup(payload.value as CreatePromptFavoriteGroupRequest, auth.user) }, 201);
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });

  app.patch("/api/prompt-favorite-groups/:id", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json({ group: updatePromptFavoriteGroup(c.req.param("id"), payload.value as UpdatePromptFavoriteGroupRequest, auth.user) });
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });

  app.delete("/api/prompt-favorite-groups/:id", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    try {
      deletePromptFavoriteGroup(c.req.param("id"), auth.user);
      return c.json({ ok: true });
    } catch (error) {
      return promptFavoriteErrorJson(error);
    }
  });
}

function promptFavoriteErrorJson(error: unknown): Response {
  if (error instanceof PromptFavoriteError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: error.status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  return new Response(JSON.stringify(errorResponse("prompt_favorite_error", "Prompt favorite request failed.")), {
    status: 500,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
