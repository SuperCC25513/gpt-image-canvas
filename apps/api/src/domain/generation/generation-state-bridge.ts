import { randomUUID } from "node:crypto";
import { readGenerationAuditVisibility } from "../admin/audit-store.js";
import { listGenerationQueueRecoveryRecords } from "../storage/store.js";
import { ensureGenerationJobQueued, removeGenerationJob } from "./generation-queue.js";
import { markInterruptedGenerationRecordsFailed } from "./image-generation.js";

export interface GenerationQueueRecoveryResult {
  recoveredPending: number;
  failedRunning: number;
}

export async function recoverGenerationQueueState(): Promise<GenerationQueueRecoveryResult> {
  const interruptedGenerationIds = await markInterruptedGenerationRecordsFailed({ includePending: false });
  for (const generationId of interruptedGenerationIds) {
    await removeGenerationJob(generationId);
  }

  const pendingRecords = await listGenerationQueueRecoveryRecords(["pending"]);
  for (const record of pendingRecords) {
    const isPublic = (await readGenerationAuditVisibility(record.id)) ?? false;
    await ensureGenerationJobQueued({
      jobId: randomUUID(),
      generationId: record.id,
      userId: record.userId ?? "anonymous",
      mode: record.mode,
      isPublic,
      attempt: 1,
      maxAttempts: 1,
      enqueuedAt: new Date().toISOString()
    });
  }

  return {
    recoveredPending: pendingRecords.length,
    failedRunning: interruptedGenerationIds.length
  };
}
