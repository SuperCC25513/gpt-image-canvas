import { randomUUID } from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import type { UsableAgentLlmConfig } from "./agent-config.js";
import { createPlanningSkillFiles, createPlanningSystemPrompt } from "./agent-planning-skill.js";
import {
  GENERATION_COUNTS,
  GENERATION_PLAN_SCHEMA_VERSION,
  IMAGE_QUALITIES,
  MAX_GENERATION_JOB_REFERENCES,
  MAX_GENERATION_PLAN_IMAGES,
  MAX_REFERENCE_IMAGES,
  OUTPUT_FORMATS,
  STYLE_PRESETS,
  validateSceneImageSize,
  type AgentSelectedCanvasReference,
  type GenerationCount,
  type GenerationDependencyEdge,
  type GenerationJob,
  type GenerationJobRole,
  type GenerationJobStatus,
  type GenerationPlan,
  type GenerationPlanDefaults,
  type GenerationPlanValidationCode,
  type GenerationPlanValidationIssue,
  type GenerationPlanValidationResult,
  type GenerationReference,
  type GenerationReferenceKind,
  type GenerationReferenceUsage,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type StylePresetId
} from "./contracts.js";

const DEFAULT_PLAN_SIZE: ImageSize = { width: 1024, height: 1024 };
const DEFAULT_PLAN_QUALITY: ImageQuality = "auto";
const DEFAULT_PLAN_OUTPUT_FORMAT: OutputFormat = "png";
const DEFAULT_PLAN_COUNT: GenerationCount = 1;

const GENERATION_JOB_ROLES: readonly GenerationJobRole[] = [
  "final_image",
  "variation",
  "character_anchor",
  "style_anchor",
  "reference_anchor"
];
const GENERATION_JOB_STATUSES: readonly GenerationJobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled"
];
const GENERATION_REFERENCE_KINDS: readonly GenerationReferenceKind[] = ["selected_canvas_image", "generated_output"];
const GENERATION_REFERENCE_USAGES: readonly GenerationReferenceUsage[] = [
  "subject",
  "character",
  "style",
  "composition",
  "scene",
  "product",
  "other"
];

type PlannerMessageContent =
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    >;

interface PlannerMessage {
  role: "user";
  content: PlannerMessageContent;
}

export interface GenerationPlanAgentRunner {
  invoke(
    input: {
      messages: PlannerMessage[];
      files?: Record<string, unknown>;
    },
    options?: {
      configurable?: {
        thread_id: string;
      };
      recursionLimit?: number;
      signal?: AbortSignal;
    }
  ): Promise<unknown>;
}

export interface AgentPlannerInput {
  userText: string;
  defaults?: unknown;
  selectedReferences?: unknown;
  llmConfig: UsableAgentLlmConfig;
  signal?: AbortSignal;
  now?: Date;
  runner?: GenerationPlanAgentRunner;
}

export type AgentPlannerResult =
  | {
      ok: true;
      plan: GenerationPlan;
    }
  | {
      ok: false;
      code: string;
      message: string;
      issues?: GenerationPlanValidationIssue[];
    };

type AgentPlannerFailure = Extract<AgentPlannerResult, { ok: false }>;
type GenerationPlanDefaultsParseResult =
  | AgentPlannerFailure
  | {
      ok: true;
      defaults: GenerationPlanDefaults;
    };
type SelectedReferencesParseResult =
  | AgentPlannerFailure
  | {
      ok: true;
      references: AgentSelectedCanvasReference[];
    };

export interface GenerationPlanValidationContext {
  defaults: GenerationPlanDefaults;
  selectedReferences?: AgentSelectedCanvasReference[];
  now?: Date;
  planId?: string;
}

