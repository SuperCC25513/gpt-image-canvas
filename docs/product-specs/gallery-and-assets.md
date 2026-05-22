# Gallery And Assets

## Goal

让生成输出围绕本地资产易于浏览、检查、定位、下载、重跑和理解。

## Current Product Shape

- 生成资产只保存到本地。
- Generation records store prompt, effective prompt, mode, preset, size, quality, format, count, status, references, and outputs.
- Gallery lists generated outputs and remains available without credentials.
- Assets expose metadata, preview, download, and raw routes.

## Quality Rules

- 本地可用性是资产可用性的唯一来源。
- Gallery cards should preserve the connection between prompt, output, generation record, and asset.
- Downloads should use the stored file and safe filename behavior.
- Asset previews should optimize browsing without breaking access to original generated files.
- Delete behavior should be explicit about what record or output is removed.

## Acceptance Criteria For Changes

- A generated output can be found in Gallery after creation.
- Locate, download, rerun, and delete actions remain clear.
- 本地资产失败需要清晰暴露，但不应隐藏其他仍可用的生成图片。
- Asset path handling stays constrained to `DATA_DIR`.
