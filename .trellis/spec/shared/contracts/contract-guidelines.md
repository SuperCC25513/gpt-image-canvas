# 契约规范

## 常量驱动

选项值集中在 shared：

- `SIZE_PRESETS`
- `STYLE_PRESETS`
- `IMAGE_QUALITIES`
- `OUTPUT_FORMATS`
- `GENERATION_COUNTS`
- `PROVIDER_SOURCE_IDS`
- `MAX_REFERENCE_IMAGES`
- `MAX_GENERATION_PLAN_IMAGES`

API parser 和 Web UI 都应引用这些常量，避免散落硬编码。

## Request / Response 形态

- Request interface 表达客户端发送内容，如 `GenerateImageRequest`、`EditImageRequest`、`SaveProviderConfigRequest`。
- Response interface 表达 API 返回内容，如 `GenerationResponse`、`GalleryResponse`、`ProviderConfigResponse`。
- Secret 在 response 中必须是 `MaskedSecret`，不要暴露 raw value。
- 状态字段使用 string union，如 `GenerationStatus`、`GenerationPlanStatus`、`ProviderSourceStatus`。

## GenerationPlan

Agent plan 是 schema 化契约：

- `schemaVersion` 当前为 `GENERATION_PLAN_SCHEMA_VERSION = 1`。
- `jobs` 描述可执行图像任务。
- `edges` 描述依赖 DAG。
- source job 被下游依赖时 count 必须为 `1`，该规则由 API planner/executor 校验。
- 每个 job 最多 `MAX_GENERATION_JOB_REFERENCES` 张参考图，总图数最多 `MAX_GENERATION_PLAN_IMAGES`。

改 plan 字段时同步：

- `packages/shared/src/generation.ts`
- `apps/api/src/domain/agent/planner.ts`
- `apps/api/src/domain/agent/executor.ts`
- `apps/web/src/features/agent/AgentPlanNodeShape.tsx`
- `apps/web/src/features/canvas/CanvasApp.tsx`

## 向后兼容

- 旧字段需要保留读兼容时，API/Web 都要接受 legacy 形态。例：edit request 同时支持 `referenceImage` 和 `referenceImages`、`referenceAssetId` 和 `referenceAssetIds`。
- 新增字段优先 optional，再由 API/domain 设置默认。
- 改保存到项目快照或 tldraw shape 的契约时，必须保留旧快照恢复路径。

## 避免

- Web/API 各自定义同名 interface。
- 用 number/string 魔法值代替 shared union。
- 修改 shared 常量但不搜索所有使用方。