export async function createGenerationPlan(input: AgentPlannerInput): Promise<AgentPlannerResult> {
  const userText = typeof input.userText === "string" ? input.userText.trim() : "";
  if (!userText) {
    return {
      ok: false,
      code: "invalid_agent_request",
      message: "Agent planning requires non-empty user text."
    };
  }

  const defaultsResult = parseGenerationPlanDefaults(input.defaults);
  if (!defaultsResult.ok) {
    return defaultsResult;
  }

  const selectedReferencesResult = parseSelectedCanvasReferences(input.selectedReferences);
  if (!selectedReferencesResult.ok) {
    return selectedReferencesResult;
  }

  const selectedReferences = selectedReferencesResult.references;
  const runner = input.runner ?? createDeepAgentsPlanner(input.llmConfig);
  const now = input.now ?? new Date();
  const message = buildPlannerUserMessage({
    userText,
    defaults: defaultsResult.defaults,
    selectedReferences,
    supportsVision: input.llmConfig.supportsVision
  });

  let agentResult: unknown;
  try {
    agentResult = await runner.invoke(
      {
        messages: [message],
        files: createPlanningSkillFiles(now)
      },
      {
        configurable: {
          thread_id: `agent-plan-${randomUUID()}`
        },
        recursionLimit: 30,
        signal: input.signal
      }
    );
  } catch {
    if (input.signal?.aborted) {
      return {
        ok: false,
        code: "agent_run_cancelled",
        message: "Agent planning was cancelled."
      };
    }

    return {
      ok: false,
      code: "agent_planner_failed",
      message: "Agent planner request failed."
    };
  }

  const modelText = extractTextFromAgentResult(agentResult);
  if (!modelText) {
    return {
      ok: false,
      code: "invalid_plan_json",
      message: "Agent returned no GenerationPlan JSON."
    };
  }

  const validated = parseGenerationPlanModelOutput(modelText, {
    defaults: defaultsResult.defaults,
    selectedReferences,
    now
  });

  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code,
      message: validated.message,
      issues: validated.issues
    };
  }

  return {
    ok: true,
    plan: validated.plan
  };
}

export function createDeepAgentsPlanner(config: UsableAgentLlmConfig): GenerationPlanAgentRunner {
  const model = new ChatOpenAI({
    apiKey: config.apiKey,
    configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
    maxRetries: 1,
    model: config.model,
    temperature: 0,
    timeout: config.timeoutMs
  });

  return createDeepAgent({
    model,
    skills: ["/skills/"],
    systemPrompt: createPlanningSystemPrompt(),
    tools: []
  }) as unknown as GenerationPlanAgentRunner;
}

export function parseGenerationPlanDefaults(input: unknown): GenerationPlanDefaultsParseResult {
  if (input === undefined || input === null) {
    return {
      ok: true,
      defaults: {
        size: DEFAULT_PLAN_SIZE,
        quality: DEFAULT_PLAN_QUALITY,
        outputFormat: DEFAULT_PLAN_OUTPUT_FORMAT,
        count: DEFAULT_PLAN_COUNT
      }
    };
  }

  if (!isRecord(input)) {
    return {
      ok: false,
      code: "invalid_plan_defaults",
      message: "Agent defaults must be a JSON object."
    };
  }

  const size = parseOptionalImageSize(input.size) ?? DEFAULT_PLAN_SIZE;
  const sizeValidation = validateSceneImageSize({ size });
  if (!sizeValidation.ok) {
    return {
      ok: false,
      code: "invalid_plan_defaults",
      message: sizeValidation.message
    };
  }

  const quality = parseQuality(input.quality) ?? DEFAULT_PLAN_QUALITY;
  const outputFormat = parseOutputFormat(input.outputFormat) ?? DEFAULT_PLAN_OUTPUT_FORMAT;
  const count = parseGenerationCount(input.count) ?? DEFAULT_PLAN_COUNT;
  const stylePresetId = parseStylePresetId(input.stylePresetId);

  return {
    ok: true,
    defaults: {
      size: sizeValidation.size,
      quality,
      outputFormat,
      count,
      stylePresetId
    }
  };
}

