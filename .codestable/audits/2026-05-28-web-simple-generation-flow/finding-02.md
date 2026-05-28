---
doc_type: audit-finding
audit: 2026-05-28-web-simple-generation-flow
finding_id: "performance-02"
nature: performance
severity: P1
confidence: medium
suggested_action: cs-refactor
status: deferred
---

# Finding 02：参考图以 data URL 存在 React state，内存放大明显

## 速答

参考图读取后转成 base64 data URL，保存在 `referenceImages` state 并直接渲染/提交；50MB 级图片会在浏览器内存中被放大。

## 关键证据

- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:122` — `const [referenceImages, setReferenceImages] = useState<SimpleReferenceImage[]>([]);` —— 引用图对象常驻组件 state。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1018` — `dataUrl: await blobToDataUrl(file, t)` —— 本地文件被转成 data URL。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1046` — `dataUrl: await blobToDataUrl(blob, t)` —— 预设引用图也转成 data URL。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1056` — `dataUrl: reference.dataUrl` —— 提交请求继续使用 state 中的 data URL。
- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx:1102` — `const reader = new FileReader(); ... reader.readAsDataURL(blob);` —— 使用 base64 编码路径。

## 影响

`MAX_REFERENCE_IMAGES` 允许多张参考图，单张上限又较大。base64 会显著增加内存占用，图片还会被 `<img>` 解码，移动端或长会话容易卡顿。

## 修复方向

把本地引用图保存在 `File`/`Blob` 或 object URL 中，提交时再按需编码；预设图可走可撤销 object URL 或后端资产引用。

## 建议动作

`cs-refactor`，因为主要是数据表示和生命周期优化。
