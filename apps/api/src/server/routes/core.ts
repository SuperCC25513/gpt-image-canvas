import type { Hono } from "hono";
import { GENERATION_COUNTS, IMAGE_QUALITIES, OUTPUT_FORMATS, SIZE_PRESETS, STYLE_PRESETS, type AppConfig } from "../../domain/contracts.js";
import { getConfiguredImageModel } from "../../infrastructure/providers/image-provider.js";
import { checkRedisHealth } from "../../infrastructure/redis-runtime.js";

export function registerCoreRoutes(app: Hono): void {
  app.get("/api/health", async (c) => {
    const redis = await checkRedisHealth();
    const status = redis === "unavailable" ? "unhealthy" : "ok";
    return c.json(
      {
        status,
        checks: {
          redis
        }
      },
      status === "ok" ? 200 : 503
    );
  });

  app.get("/api/config", (c) => {
    const configuredModel = getConfiguredImageModel();
    const config: AppConfig = {
      model: configuredModel,
      models: [configuredModel],
      sizePresets: SIZE_PRESETS,
      stylePresets: STYLE_PRESETS,
      qualities: IMAGE_QUALITIES,
      outputFormats: OUTPUT_FORMATS,
      counts: GENERATION_COUNTS
    };

    return c.json(config);
  });
}