export function parseSelectedCanvasReferences(
  input: unknown
): SelectedReferencesParseResult {
  if (input === undefined || input === null) {
    return {
      ok: true,
      references: []
    };
  }

  if (!Array.isArray(input)) {
    return {
      ok: false,
      code: "invalid_selected_references",
      message: "Selected canvas references must be an array."
    };
  }

  if (input.length > MAX_REFERENCE_IMAGES) {
    return {
      ok: false,
      code: "too_many_selected_references",
      message: `Select at most ${MAX_REFERENCE_IMAGES} canvas references for Agent planning.`
    };
  }

  const references: AgentSelectedCanvasReference[] = [];
  for (const [index, rawReference] of input.entries()) {
    if (!isRecord(rawReference)) {
      return {
        ok: false,
        code: "invalid_selected_references",
        message: `Selected reference at index ${index} must be an object.`
      };
    }

    const id = stringValue(rawReference.id);
    const assetId = stringValue(rawReference.assetId);
    if (!id || !assetId) {
      return {
        ok: false,
        code: "invalid_selected_references",
        message: `Selected reference at index ${index} must include id and assetId.`
      };
    }

    references.push({
      id,
      assetId,
      label: stringValue(rawReference.label),
      width: positiveIntegerValue(rawReference.width),
      height: positiveIntegerValue(rawReference.height),
      mimeType: stringValue(rawReference.mimeType),
      dataUrl: stringValue(rawReference.dataUrl)
    });
  }

  return {
    ok: true,
    references
  };
}

export function buildPlannerUserMessage(input: {
  userText: string;
  defaults: GenerationPlanDefaults;
  selectedReferences: AgentSelectedCanvasReference[];
  supportsVision: boolean;
}): PlannerMessage {
  const referenceSummaries = input.selectedReferences.map((reference, index) =>
    formatReferenceSummary(reference, index, input.supportsVision)
  );
  const text = [
    `User request:\n${input.userText.trim()}`,
    `Current Agent defaults:\n${JSON.stringify(input.defaults)}`,
    `supportsVision: ${input.supportsVision ? "true" : "false"}`,
    referenceSummaries.length > 0
      ? `Selected canvas references, capped at ${MAX_REFERENCE_IMAGES}:\n${referenceSummaries.join("\n")}`
      : "Selected canvas references: none",
    input.supportsVision
      ? "Vision mode: image data may be attached below when dataUrl is available."
      : "No-vision mode: selected images are reference handles only. Do not claim visual inspection or describe unseen image contents.",
    "Return only strict GenerationPlan JSON."
  ].join("\n\n");

  const imageBlocks = input.supportsVision
    ? input.selectedReferences
        .filter((reference) => typeof reference.dataUrl === "string" && reference.dataUrl.trim().length > 0)
        .map((reference) => ({
          type: "image_url" as const,
          image_url: {
            url: reference.dataUrl as string
          }
        }))
    : [];

  if (imageBlocks.length === 0) {
    return {
      role: "user",
      content: text
    };
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text
      },
      ...imageBlocks
    ]
  };
}

export function parseGenerationPlanModelOutput(
  outputText: string,
  context: GenerationPlanValidationContext
): GenerationPlanValidationResult {
  const parsed = parseStrictJsonObject(outputText);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "invalid_plan_json",
      message: parsed.message,
      issues: [
        {
          code: "invalid_plan_json",
          message: parsed.message
        }
      ]
    };
  }

  return validateGenerationPlan(parsed.value, context);
}

