# 类型安全

## Shared 类型优先

- 图像尺寸、生成、Gallery、provider、Agent 事件、计划 schema 都从 `@gpt-image-canvas/shared` 导入。
- 不在 Web 重新定义 API response/request。需要新增字段时先改 `packages/shared`。
- 文件证据：`CanvasApp.tsx` 大量导入 `GenerationRecord`、`ProviderSourceId`；`GalleryPage.tsx` 导入 `GalleryResponse`；`ProviderConfigDialog.tsx` 导入 `SaveProviderConfigRequest`。

## Runtime guard

API response 是 unknown-ish 外部输入，仍要做关键校验：

- Gallery 检查 `Array.isArray(body.items)`。
- Agent/tldraw snapshot 用 `isRecord()`、枚举集合、shape type guard。
- WebSocket event 用 `parseAgentServerEvent()` 解析失败后给用户错误。

## 枚举和常量

- 选项来自 shared 常量：`SIZE_PRESETS`、`STYLE_PRESETS`、`IMAGE_QUALITIES`、`OUTPUT_FORMATS`、`GENERATION_COUNTS`、`PROVIDER_SOURCE_IDS`。
- UI label 本地化应以这些 id 为 key，不写散落字符串。
- 新增 shared union 时同步：
  - Web label map。
  - API parser。
  - Agent plan validator/executor（如涉及生成计划）。

## i18n 类型

- `Locale` 从 `LOCALES` 派生。
- `Translate` 支持字符串和参数化函数；新增 key 要同时补 `zhMessages` 和 `enMessages`。
- API error code 的本地化集中在 `commonApiErrorMessages`。

## tldraw 类型

- 自定义 shape 需要扩展 `TLGlobalShapePropsMap`。
- props 用 `RecordProps` / `T.*` 声明 runtime schema。
- 读取 snapshot 或 unknown plan 时不能信任 shape props，必须 guard。

## 避免

- `as SomeResponse` 后直接使用深层字段而无 shape 检查。
- 本地复制 shared union，导致 API/Web 分叉。
- 用 `any` 绕过 tldraw shape props。
- 新增 i18n key 只写一个语言。
