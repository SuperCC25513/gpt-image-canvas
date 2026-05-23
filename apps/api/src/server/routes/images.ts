import type { Hono } from "hono";
import {
  cancelGenerationTask,
  initializeGenerationTaskManager,
  readGenerationTaskRecord,
  startReferenceImageGenerationTask,
  startTextToImageGenerationTask
} from "../../domain/generation/generation-tasks.js";
import type { GenerationAuditRequestContext } from "../../domain/admin/audit-store.js";
import { CreditDomainError } from "../../domain/credits/credit-store.js";
import { GenerationDomainError } from "../../domain/generation/image-generation.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { requireAuth } from "../http/auth.js";
import { errorResponse, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseEditPayload, parseGeneratePayload } from "../http/validation.js";

export function registerImageRoutes(app: Hono): void {
  void initializeGenerationTaskManager().catch((error: unknown) => {
    console.error("Generation task manager initialization failed.", error);
  });

  app.post("/api/images/generate", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseGeneratePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json({ record: await startTextToImageGenerationTask(parsed.value, auth.user, auditContextFromRequest(c.req.raw)) });
    } catch (error) {
      if (error instanceof CreditDomainError) {
        return creditErrorJson(error);
      }

      if (error instanceof GenerationDomainError) {
        return generationErrorJson(error);
      }

      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/images/edit", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = await parseEditPayload(payload.value, auth.user);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json({ record: await startReferenceImageGenerationTask(parsed.value, auth.user, auditContextFromRequest(c.req.raw)) });
    } catch (error) {
      if (error instanceof CreditDomainError) {
        return creditErrorJson(error);
      }

      if (error instanceof GenerationDomainError) {
        return generationErrorJson(error);
      }

      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.get("/api/generations/:id", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const generationId = c.req.param("id").trim();
    const record = generationId ? await readGenerationTaskRecord(generationId, auth.user) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }

    return c.json({ record });
  });

  app.post("/api/generations/:id/cancel", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const generationId = c.req.param("id").trim();
    const record = generationId ? await cancelGenerationTask(generationId, auth.user) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }

    return c.json({ record });
  });
}

function auditContextFromRequest(request: Request): GenerationAuditRequestContext {
  return {
    ipAddress: firstForwardedIp(request.headers.get("x-forwarded-for")) ?? headerSummary(request.headers.get("x-real-ip")),
    userAgent: headerSummary(request.headers.get("user-agent"), 500)
  };
}

function firstForwardedIp(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return headerSummary(first ?? null, 191);
}

function headerSummary(value: string | null, maxLength = 191): string | undefined {
  const sanitized = value?.replace(/[\r\n]/gu, " ").trim();
  return sanitized ? sanitized.slice(0, maxLength) : undefined;
}

function creditErrorJson(error: CreditDomainError): Response {
  return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
    status: error.status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function generationErrorJson(error: GenerationDomainError): Response {
  return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
    status: error.status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