export function validateGenerationPlan(
  input: unknown,
  context: GenerationPlanValidationContext
): GenerationPlanValidationResult {
  const issues: GenerationPlanValidationIssue[] = [];
  const now = (context.now ?? new Date()).toISOString();

  if (!isRecord(input)) {
    return invalidPlan("invalid_plan_schema", "GenerationPlan must be a JSON object.");
  }

  if (input.schemaVersion !== GENERATION_PLAN_SCHEMA_VERSION) {
    issues.push(issue("invalid_plan_schema", `schemaVersion must be ${GENERATION_PLAN_SCHEMA_VERSION}.`, "schemaVersion"));
  }

  const title = stringValue(input.title);
  if (!title) {
    issues.push(issue("invalid_plan_schema", "Plan title is required.", "title"));
  }

  if (input.status !== "awaiting_confirmation") {
    issues.push(
      issue(
        "invalid_plan_schema",
        'Plan status must be "awaiting_confirmation" before user confirmation.',
        "status"
      )
    );
  }

  if (input.createdBy !== "agent") {
    issues.push(issue("invalid_plan_schema", 'createdBy must be "agent".', "createdBy"));
  }

  const defaults = parsePlanDefaultsFromPlan(input.defaults, context.defaults, issues);
  const jobs = parsePlanJobs(input.jobs, defaults, context, issues);
  const edges = parsePlanEdges(input.edges, issues);

  if (issues.length === 0) {
    validatePlanGraph(jobs, edges, context.selectedReferences ?? [], issues);
  }

  if (issues.length > 0) {
    return invalidPlan(issues[0]?.code ?? "invalid_plan_schema", issues[0]?.message ?? "Invalid GenerationPlan.", issues);
  }

  const plan: GenerationPlan = {
    schemaVersion: GENERATION_PLAN_SCHEMA_VERSION,
    id: context.planId ?? stringValue(input.id) ?? `plan-${randomUUID()}`,
    title: title ?? "Untitled plan",
    status: "awaiting_confirmation",
    defaults,
    jobs,
    edges,
    createdBy: "agent",
    createdAt: isoStringValue(input.createdAt) ?? now,
    updatedAt: now
  };

  return {
    ok: true,
    plan
  };
}

