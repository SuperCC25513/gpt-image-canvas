import { desc, inArray, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import type {
  AdminGenerationQueueDatabaseSummary,
  AdminGenerationQueueFailureStatus,
  AdminGenerationQueueStatusResponse,
  GenerationStatus,
  OutputStatus
} from "../contracts.js";
import { checkRedisHealth } from "../../infrastructure/redis-runtime.js";
import { databaseDriver, db, getMySqlPool } from "../../infrastructure/database.js";
import { generationAudits, generationOutputs, generationRecords } from "../../infrastructure/schema.js";
import {
  getGenerationQueueSnapshot,
  type GenerationQueueSnapshot
} from "./generation-queue.js";
import { getProviderRetryConfig } from "./provider-retry-policy.js";
import {
  getProviderSchedulerConfig,
  getProviderSchedulerSnapshot,
  type ProviderSchedulerSnapshot
} from "./provider-scheduler.js";

const GENERATION_STATUSES: GenerationStatus[] = ["pending", "running", "succeeded", "partial", "failed", "cancelled"];
const OUTPUT_STATUSES: OutputStatus[] = ["succeeded", "failed"];
const FAILURE_STATUSES: AdminGenerationQueueFailureStatus[] = ["failed", "partial", "cancelled"];
const RECENT_FAILURE_LIMIT = 5;

interface CountPacket extends RowDataPacket {
  status: string;
  count: number | string;
}

interface FailurePacket extends RowDataPacket {
  generationId: string;
  status: string;
  errorSummary: string | null;
  updatedAt: string;
}

export async function readAdminGenerationQueueStatus(): Promise<AdminGenerationQueueStatusResponse> {
  let redisStatus = await checkRedisHealth();
  const readRedisMetrics = redisStatus === "ok";
  const [queue, provider, database] = await Promise.all([
    safeGenerationQueueSnapshot(readRedisMetrics, () => {
      redisStatus = "unavailable";
    }),
    safeProviderSchedulerSnapshot(readRedisMetrics, () => {
      redisStatus = "unavailable";
    }),
    readDatabaseSummary()
  ]);
  const retryConfig = getProviderRetryConfig();

  return {
    updatedAt: new Date().toISOString(),
    redis: {
      status: redisStatus
    },
    queue: {
      driver: queue.driver,
      readyLength: queue.readyLength,
      workerRunning: queue.workerRunning,
      activeWorkers: queue.activeWorkers,
      workerConcurrency: queue.workerConcurrency,
      pollIntervalMs: queue.pollIntervalMs
    },
    provider: {
      configuredConcurrency: provider.configuredConcurrency,
      activePermits: provider.activePermits,
      availablePermits: provider.availablePermits,
      permitTtlMs: provider.permitTtlMs
    },
    retry: {
      maxRetries: retryConfig.maxRetries,
      maxAttempts: retryConfig.maxRetries + 1,
      baseDelayMs: retryConfig.baseDelayMs,
      maxDelayMs: retryConfig.maxDelayMs
    },
    database
  };
}

async function safeGenerationQueueSnapshot(
  readRedisMetrics: boolean,
  markRedisUnavailable: () => void
): Promise<GenerationQueueSnapshot> {
  try {
    return await getGenerationQueueSnapshot({ readRedisMetrics });
  } catch {
    markRedisUnavailable();
    return getGenerationQueueSnapshot({ readRedisMetrics: false });
  }
}

async function safeProviderSchedulerSnapshot(
  readRedisMetrics: boolean,
  markRedisUnavailable: () => void
): Promise<ProviderSchedulerSnapshot> {
  try {
    return await getProviderSchedulerSnapshot({ readRedisMetrics });
  } catch {
    markRedisUnavailable();
    const config = getProviderSchedulerConfig();
    return {
      configuredConcurrency: config.globalConcurrency,
      permitTtlMs: config.permitTtlMs
    };
  }
}

async function readDatabaseSummary(): Promise<AdminGenerationQueueDatabaseSummary> {
  const [recordCounts, outputCounts, recentFailures] = await Promise.all([
    readRecordCounts(),
    readOutputCounts(),
    readRecentFailures()
  ]);

  return {
    records: recordCounts,
    outputs: outputCounts,
    recentFailures
  };
}

async function readRecordCounts(): Promise<Record<GenerationStatus, number>> {
  const counts = emptyStatusCounts(GENERATION_STATUSES);
  const rows =
    databaseDriver === "sqlite"
      ? db
          .select({
            status: generationRecords.status,
            count: sql<number>`COUNT(*)`
          })
          .from(generationRecords)
          .groupBy(generationRecords.status)
          .all()
      : await getMySqlPool()
          .execute<CountPacket[]>("SELECT status, COUNT(*) AS count FROM generation_records GROUP BY status")
          .then(([items]) => items);

  for (const row of rows) {
    if (isGenerationStatus(row.status)) {
      counts[row.status] = Number(row.count) || 0;
    }
  }

  return counts;
}

async function readOutputCounts(): Promise<Record<OutputStatus, number>> {
  const counts = emptyStatusCounts(OUTPUT_STATUSES);
  const rows =
    databaseDriver === "sqlite"
      ? db
          .select({
            status: generationOutputs.status,
            count: sql<number>`COUNT(*)`
          })
          .from(generationOutputs)
          .groupBy(generationOutputs.status)
          .all()
      : await getMySqlPool()
          .execute<CountPacket[]>("SELECT status, COUNT(*) AS count FROM generation_outputs GROUP BY status")
          .then(([items]) => items);

  for (const row of rows) {
    if (isOutputStatus(row.status)) {
      counts[row.status] = Number(row.count) || 0;
    }
  }

  return counts;
}

async function readRecentFailures(): Promise<AdminGenerationQueueDatabaseSummary["recentFailures"]> {
  const rows =
    databaseDriver === "sqlite"
      ? db
          .select({
            generationId: generationAudits.generationId,
            status: generationAudits.status,
            errorSummary: generationAudits.errorSummary,
            updatedAt: generationAudits.updatedAt
          })
          .from(generationAudits)
          .where(inArray(generationAudits.status, FAILURE_STATUSES))
          .orderBy(desc(generationAudits.updatedAt), desc(generationAudits.id))
          .limit(RECENT_FAILURE_LIMIT)
          .all()
      : await getMySqlPool()
          .execute<FailurePacket[]>(
            `SELECT generation_id AS generationId,
                    status,
                    error_summary AS errorSummary,
                    updated_at AS updatedAt
             FROM generation_audits
             WHERE status IN (${FAILURE_STATUSES.map(() => "?").join(", ")})
             ORDER BY updated_at DESC, id DESC
             LIMIT ${RECENT_FAILURE_LIMIT}`,
            FAILURE_STATUSES
          )
          .then(([items]) => items);

  return rows.flatMap((row) => {
    if (!isFailureStatus(row.status)) {
      return [];
    }
    return [
      {
        generationId: row.generationId,
        status: row.status,
        errorSummary: row.errorSummary ?? undefined,
        updatedAt: row.updatedAt
      }
    ];
  });
}

function emptyStatusCounts<TStatus extends string>(statuses: TStatus[]): Record<TStatus, number> {
  return Object.fromEntries(statuses.map((status) => [status, 0])) as Record<TStatus, number>;
}

function isGenerationStatus(value: string): value is GenerationStatus {
  return GENERATION_STATUSES.includes(value as GenerationStatus);
}

function isOutputStatus(value: string): value is OutputStatus {
  return OUTPUT_STATUSES.includes(value as OutputStatus);
}

function isFailureStatus(value: string): value is AdminGenerationQueueFailureStatus {
  return FAILURE_STATUSES.includes(value as AdminGenerationQueueFailureStatus);
}
