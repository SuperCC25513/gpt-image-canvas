import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { AgentSelectedCanvasReference, AgentServerEvent, CurrentUser, GenerationPlan } from "../domain/contracts.js";
import type { EditImageProviderInput, ImageProvider, ImageProviderInput, ProviderResult } from "../infrastructure/providers/image-provider.js";
import { creditTransactions, generationAudits, users } from "../infrastructure/schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `agent-executor-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const smokeUser: CurrentUser = {
  id: "user-agent-executor-smoke",
  name: "Agent Executor Smoke",
  email: "agent-executor-smoke@example.local",
  role: "user",
  status: "active",
  credits: 1000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

async function main(): Promise<void> {
  try {
    const [{ executeGenerationPlan, isExecutableGenerationPlan }, { closeDatabase, db }, imageGeneration, generationTasks] = await Promise.all([
      import("../domain/agent/executor.js"),
      import("../infrastructure/database.js"),
      import("../domain/generation/image-generation.js"),
      import("../domain/generation/generation-tasks.js")
    ]);

    try {
      seedUser(db, smokeUser);
      await smokeAgentGenerationBusinessRules(executeGenerationPlan, generationTasks, db);

      const successProvider = new FakeImageProvider();
      const events: AgentServerEvent[] = [];
      const success = await executeGenerationPlan({
        plan: planFixture(),
        selectedReferences: [],
        mode: "execute",
        user: smokeUser,
        provider: successProvider,
        requestId: "smoke-execute",
        runId: "run-smoke",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: (event) => events.push(event)
      });

      expect(success.status === "succeeded", "DAG execution succeeds");
      expect(success.plan.jobs.every((job) => job.status === "succeeded"), "all jobs are marked succeeded");
      expect(successProvider.generateCalls === 1, "anchor job uses text-to-image generation");
      expect(successProvider.editCalls === 1, "downstream generated reference uses edit generation");
      expect(events.filter((event) => event.type === "asset_preview").length === 2, "each generated asset emits a preview");

      const selectedAssetId = success.plan.jobs[0]?.outputs[0]?.asset?.id;
      expect(selectedAssetId, "successful fixture creates a stored asset for selected reference checks");
      const selectedProvider = new FakeImageProvider();
      const selectedReference = {
        id: "selected-1",
        assetId: `asset:${selectedAssetId}`,
        label: "Selected fixture"
      } satisfies AgentSelectedCanvasReference;
      const selectedReferencePlan = selectedReferencePlanFixture(`asset:${selectedAssetId}`);
      const selectedReferenceRun = await executeGenerationPlan({
        plan: selectedReferencePlan,
        selectedReferences: [selectedReference],
        mode: "execute",
        user: smokeUser,
        provider: selectedProvider,
        requestId: "smoke-selected-reference",
        runId: "run-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(selectedReferenceRun.status === "succeeded", "selected references with tldraw asset: prefix resolve to stored assets");
      expect(selectedProvider.editCalls === 1, "selected reference run uses edit generation");

      const localSelectedProvider = new FakeImageProvider();
      const localSelectedReference = {
        id: "selected-local-1",
        assetId: "local-only-reference",
        label: "Local canvas image",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPngBase64}`
      } satisfies AgentSelectedCanvasReference;
      const localSelectedReferenceRun = await executeGenerationPlan({
        plan: selectedReferencePlanFixture("local-only-reference"),
        selectedReferences: [localSelectedReference],
        mode: "execute",
        user: smokeUser,
        provider: localSelectedProvider,
        requestId: "smoke-local-selected-reference",
        runId: "run-local-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(localSelectedReferenceRun.status === "succeeded", "selected references with local-only asset ids are persisted before edit generation");
      expect(localSelectedProvider.editCalls === 1, "local-only selected reference run still uses edit generation");

      const multiSelectedProvider = new FakeImageProvider();
      const multiSelectedRun = await executeGenerationPlan({
        plan: multiSelectedReferencePlanFixture(),
        selectedReferences: [
          localSelectedReference,
          {
            id: "selected-local-2",
            assetId: "local-only-reference-2",
            label: "Second local canvas image",
            mimeType: "image/png",
            dataUrl: `data:image/png;base64,${tinyPngBase64}`
          }
        ],
        mode: "execute",
        user: smokeUser,
        provider: multiSelectedProvider,
        requestId: "smoke-multi-selected-reference",
        runId: "run-multi-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(multiSelectedRun.status === "succeeded", "multiple independent selected-reference jobs succeed");
      expect(multiSelectedProvider.generateCalls === 0, "multiple selected-reference jobs do not call text generation");
      expect(multiSelectedProvider.editCalls === 2, "multiple selected-reference jobs each use edit generation");

      const arbitraryCountProvider = new FakeImageProvider();
      const arbitraryCountPlan = arbitraryCountPlanFixture();
      expect(isExecutableGenerationPlan(arbitraryCountPlan), "single agent job can request an arbitrary count up to the plan cap");
      const arbitraryCountRun = await executeGenerationPlan({
        plan: arbitraryCountPlan,
        selectedReferences: [],
        mode: "execute",
        user: smokeUser,
        provider: arbitraryCountProvider,
        requestId: "smoke-arbitrary-count",
        runId: "run-arbitrary-count",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(arbitraryCountRun.status === "succeeded", "arbitrary-count agent job succeeds");
      expect(arbitraryCountProvider.generateCalls === 9, "arbitrary-count agent job is fanned out by the generation runner");
      expect(arbitraryCountRun.plan.jobs[0]?.outputs.length === 9, "arbitrary-count agent job preserves all outputs on one job");

      const retryProvider = new FakeImageProvider();
      const retryPlan = clonePlan(success.plan);
      const finalJob = retryPlan.jobs.find((job) => job.id === "final_scene");
      expect(finalJob, "retry fixture includes final job");
      finalJob.status = "failed";
      finalJob.outputs = [];
      finalJob.error = "retry me";
      retryPlan.status = "partial";

      const retry = await executeGenerationPlan({
        plan: retryPlan,
        selectedReferences: [],
        mode: "retry_failed",
        user: smokeUser,
        provider: retryProvider,
        requestId: "smoke-retry",
        runId: "run-retry",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(retry.status === "succeeded", "retry_failed recovers failed downstream job");
      expect(retryProvider.generateCalls === 0, "retry keeps succeeded upstream anchor");
      expect(retryProvider.editCalls === 1, "retry reruns failed downstream job");

      await smokeManualGenerationRecords(imageGeneration);

      const failedProvider = new FakeImageProvider({ failGenerate: true });
      const blocked = await executeGenerationPlan({
        plan: planFixture("plan-blocked"),
        selectedReferences: [],
        mode: "execute",
        user: smokeUser,
        provider: failedProvider,
        requestId: "smoke-blocked",
        runId: "run-blocked",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(blocked.status === "failed", "failed upstream plan reports failed");
      expect(blocked.plan.jobs.find((job) => job.id === "final_scene")?.status === "blocked", "downstream job is blocked");
    } finally {
      closeDatabase();
    }

    console.log("agent executor smoke checks passed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

class FakeImageProvider implements ImageProvider {
  generateCalls = 0;
  editCalls = 0;

  constructor(private readonly options: { failGenerate?: boolean; failGenerateOnCalls?: Set<number> } = {}) {}

  async generate(input: ImageProviderInput): Promise<ProviderResult> {
    this.generateCalls += 1;
    if (this.options.failGenerate || this.options.failGenerateOnCalls?.has(this.generateCalls)) {
      throw new Error("fake text generation failed");
    }

    return providerResult(input.sizeApiValue);
  }

  async edit(input: EditImageProviderInput): Promise<ProviderResult> {
    this.editCalls += 1;
    expect(input.referenceImages.length > 0, "edit generation receives references");
    return providerResult(input.sizeApiValue);
  }
}

async function smokeAgentGenerationBusinessRules(
  executeGenerationPlan: typeof import("../domain/agent/executor.js").executeGenerationPlan,
  generationTasks: typeof import("../domain/generation/generation-tasks.js"),
  db: typeof import("../infrastructure/database.js").db
): Promise<void> {
  const billingUser = userFixture("agent-billing", 10);
  seedUser(db, billingUser);
  const billingProvider = new FakeImageProvider();
  const billingRun = await executeGenerationPlan({
    plan: singleJobPlanFixture("plan-agent-billing", 1),
    selectedReferences: [],
    mode: "execute",
    user: billingUser,
    provider: billingProvider,
    requestId: "smoke-agent-billing",
    runId: "run-agent-billing",
    signal: new AbortController().signal,
    isRunActive: () => true,
    sendEvent: () => undefined
  });
  expect(billingRun.status === "succeeded", "agent generation succeeds through the business task runner");
  expect(billingProvider.generateCalls === 1, "agent billing run calls provider once");
  expect(readUserCredits(db, billingUser.id) === 9, "agent generation charges credits for successful output");
  expect(countCreditTransactions(db, billingUser.id, "generation_charge") === 1, "agent generation writes a charge transaction");
  expect(countGenerationAudits(db, billingUser.id, "succeeded") === 1, "agent generation writes a succeeded audit row");

  const insufficientUser = userFixture("agent-insufficient", 0);
  seedUser(db, insufficientUser);
  const insufficientProvider = new FakeImageProvider();
  const insufficientRun = await executeGenerationPlan({
    plan: singleJobPlanFixture("plan-agent-insufficient", 1),
    selectedReferences: [],
    mode: "execute",
    user: insufficientUser,
    provider: insufficientProvider,
    requestId: "smoke-agent-insufficient",
    runId: "run-agent-insufficient",
    signal: new AbortController().signal,
    isRunActive: () => true,
    sendEvent: () => undefined
  });
  expect(insufficientRun.status === "failed", "insufficient agent generation fails stably");
  expect(insufficientProvider.generateCalls === 0, "insufficient agent generation does not call provider");
  expect(readUserCredits(db, insufficientUser.id) === 0, "insufficient agent generation leaves credits unchanged");
  expect(countCreditTransactions(db, insufficientUser.id) === 0, "insufficient agent generation writes no credit transaction");

  const partialUser = userFixture("agent-partial", 10);
  seedUser(db, partialUser);
  const partialProvider = new FakeImageProvider({ failGenerateOnCalls: new Set([2]) });
  const partialEvents: AgentServerEvent[] = [];
  const partialRun = await executeGenerationPlan({
    plan: singleJobPlanFixture("plan-agent-partial", 2),
    selectedReferences: [],
    mode: "execute",
    user: partialUser,
    provider: partialProvider,
    requestId: "smoke-agent-partial",
    runId: "run-agent-partial",
    signal: new AbortController().signal,
    isRunActive: () => true,
    sendEvent: (event) => partialEvents.push(event)
  });
  const partialJob = partialRun.plan.jobs[0];
  expect(partialRun.status === "partial", "partial agent generation reports partial run status");
  expect(partialRun.plan.status === "partial", "partial agent generation reports partial plan status");
  expect(partialJob?.status === "partial", "partial agent generation marks job partial");
  expect(partialJob.outputs.filter((output) => output.status === "succeeded").length === 1, "partial job keeps successful output");
  expect(partialEvents.some((event) => event.type === "job_completed"), "partial job emits job_completed with outputs");
  expect(partialEvents.filter((event) => event.type === "asset_preview").length === 1, "partial job emits preview for the successful asset");
  expect(readUserCredits(db, partialUser.id) === 9, "partial agent generation refunds failed output credits");
  expect(countCreditTransactions(db, partialUser.id, "generation_charge") === 1, "partial agent generation writes one charge");
  expect(countCreditTransactions(db, partialUser.id, "generation_refund") === 1, "partial agent generation writes one refund");
  expect(countGenerationAudits(db, partialUser.id, "partial") === 1, "partial agent generation updates audit status");

  const ownerUser = userFixture("generation-owner-a", 10);
  const otherUser = userFixture("generation-owner-b", 10);
  seedUser(db, ownerUser);
  seedUser(db, otherUser);
  const ownerProvider = new FakeImageProvider();
  const ownerRecord = await generationTasks.runTextToImageGenerationTask(
    imageProviderInputFixture({ clientRequestId: "shared-generation-id" }),
    ownerUser,
    ownerProvider,
    new AbortController().signal
  );
  expect(ownerRecord.status === "succeeded", "owner fixture generation succeeds");
  const ownerCreditsAfterGeneration = readUserCredits(db, ownerUser.id);
  const otherProvider = new FakeImageProvider();
  let conflictCode = "";
  try {
    await generationTasks.runTextToImageGenerationTask(
      imageProviderInputFixture({ clientRequestId: "shared-generation-id" }),
      otherUser,
      otherProvider,
      new AbortController().signal
    );
  } catch (error) {
    conflictCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
  }
  expect(conflictCode === "generation_id_conflict", "cross-user generation id reuse returns a stable conflict");
  expect(otherProvider.generateCalls === 0, "cross-user generation id conflict does not call provider");
  expect(readUserCredits(db, ownerUser.id) === ownerCreditsAfterGeneration, "cross-user conflict does not refund or charge the owner");
  expect(readUserCredits(db, otherUser.id) === 10, "cross-user conflict leaves the other user credits unchanged");
}

async function smokeManualGenerationRecords(imageGeneration: typeof import("../domain/generation/image-generation.js")): Promise<void> {
  const input = imageProviderInputFixture({ clientRequestId: "manual-smoke-running" });
  const running = await imageGeneration.createRunningTextToImageGeneration(input);
  expect(running.id === "manual-smoke-running", "manual running generation preserves clientRequestId");
  expect(running.status === "running", "manual generation starts as running");
  expect(running.outputs.length === 0, "manual running generation has no outputs yet");
  expect((await imageGeneration.getGenerationRecord(running.id))?.status === "running", "manual running generation is persisted");

  const completed = await imageGeneration.finishTextToImageGeneration(
    running.id,
    input,
    new FakeImageProvider(),
    new AbortController().signal
  );
  expect(completed.id === running.id, "manual generation completes the same record");
  expect(completed.status === "succeeded", "manual generation can complete asynchronously");
  expect(completed.outputs.length === 1 && completed.outputs[0]?.asset, "manual generation stores the generated asset");

  const referenceInput = editImageProviderInputFixture({ clientRequestId: "manual-smoke-reference" });
  const referenceRunning = await imageGeneration.createRunningReferenceImageGeneration(referenceInput);
  expect(referenceRunning.record.id === "manual-smoke-reference", "manual reference generation preserves clientRequestId");
  expect(referenceRunning.record.mode === "edit", "manual reference generation is stored as edit mode");
  expect(referenceRunning.record.referenceAssetIds?.length === 1, "manual reference generation persists reference asset IDs");
  expect(referenceRunning.record.outputs.length === 0, "manual running reference generation has no outputs yet");

  const referenceProvider = new FakeImageProvider();
  const referenceCompleted = await imageGeneration.finishReferenceImageGeneration(
    referenceRunning.record.id,
    referenceRunning.input,
    referenceProvider,
    new AbortController().signal
  );
  expect(referenceCompleted.id === referenceRunning.record.id, "manual reference generation completes the same record");
  expect(referenceCompleted.status === "succeeded", "manual reference generation can complete asynchronously");
  expect(referenceCompleted.outputs.length === 1 && referenceCompleted.outputs[0]?.asset, "manual reference generation stores output asset");
  expect(referenceProvider.editCalls === 1, "manual reference generation calls edit provider once");

  const cancellable = await imageGeneration.createRunningTextToImageGeneration(
    imageProviderInputFixture({ clientRequestId: "manual-smoke-cancel" })
  );
  const cancelled = await imageGeneration.cancelGenerationRecord(cancellable.id);
  expect(cancelled?.status === "cancelled", "manual generation cancellation is persisted");

  const stale = await imageGeneration.createRunningTextToImageGeneration(imageProviderInputFixture({ clientRequestId: "manual-smoke-stale" }));
  await imageGeneration.markInterruptedGenerationRecordsFailed();
  const interrupted = await imageGeneration.getGenerationRecord(stale.id);
  expect(interrupted?.status === "failed", "stale running generation is marked failed on API startup");
}

function imageProviderInputFixture(overrides: Partial<ImageProviderInput> = {}): ImageProviderInput {
  return {
    originalPrompt: "Create a fixture image.",
    presetId: "none",
    prompt: "Create a fixture image.",
    size: {
      width: 1024,
      height: 1024
    },
    sizeApiValue: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    count: 1,
    ...overrides
  };
}

function editImageProviderInputFixture(overrides: Partial<EditImageProviderInput> = {}): EditImageProviderInput {
  return {
    ...imageProviderInputFixture(),
    referenceImages: [
      {
        dataUrl: `data:image/png;base64,${tinyPngBase64}`
      }
    ],
    ...overrides
  };
}

function userFixture(id: string, credits: number): CurrentUser {
  return {
    id: `user-${id}`,
    name: `Smoke ${id}`,
    email: `${id}@example.local`,
    role: "user",
    status: "active",
    credits,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function seedUser(db: typeof import("../infrastructure/database.js").db, user: CurrentUser): void {
  db.insert(users)
    .values({
      id: user.id,
      name: user.name,
      email: user.email,
      passwordSalt: "smoke",
      passwordIterations: 1,
      passwordHash: "smoke",
      role: user.role,
      status: user.status,
      credits: user.credits,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    })
    .run();
}

function readUserCredits(db: typeof import("../infrastructure/database.js").db, userId: string): number {
  const row = db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).get();
  return row?.credits ?? 0;
}

function countCreditTransactions(
  db: typeof import("../infrastructure/database.js").db,
  userId: string,
  reason?: "generation_charge" | "generation_refund"
): number {
  const rows = db
    .select({ id: creditTransactions.id, reason: creditTransactions.reason })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .all();
  return reason ? rows.filter((row) => row.reason === reason).length : rows.length;
}

function countGenerationAudits(
  db: typeof import("../infrastructure/database.js").db,
  userId: string,
  status: "succeeded" | "partial" | "failed"
): number {
  return db
    .select({ id: generationAudits.id })
    .from(generationAudits)
    .where(and(eq(generationAudits.userId, userId), eq(generationAudits.status, status)))
    .all().length;
}

function providerResult(size: string): ProviderResult {
  return {
    model: "fake-image-model",
    size,
    images: [
      {
        b64Json: tinyPngBase64
      }
    ]
  };
}

function planFixture(id = "plan-smoke"): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id,
    title: "Agent executor smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "character_anchor",
        role: "character_anchor",
        prompt: "Create one reusable character anchor.",
        count: 1,
        references: [],
        status: "queued",
        outputs: [],
        visible: true
      },
      {
        id: "final_scene",
        role: "final_image",
        prompt: "Create one final scene with the generated character.",
        count: 1,
        references: [
          {
            kind: "generated_output",
            usage: "character",
            jobId: "character_anchor"
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [
      {
        fromJobId: "character_anchor",
        toJobId: "final_scene"
      }
    ],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function singleJobPlanFixture(id: string, count: number): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id,
    title: "Single job smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: `${id}-job`,
        role: "final_image",
        prompt: "Create a single smoke image.",
        count,
        references: [],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function selectedReferencePlanFixture(assetId: string): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "plan-selected-reference-smoke",
    title: "Selected reference smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "final_from_selected",
        role: "final_image",
        prompt: "Create one final image from the selected canvas reference.",
        count: 1,
        references: [
          {
            kind: "selected_canvas_image",
            usage: "style",
            assetId
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function multiSelectedReferencePlanFixture(): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "plan-multi-selected-reference-smoke",
    title: "Multiple selected reference smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "caption_selected_1",
        role: "final_image",
        prompt: "Edit selected canvas image one directly and add title typography.",
        count: 1,
        references: [
          {
            kind: "selected_canvas_image",
            usage: "scene",
            assetId: "local-only-reference"
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      },
      {
        id: "caption_selected_2",
        role: "final_image",
        prompt: "Edit selected canvas image two directly and add title typography.",
        count: 1,
        references: [
          {
            kind: "selected_canvas_image",
            usage: "scene",
            assetId: "local-only-reference-2"
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function arbitraryCountPlanFixture(): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "plan-arbitrary-count-smoke",
    title: "Arbitrary count smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "travel_vlog_batch",
        role: "final_image",
        prompt: "Create nine realistic travel vlog stills.",
        count: 9,
        references: [],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function clonePlan(plan: GenerationPlan): GenerationPlan {
  return {
    ...plan,
    defaults: {
      ...plan.defaults,
      size: { ...plan.defaults.size }
    },
    jobs: plan.jobs.map((job) => ({
      ...job,
      size: job.size ? { ...job.size } : undefined,
      references: job.references.map((reference) => ({ ...reference })),
      outputs: job.outputs.map((output) => ({
        ...output,
        asset: output.asset ? { ...output.asset } : undefined
      }))
    })),
    edges: plan.edges.map((edge) => ({ ...edge }))
  };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await main();