export function extractTextFromAgentResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    return nonEmptyString(result);
  }

  if (!isRecord(result)) {
    return undefined;
  }

  const directOutput = contentToText(result.output) ?? contentToText(result.structuredResponse);
  if (directOutput) {
    return directOutput;
  }

  if (Array.isArray(result.messages)) {
    for (let index = result.messages.length - 1; index >= 0; index -= 1) {
      const message = result.messages[index];
      if (!isRecord(message)) {
        continue;
      }
      const text = contentToText(message.content);
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function parsePlanDefaultsFromPlan(
  input: unknown,
  fallback: GenerationPlanDefaults,
  issues: GenerationPlanValidationIssue[]
): GenerationPlanDefaults {
  if (input === undefined || input === null) {
    return fallback;
  }

  if (!isRecord(input)) {
    issues.push(issue("invalid_plan_defaults", "Plan defaults must be an object.", "defaults"));
    return fallback;
  }

  const size = parseOptionalImageSize(input.size) ?? fallback.size;
  const sizeValidation = validateSceneImageSize({ size });
  if (!sizeValidation.ok) {
    issues.push(issue("invalid_plan_defaults", sizeValidation.message, "defaults.size"));
  }

  const quality = parseQuality(input.quality);
  if (input.quality !== undefined && !quality) {
    issues.push(issue("invalid_plan_defaults", "Plan default quality is unsupported.", "defaults.quality"));
  }

  const outputFormat = parseOutputFormat(input.outputFormat);
  if (input.outputFormat !== undefined && !outputFormat) {
    issues.push(issue("invalid_plan_defaults", "Plan default outputFormat is unsupported.", "defaults.outputFormat"));
  }

  const count = parseGenerationCount(input.count);
  if (input.count !== undefined && !count) {
    issues.push(issue("invalid_plan_defaults", "Plan default count is unsupported.", "defaults.count"));
  }

  const stylePresetId = parseStylePresetId(input.stylePresetId);
  if (input.stylePresetId !== undefined && !stylePresetId) {
    issues.push(issue("invalid_plan_defaults", "Plan default stylePresetId is unsupported.", "defaults.stylePresetId"));
  }

  return {
    size: sizeValidation.ok ? sizeValidation.size : fallback.size,
    quality: quality ?? fallback.quality,
    outputFormat: outputFormat ?? fallback.outputFormat,
    count: count ?? fallback.count,
    stylePresetId: stylePresetId ?? fallback.stylePresetId
  };
}

function parsePlanJobs(
  input: unknown,
  defaults: GenerationPlanDefaults,
  context: GenerationPlanValidationContext,
  issues: GenerationPlanValidationIssue[]
): GenerationJob[] {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push(issue("invalid_plan_job", "GenerationPlan must include at least one job.", "jobs"));
    return [];
  }

  const jobs: GenerationJob[] = [];
  const seenJobIds = new Set<string>();
  for (const [index, rawJob] of input.entries()) {
    const path = `jobs.${index}`;
    if (!isRecord(rawJob)) {
      issues.push(issue("invalid_plan_job", "GenerationJob must be an object.", path));
      continue;
    }

    const id = stringValue(rawJob.id);
    if (!id) {
      issues.push(issue("invalid_plan_job", "GenerationJob id is required.", `${path}.id`));
      continue;
    }
    if (seenJobIds.has(id)) {
      issues.push(issue("invalid_plan_job", `Duplicate GenerationJob id "${id}".`, `${path}.id`));
      continue;
    }
    seenJobIds.add(id);

    const role = parseJobRole(rawJob.role);
    if (!role) {
      issues.push(issue("invalid_plan_job", "GenerationJob role is unsupported.", `${path}.role`));
    }

    const prompt = stringValue(rawJob.prompt);
    if (!prompt) {
      issues.push(issue("invalid_plan_job", "GenerationJob prompt is required.", `${path}.prompt`));
    }

    const count = parseGenerationCount(rawJob.count ?? defaults.count);
    if (!count) {
      issues.push(issue("invalid_plan_job", "GenerationJob count must be one of 1, 2, 4, 8, or 16.", `${path}.count`));
    }

    const status = rawJob.status === undefined ? "queued" : parseJobStatus(rawJob.status);
    if (!status || status !== "queued") {
      issues.push(issue("invalid_plan_job", 'GenerationJob status must be "queued" before execution.', `${path}.status`));
    }

    const size = rawJob.size === undefined ? undefined : parseOptionalImageSize(rawJob.size);
    if (rawJob.size !== undefined && !size) {
      issues.push(issue("invalid_plan_job", "GenerationJob size is invalid.", `${path}.size`));
    }
    const resolvedSize = size ?? defaults.size;
    const sizeValidation = validateSceneImageSize({ size: resolvedSize });
    if (!sizeValidation.ok) {
      issues.push(issue("invalid_plan_job", sizeValidation.message, `${path}.size`));
    }

    const quality = rawJob.quality === undefined ? undefined : parseQuality(rawJob.quality);
    if (rawJob.quality !== undefined && !quality) {
      issues.push(issue("invalid_plan_job", "GenerationJob quality is unsupported.", `${path}.quality`));
    }

    const outputFormat = rawJob.outputFormat === undefined ? undefined : parseOutputFormat(rawJob.outputFormat);
    if (rawJob.outputFormat !== undefined && !outputFormat) {
      issues.push(issue("invalid_plan_job", "GenerationJob outputFormat is unsupported.", `${path}.outputFormat`));
    }

    const references = parseJobReferences(rawJob.references, `${path}.references`, issues);
    const visible = rawJob.visible === undefined ? true : rawJob.visible === true;
    if (rawJob.visible !== undefined && typeof rawJob.visible !== "boolean") {
      issues.push(issue("invalid_plan_job", "GenerationJob visible must be boolean.", `${path}.visible`));
    }
    if (role && role.endsWith("_anchor") && !visible) {
      issues.push(issue("invalid_plan_job", "Generated anchor jobs must be visible.", `${path}.visible`));
    }

    if (rawJob.outputs !== undefined && (!Array.isArray(rawJob.outputs) || rawJob.outputs.length > 0)) {
      issues.push(issue("invalid_plan_job", "GenerationJob outputs must be empty before execution.", `${path}.outputs`));
    }

    jobs.push({
      id,
      role: role ?? "final_image",
      prompt: prompt ?? "",
      count: count ?? 1,
      size: sizeValidation.ok && size ? sizeValidation.size : undefined,
      quality,
      outputFormat,
      references,
      status: "queued",
      outputs: [],
      visible,
      error: stringValue(rawJob.error)
    });
  }

  const totalImageCount = jobs.reduce((total, job) => total + job.count, 0);
  if (totalImageCount > MAX_GENERATION_PLAN_IMAGES) {
    issues.push(
      issue(
        "generation_plan_limit_exceeded",
        `GenerationPlan requests ${totalImageCount} images; the cap is ${MAX_GENERATION_PLAN_IMAGES}.`,
        "jobs"
      )
    );
  }

  for (const [index, job] of jobs.entries()) {
    if (job.references.length > MAX_GENERATION_JOB_REFERENCES) {
      issues.push(
        issue(
          "generation_job_reference_limit_exceeded",
          `GenerationJob "${job.id}" uses ${job.references.length} references; the cap is ${MAX_GENERATION_JOB_REFERENCES}.`,
          `jobs.${index}.references`
        )
      );
    }
  }

  for (const [index, job] of jobs.entries()) {
    if (job.role === "character_anchor" && job.count !== 1) {
      issues.push(
        issue("invalid_dependency_source_count", "Character anchor jobs must generate exactly one visible image.", `jobs.${index}.count`)
      );
    }
  }

  return jobs;
}

function parseJobReferences(
  input: unknown,
  path: string,
  issues: GenerationPlanValidationIssue[]
): GenerationReference[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    issues.push(issue("invalid_plan_reference", "GenerationJob references must be an array.", path));
    return [];
  }

  const references: GenerationReference[] = [];
  for (const [index, rawReference] of input.entries()) {
    const referencePath = `${path}.${index}`;
    if (!isRecord(rawReference)) {
      issues.push(issue("invalid_plan_reference", "GenerationReference must be an object.", referencePath));
      continue;
    }

    const kind = parseReferenceKind(rawReference.kind);
    if (!kind) {
      issues.push(issue("invalid_plan_reference", "GenerationReference kind is unsupported.", `${referencePath}.kind`));
    }

    const usage = parseReferenceUsage(rawReference.usage) ?? "other";
    if (rawReference.usage !== undefined && !parseReferenceUsage(rawReference.usage)) {
      issues.push(issue("invalid_plan_reference", "GenerationReference usage is unsupported.", `${referencePath}.usage`));
    }

    references.push({
      kind: kind ?? "selected_canvas_image",
      usage,
      assetId: stringValue(rawReference.assetId),
      jobId: stringValue(rawReference.jobId),
      outputId: stringValue(rawReference.outputId),
      label: stringValue(rawReference.label)
    });
  }

  return references;
}

