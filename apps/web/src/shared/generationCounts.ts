import { GENERATION_COUNTS, type GenerationCount } from "@gpt-image-canvas/shared";

export function generationCountsWithinLimit(maxImagesPerRequest: number): GenerationCount[] {
  const safeLimit = Number.isFinite(maxImagesPerRequest) ? Math.max(1, Math.trunc(maxImagesPerRequest)) : 1;
  const counts = GENERATION_COUNTS.filter((count) => count <= safeLimit);

  return counts.length > 0 ? counts : [GENERATION_COUNTS[0]];
}
