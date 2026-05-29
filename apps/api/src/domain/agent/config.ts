import { eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import type { AgentLlmConfigView, MaskedSecret, SaveAgentLlmConfigRequest } from "../contracts.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { agentLlmConfigs } from "../../infrastructure/schema.js";

const ACTIVE_AGENT_LLM_CONFIG_ID = "active";
export const DEFAULT_AGENT_LLM_TIMEOUT_MS = 60000;

type AgentLlmConfigRow = typeof agentLlmConfigs.$inferSelect;

interface MySqlAgentLlmConfigRow extends RowDataPacket, AgentLlmConfigRow {}

export interface UsableAgentLlmConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
}

export async function getAgentLlmConfig(): Promise<AgentLlmConfigView> {
  return toAgentLlmConfigView(await getAgentLlmConfigRow());
}

export async function getUsableAgentLlmConfig(): Promise<UsableAgentLlmConfig | undefined> {
  const row = await getAgentLlmConfigRow();
  const apiKey = trimToUndefined(row?.apiKey);
  const model = trimToUndefined(row?.model);
  const timeoutMs = validTimeoutMs(row?.timeoutMs);

  if (!apiKey || !model || !timeoutMs) {
    return undefined;
  }

  return {
    apiKey,
    baseUrl: trimToUndefined(row?.baseUrl),
    model,
    timeoutMs,
    supportsVision: row?.supportsVision === 1
  };
}

export async function saveAgentLlmConfig(input: SaveAgentLlmConfigRequest): Promise<AgentLlmConfigView> {
  const now = new Date().toISOString();
  const existing = await getAgentLlmConfigRow();
  const apiKey = resolveApiKeyForSave(input, existing);
  const baseUrl = input.baseUrl.trim();
  const model = requiredTrimmedString(input.model, "Agent LLM model");
  const timeoutMs = requiredPositiveInteger(input.timeoutMs, "Agent LLM timeout");

  if (!apiKey) {
    throw new Error("Agent LLM API key is required.");
  }

  const row: AgentLlmConfigRow = {
    id: ACTIVE_AGENT_LLM_CONFIG_ID,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    supportsVision: input.supportsVision ? 1 : 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  if (databaseDriver === "sqlite") {
    db.insert(agentLlmConfigs)
      .values(row)
      .onConflictDoUpdate({
        target: agentLlmConfigs.id,
        set: {
          apiKey: row.apiKey,
          baseUrl: row.baseUrl,
          model: row.model,
          timeoutMs: row.timeoutMs,
          supportsVision: row.supportsVision,
          updatedAt: row.updatedAt
        }
      })
      .run();
  } else {
    await saveMySqlAgentLlmConfigRow(row);
  }

  return getAgentLlmConfig();
}

async function getAgentLlmConfigRow(): Promise<AgentLlmConfigRow | undefined> {
  if (databaseDriver === "sqlite") {
    return db.select().from(agentLlmConfigs).where(eq(agentLlmConfigs.id, ACTIVE_AGENT_LLM_CONFIG_ID)).get();
  }

  const [rows] = await getMySqlPool().execute<MySqlAgentLlmConfigRow[]>(
    `SELECT
       id,
       api_key AS apiKey,
       base_url AS baseUrl,
       model,
       timeout_ms AS timeoutMs,
       supports_vision AS supportsVision,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM agent_llm_configs
     WHERE id = ?
     LIMIT 1`,
    [ACTIVE_AGENT_LLM_CONFIG_ID]
  );
  return rows[0];
}

async function saveMySqlAgentLlmConfigRow(row: AgentLlmConfigRow): Promise<void> {
  await getMySqlPool().execute(
    `INSERT INTO agent_llm_configs
      (id, api_key, base_url, model, timeout_ms, supports_vision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       api_key = VALUES(api_key),
       base_url = VALUES(base_url),
       model = VALUES(model),
       timeout_ms = VALUES(timeout_ms),
       supports_vision = VALUES(supports_vision),
       updated_at = VALUES(updated_at)`,
    [row.id, row.apiKey, row.baseUrl, row.model, row.timeoutMs, row.supportsVision, row.createdAt, row.updatedAt]
  );
}

function toAgentLlmConfigView(row: AgentLlmConfigRow | undefined): AgentLlmConfigView {
  const timeoutMs = validTimeoutMs(row?.timeoutMs) ?? DEFAULT_AGENT_LLM_TIMEOUT_MS;
  const apiKey = trimToUndefined(row?.apiKey);
  const model = row?.model?.trim() ?? "";

  return {
    configured: Boolean(apiKey && model),
    apiKey: maskedSecret(apiKey),
    baseUrl: row?.baseUrl?.trim() ?? "",
    model,
    timeoutMs,
    supportsVision: row?.supportsVision === 1,
    createdAt: row?.createdAt ?? "",
    updatedAt: row?.updatedAt ?? ""
  };
}

function resolveApiKeyForSave(
  input: SaveAgentLlmConfigRequest,
  existing: AgentLlmConfigRow | undefined
): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    const existingSecret = trimToUndefined(existing?.apiKey);
    if (trimmed && existingSecret && trimmed === maskSecret(existingSecret)) {
      return existingSecret;
    }
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existingSecret ?? null) : null;
  }

  if (input.preserveApiKey === true) {
    return trimToUndefined(existing?.apiKey) ?? null;
  }

  return trimToUndefined(existing?.apiKey) ?? null;
}

function requiredTrimmedString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function requiredPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function maskedSecret(value: string | null | undefined): MaskedSecret {
  const trimmed = trimToUndefined(value);
  return {
    hasSecret: Boolean(trimmed),
    value: trimmed ? maskSecret(trimmed) : undefined
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validTimeoutMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