function parsePlanEdges(input: unknown, issues: GenerationPlanValidationIssue[]): GenerationDependencyEdge[] {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    issues.push(issue("invalid_plan_edge", "GenerationPlan edges must be an array.", "edges"));
    return [];
  }

  const edges: GenerationDependencyEdge[] = [];
  const seenEdges = new Set<string>();
  for (const [index, rawEdge] of input.entries()) {
    const path = `edges.${index}`;
    if (!isRecord(rawEdge)) {
      issues.push(issue("invalid_plan_edge", "GenerationDependencyEdge must be an object.", path));
      continue;
    }

    const fromJobId = stringValue(rawEdge.fromJobId);
    const toJobId = stringValue(rawEdge.toJobId);
    if (!fromJobId || !toJobId) {
      issues.push(issue("invalid_plan_edge", "Dependency edge requires fromJobId and toJobId.", path));
      continue;
    }
    if (fromJobId === toJobId) {
      issues.push(issue("generation_dependency_cycle", "Dependency edge cannot point to the same job.", path));
      continue;
    }

    const edgeKey = `${fromJobId}->${toJobId}`;
    if (seenEdges.has(edgeKey)) {
      continue;
    }
    seenEdges.add(edgeKey);
    edges.push({ fromJobId, toJobId });
  }

  return edges;
}

