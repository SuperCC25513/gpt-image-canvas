import type { Hono } from "hono";
import {
  AgentSkillError,
  MAX_SKILL_UPLOAD_BYTES,
  createAgentSkill,
  getAgentSkill,
  importAgentSkillFromUpload,
  isAgentSkillStorageWritable,
  listAgentSkills,
  saveAgentSkill
} from "../../domain/agent/skill-store.js";
import type { SaveAgentSkillRequest } from "../../domain/contracts.js";
import { requireAdmin, requireAuth } from "../http/auth.js";
import { errorResponse, errorToMessage } from "../http/errors.js";
import { jsonErrorStatus, readJson } from "../http/json.js";

export function registerAgentSkillRoutes(app: Hono): void {
  app.get("/api/agent-skills", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    return c.json(listAgentSkills());
  });

  app.get("/api/agent-skills/:id", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const skill = getAgentSkill(c.req.param("id"));
    if (!skill) {
      return c.json(errorResponse("agent_skill_not_found", "Agent skill was not found."), 404);
    }

    return c.json({ skill });
  });

  app.post("/api/agent-skills", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!isAgentSkillStorageWritable()) {
      return c.json(errorResponse("agent_skill_unsupported_storage", "Agent skill editing is not supported in MySQL mode."), 501);
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, jsonErrorStatus(payload.error));
    }

    try {
      return c.json(createAgentSkill(payload.value as SaveAgentSkillRequest), 201);
    } catch (error) {
      return agentSkillErrorJson(error);
    }
  });

  app.put("/api/agent-skills/:id", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!isAgentSkillStorageWritable()) {
      return c.json(errorResponse("agent_skill_unsupported_storage", "Agent skill editing is not supported in MySQL mode."), 501);
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, jsonErrorStatus(payload.error));
    }

    try {
      return c.json(saveAgentSkill(c.req.param("id"), payload.value as SaveAgentSkillRequest));
    } catch (error) {
      return agentSkillErrorJson(error);
    }
  });

  app.post("/api/agent-skills/import", async (c) => {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!isAgentSkillStorageWritable()) {
      return c.json(errorResponse("agent_skill_unsupported_storage", "Agent skill editing is not supported in MySQL mode."), 501);
    }

    const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return c.json(errorResponse("unsupported_media_type", "Agent skill import requires multipart/form-data."), 415);
    }
    const contentLength = parseContentLength(c.req.header("content-length"));
    if (contentLength && contentLength > MAX_SKILL_UPLOAD_BYTES + 64 * 1024) {
      return c.json(errorResponse("agent_skill_import_failed", "Agent skill upload is too large."), 413);
    }

    let formData: FormData;
    try {
      formData = await c.req.raw.formData();
    } catch (error) {
      return c.json(errorResponse("invalid_agent_skill", errorToMessage(error)), 400);
    }

    const file = formData.get("file") ?? formData.get("skill") ?? formData.get("bundle");
    if (!(file instanceof File)) {
      return c.json(errorResponse("agent_skill_invalid_file", "Upload a SKILL.md file or zip bundle."), 400);
    }
    if (file.size > MAX_SKILL_UPLOAD_BYTES) {
      return c.json(errorResponse("agent_skill_import_failed", "Agent skill upload is too large."), 413);
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(
        importAgentSkillFromUpload({
          fileName: file.name,
          mediaType: file.type,
          bytes
        }),
        201
      );
    } catch (error) {
      return agentSkillErrorJson(error);
    }
  });
}

function parseContentLength(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function agentSkillErrorJson(error: unknown): Response {
  if (error instanceof AgentSkillError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: agentSkillHttpStatus(error.code),
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  return new Response(JSON.stringify(errorResponse("agent_skill_error", errorToMessage(error))), {
    status: 400,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function agentSkillHttpStatus(code: string): number {
  if (code === "agent_skill_not_found") {
    return 404;
  }

  if (code === "unsupported_media_type") {
    return 415;
  }
  if (code === "agent_skill_unsupported_storage") {
    return 501;
  }

  return 400;
}
