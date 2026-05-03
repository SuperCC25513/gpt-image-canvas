import {
  buildPlannerUserMessage,
  parseGenerationPlanModelOutput,
  validateGenerationPlan
} from "./agent-planner.js";
import type {
  AgentSelectedCanvasReference,
  GenerationPlanDefaults,
  GenerationPlanValidationResult
} from "./contracts.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const defaults: GenerationPlanDefaults = {
  size: {
    width: 1024,
    height: 1024
  },
  quality: "auto",
  outputFormat: "png",
  count: 1
};
const selectedReferences: AgentSelectedCanvasReference[] = [
  {
    id: "shape-ref-1",
    assetId: "asset-ref-1",
    label: "Selected product image",
    width: 1024,
    height: 1024,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AAAA"
  }
];

function main(): void {
  smokeValidSimplePlan();
  smokeMultiPromptPlan();
  smokeSelectedReferencePlan();
  smokeGeneratedAnchorDependencyPlan();
  smokeOverLimitPlanRejection();
  smokeCyclePlanRejection();
  smokeInvalidJsonRejection();
  smokeNoVisionReferenceHandling();

  console.log("agent planner smoke checks passed");
}

function smokeValidSimplePlan(): void {
  const result = validate(planFixture(), []);
  expectOk(result, "valid simple plan");
  expect(result.plan.jobs.length === 1, "simple plan has one job");
  expect(result.plan.jobs[0]?.count === 1, "simple plan count is one");
}

function smokeMultiPromptPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({ id: "hero_square", prompt: "Create a square hero product render.", count: 2 }),
        jobFixture({ id: "detail_square", prompt: "Create a close-up detail render.", count: 2 })
      ]
    }),
    []
  );
  expectOk(result, "multi-prompt plan");
  expect(result.plan.jobs.length === 2, "multi-prompt plan has two jobs");
}

function smokeSelectedReferencePlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          references: [
            {
              kind: "selected_canvas_image",
              usage: "product",
              assetId: "asset-ref-1"
            }
          ]
        })
      ]
    }),
    selectedReferences
  );
  expectOk(result, "selected-reference plan");
  expect(result.plan.jobs[0]?.references[0]?.assetId === "asset-ref-1", "selected reference is preserved");
}

function smokeGeneratedAnchorDependencyPlan(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "character_anchor",
          role: "character_anchor",
          prompt: "Create one visible character anchor for a young explorer.",
          count: 1
        }),
        jobFixture({
          id: "story_scene",
          prompt: "Create two story scenes using the character anchor.",
          count: 2,
          references: [
            {
              kind: "generated_output",
              usage: "character",
              jobId: "character_anchor"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "character_anchor",
          toJobId: "story_scene"
        }
      ]
    }),
    []
  );
  expectOk(result, "generated-anchor dependency plan");
  expect(result.plan.edges.length === 1, "anchor plan has dependency edge");
}

function smokeOverLimitPlanRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({ id: "batch_a", count: 16 }),
        jobFixture({ id: "batch_b", count: 1 })
      ]
    }),
    []
  );
  expect(!result.ok, "over-limit plan is rejected");
  expect(result.code === "generation_plan_limit_exceeded", "over-limit rejection code is stable");
}

function smokeCyclePlanRejection(): void {
  const result = validate(
    planFixture({
      jobs: [
        jobFixture({
          id: "source_a",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "source_b"
            }
          ]
        }),
        jobFixture({
          id: "source_b",
          references: [
            {
              kind: "generated_output",
              usage: "style",
              jobId: "source_a"
            }
          ]
        })
      ],
      edges: [
        {
          fromJobId: "source_a",
          toJobId: "source_b"
        },
        {
          fromJobId: "source_b",
          toJobId: "source_a"
        }
      ]
    }),
    []
  );
  expect(!result.ok, "cycle plan is rejected");
  expect(result.code === "generation_dependency_cycle", "cycle rejection code is stable");
}

function smokeInvalidJsonRejection(): void {
  const result = parseGenerationPlanModelOutput("Here is the plan: {}", {
    defaults,
    selectedReferences: [],
    now
  });
  expect(!result.ok, "non-JSON model output is rejected");
  expect(result.code === "invalid_plan_json", "non-JSON rejection code is stable");
}

function smokeNoVisionReferenceHandling(): void {
  const message = buildPlannerUserMessage({
    userText: "Use my selected image as a product reference.",
    defaults,
    selectedReferences,
    supportsVision: false
  });

  expect(typeof message.content === "string", "no-vision planner message is text-only");
  expect(!message.content.includes("data:image"), "no-vision planner message does not include image data");
  expect(message.content.includes("Do not claim visual inspection"), "no-vision message includes inspection warning");
}

function validate(plan: Record<string, unknown>, references: AgentSelectedCanvasReference[]): GenerationPlanValidationResult {
  return validateGenerationPlan(plan, {
    defaults,
    selectedReferences: references,
    now,
    planId: "plan-test"
  });
}

function planFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "plan-draft",
    title: "Smoke plan",
    status: "awaiting_confirmation",
    defaults,
    jobs: [jobFixture()],
    edges: [],
    createdBy: "agent",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides
  };
}

function jobFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "final_image",
    role: "final_image",
    prompt: "Create one polished image.",
    count: 1,
    references: [],
    status: "queued",
    outputs: [],
    visible: true,
    ...overrides
  };
}

function expectOk(
  result: GenerationPlanValidationResult,
  label: string
): asserts result is Extract<GenerationPlanValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed validation: ${result.message}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main();