function validatePlanGraph(
  jobs: GenerationJob[],
  edges: GenerationDependencyEdge[],
  selectedReferences: AgentSelectedCanvasReference[],
  issues: GenerationPlanValidationIssue[]
): void {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const selectedReferenceKeys = new Set<string>();
  for (const reference of selectedReferences) {
    selectedReferenceKeys.add(reference.id);
    selectedReferenceKeys.add(reference.assetId);
  }

  const downstreamSourceJobIds = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    if (!jobsById.has(edge.fromJobId)) {
      issues.push(
        issue("unknown_generation_job_reference", `Dependency source job "${edge.fromJobId}" does not exist.`, `edges.${index}.fromJobId`)
      );
    }
    if (!jobsById.has(edge.toJobId)) {
      issues.push(
        issue("unknown_generation_job_reference", `Dependency target job "${edge.toJobId}" does not exist.`, `edges.${index}.toJobId`)
      );
    }
    downstreamSourceJobIds.add(edge.fromJobId);
  }

  for (const [jobIndex, job] of jobs.entries()) {
    for (const [referenceIndex, reference] of job.references.entries()) {
      const path = `jobs.${jobIndex}.references.${referenceIndex}`;
      if (reference.kind === "selected_canvas_image") {
        const selectedKey = reference.assetId;
        if (!selectedKey || !selectedReferenceKeys.has(selectedKey)) {
          issues.push(
            issue(
              "unknown_generation_job_reference",
              "selected_canvas_image reference must use one of the selected canvas reference handles.",
              path
            )
          );
        }
        continue;
      }

      const sourceJobId = reference.jobId;
      if (!sourceJobId || !jobsById.has(sourceJobId)) {
        issues.push(
          issue("unknown_generation_job_reference", "generated_output reference must point to a known source job.", path)
        );
        continue;
      }

      downstreamSourceJobIds.add(sourceJobId);
      if (!edges.some((edge) => edge.fromJobId === sourceJobId && edge.toJobId === job.id)) {
        issues.push(
          issue(
            "invalid_plan_edge",
            "generated_output references must include a matching dependency edge.",
            path
          )
        );
      }
    }
  }

  for (const sourceJobId of downstreamSourceJobIds) {
    const sourceJob = jobsById.get(sourceJobId);
    if (sourceJob && sourceJob.count !== 1) {
      issues.push(
        issue(
          "invalid_dependency_source_count",
          `Dependency source job "${sourceJobId}" must have count exactly 1.`,
          `jobs.${jobs.indexOf(sourceJob)}.count`
        )
      );
    }
  }

  if (hasDependencyCycle(jobs, edges)) {
    issues.push(issue("generation_dependency_cycle", "GenerationPlan dependencies must not contain a cycle.", "edges"));
  }
}

