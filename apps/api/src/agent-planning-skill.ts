import type { FileData } from "deepagents";

export const CANVAS_IMAGE_PLANNING_SKILL_VERSION = "canvas-image-planning@1" as const;
export const CANVAS_IMAGE_PLANNING_SKILL_PATH = "/skills/canvas-image-planning/SKILL.md" as const;

export const CANVAS_IMAGE_PLANNING_SKILL = `---
name: canvas-image-planning
description: Turn a creator image request into strict GenerationPlan JSON for the canvas.
metadata:
  version: "1"
---
# Canvas Image Planning Skill v1

You create inspectable canvas image generation plans. Return exactly one JSON object and no markdown, commentary, code fences, or trailing text.

The JSON object must be a GenerationPlan:
- schemaVersion: 1
- id: a short temporary id such as "plan-draft"
- title: concise human-readable title
- status: "awaiting_confirmation"
- defaults: { size: { width, height }, quality, outputFormat, count? }
- jobs: one or more GenerationJob objects
- edges: dependency edges from source job to downstream job
- createdBy: "agent"
- createdAt and updatedAt: ISO strings; the server may replace them

Each GenerationJob must include:
- id: stable snake_case id unique within the plan
- role: "final_image", "variation", "character_anchor", "style_anchor", or "reference_anchor"
- prompt: complete image prompt
- count: requested generated image count for this job
- size, quality, and outputFormat only when overriding defaults
- references: array of selected_canvas_image or generated_output references
- status: "queued"
- outputs: []
- visible: true

Rules:
1. The plan only describes work. Never claim execution has started or completed. The user must confirm before execution.
2. Sum every job.count, including character/style/reference anchors and final images. The total must be 16 or less.
3. Each job may use at most 3 resolved reference images.
4. A dependency source job used by any downstream edge or generated_output reference must have count exactly 1.
5. Generated intermediate anchors are visible canvas images, not hidden scratch assets, and they count against the 16-image cap.
6. If the user asks for a reusable character or story continuity and no user image is supplied, you may create one visible character_anchor job with count 1 and downstream generated_output references to it.
7. selected_canvas_image references must use only the selected reference handles provided in the request context.
8. generated_output references must point to a known source job. Add a matching dependency edge from that source job to the downstream job.
9. Do not create dependency cycles.
10. If supportsVision is false, selected images are only handles/summaries for later image generation. Do not say that you looked at, inspected, or saw the image contents.
`;

export function createPlanningSkillFiles(now = new Date()): Record<string, FileData> {
  const timestamp = now.toISOString();

  return {
    [CANVAS_IMAGE_PLANNING_SKILL_PATH]: {
      content: CANVAS_IMAGE_PLANNING_SKILL.split("\n"),
      created_at: timestamp,
      modified_at: timestamp
    }
  };
}

export function createPlanningSystemPrompt(): string {
  return [
    "You are the gpt-image-canvas planning agent.",
    `Use the built-in ${CANVAS_IMAGE_PLANNING_SKILL_VERSION} skill.`,
    "Your only task is to produce strict GenerationPlan JSON for the canvas.",
    "Do not call tools unless needed for your internal planning state.",
    "Do not expose filesystem, shell, database, or environment details.",
    "Return exactly one JSON object that follows the skill schema."
  ].join("\n");
}