function hasDependencyCycle(jobs: GenerationJob[], edges: GenerationDependencyEdge[]): boolean {
  const graph = new Map<string, string[]>();
  for (const job of jobs) {
    graph.set(job.id, []);
  }
  for (const edge of edges) {
    graph.get(edge.fromJobId)?.push(edge.toJobId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (jobId: string): boolean => {
    if (visiting.has(jobId)) {
      return true;
    }
    if (visited.has(jobId)) {
      return false;
    }
    visiting.add(jobId);
    for (const downstreamJobId of graph.get(jobId) ?? []) {
      if (visit(downstreamJobId)) {
        return true;
      }
    }
    visiting.delete(jobId);
    visited.add(jobId);
    return false;
  };

  return jobs.some((job) => visit(job.id));
}

function formatReferenceSummary(
  reference: AgentSelectedCanvasReference,
  index: number,
  supportsVision: boolean
): string {
  const size = reference.width && reference.height ? `${reference.width}x${reference.height}` : "unknown-size";
  const label = reference.label ? ` label="${truncate(reference.label, 120)}"` : "";
  const mimeType = reference.mimeType ? ` mimeType="${truncate(reference.mimeType, 80)}"` : "";
  const vision = supportsVision && reference.dataUrl ? "visionAttachment=provided" : "visionAttachment=not_provided";

  return `- ref${index + 1}: id="${reference.id}" assetId="${reference.assetId}" size=${size}${label}${mimeType} ${vision}`;
}

function parseStrictJsonObject(input: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return {
      ok: false,
      message: "Agent output must be a single JSON object with no markdown or extra text."
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed) as unknown
    };
  } catch {
    return {
      ok: false,
      message: "Agent output was not valid JSON."
    };
  }
}

function invalidPlan(
  code: GenerationPlanValidationCode,
  message: string,
  issues?: GenerationPlanValidationIssue[]
): GenerationPlanValidationResult {
  return {
    ok: false,
    code,
    message,
    issues: issues ?? [issue(code, message)]
  };
}

function issue(
  code: GenerationPlanValidationCode,
  message: string,
  path?: string
): GenerationPlanValidationIssue {
  return {
    code,
    message,
    path
  };
}

function parseOptionalImageSize(value: unknown): ImageSize | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const width = positiveIntegerValue(value.width);
  const height = positiveIntegerValue(value.height);
  return width && height ? { width, height } : undefined;
}

function parseQuality(value: unknown): ImageQuality | undefined {
  return typeof value === "string" && IMAGE_QUALITIES.includes(value as ImageQuality)
    ? (value as ImageQuality)
    : undefined;
}

function parseOutputFormat(value: unknown): OutputFormat | undefined {
  return typeof value === "string" && OUTPUT_FORMATS.includes(value as OutputFormat)
    ? (value as OutputFormat)
    : undefined;
}

function parseGenerationCount(value: unknown): GenerationCount | undefined {
  return typeof value === "number" && GENERATION_COUNTS.includes(value as GenerationCount)
    ? (value as GenerationCount)
    : undefined;
}

function parseStylePresetId(value: unknown): StylePresetId | undefined {
  return typeof value === "string" && STYLE_PRESETS.some((preset) => preset.id === value)
    ? (value as StylePresetId)
    : undefined;
}

function parseJobRole(value: unknown): GenerationJobRole | undefined {
  return typeof value === "string" && GENERATION_JOB_ROLES.includes(value as GenerationJobRole)
    ? (value as GenerationJobRole)
    : undefined;
}

function parseJobStatus(value: unknown): GenerationJobStatus | undefined {
  return typeof value === "string" && GENERATION_JOB_STATUSES.includes(value as GenerationJobStatus)
    ? (value as GenerationJobStatus)
    : undefined;
}

function parseReferenceKind(value: unknown): GenerationReferenceKind | undefined {
  return typeof value === "string" && GENERATION_REFERENCE_KINDS.includes(value as GenerationReferenceKind)
    ? (value as GenerationReferenceKind)
    : undefined;
}

function parseReferenceUsage(value: unknown): GenerationReferenceUsage | undefined {
  return typeof value === "string" && GENERATION_REFERENCE_USAGES.includes(value as GenerationReferenceUsage)
    ? (value as GenerationReferenceUsage)
    : undefined;
}

function contentToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return nonEmptyString(value);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (isRecord(item) && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n")
      .trim();
    return nonEmptyString(text);
  }

  return undefined;
}

function nonEmptyString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoStringValue(value: unknown): string | undefined {
  const string = stringValue(value);
  if (!string) {
    return undefined;
  }

  const timestamp = Date.parse(string);
  return Number.isFinite(timestamp) ? string : undefined;
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
