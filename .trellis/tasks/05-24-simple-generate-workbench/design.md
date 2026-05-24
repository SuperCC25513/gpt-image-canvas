# 简化简单生图工作台设计

## 设计目标

以 `chatgpt2api` 的图像工作台为参考，重塑当前“简单生图”页面的信息架构，而不是直接迁移代码。最终体验应是“先创作，后调参”：用户看到输入框、生成按钮、最近结果/空状态，必要时才展开参数。

## 参考拆解

参考项目的关键结构：

- `web/src/app/image/page.tsx`：管理会话、历史、任务队列、结果滚动、底部输入器。
- `web/src/app/image/components/image-composer.tsx`：底部大输入框，上传、额度、张数、比例、提交按钮都压在同一工作台内。
- `web/src/app/image/components/image-results.tsx`：空状态居中展示标题；有会话时以对话轮次展示提示词和图片结果。
- `web/src/app/image/components/image-sidebar.tsx`：桌面左侧历史，移动端弹窗历史。

可借鉴：

- 底部输入器是主入口。
- 参数控件用胶囊形态收纳。
- 空状态不是“空面板”，而是轻提示。
- 历史/结果和输入器分离，输入器始终容易找到。

不能直接复制：

- Tailwind/shadcn 实现方式。
- 石色主题和大圆角视觉。
- 参考项目的本地会话存储、任务队列、管理员额度逻辑。

## 当前边界

主要修改 `apps/web`：

- `apps/web/src/features/simple-generation/SimpleGenerationPage.tsx`
- `apps/web/src/styles/simple-generation.css`
- `apps/web/src/shared/i18n/index.tsx`

参考图上传纳入本任务。需要在 `SimpleGenerationPage.tsx` 内增加本地参考图状态、文件读取和 `/api/images/edit` 分支；后端已有 `/api/images/edit` 和 `referenceImages` 校验，优先复用现有契约，不改 API。

## 信息架构

页面分三层：

1. 工作区：显示空状态或最近生成结果。空状态用轻量标题、短说明、预设卡/快捷示例。
2. 历史/最近结果：桌面可保留轻量侧栏或右侧浮层入口；移动端用抽屉/按钮进入。第一版可先使用现有最近 8 张结果，不新增长期会话模型。
3. 输入工作台：底部居中，包含大 textarea、参数胶囊、生成按钮、状态反馈。

## 交互设计

- 默认参数：沿用当前默认 `square-1k`、`none` 风格、`auto` 质量、`png` 输出、`1` 张、不公开。
- 提示词输入：textarea 支持 Enter 提交需要谨慎；第一版可以保留点击生成按钮提交，避免破坏多行输入。
- 参数胶囊：
  - 张数：当前值可直接显示，可用小菜单/分段控件调整。
  - 比例/尺寸：显示当前尺寸标签，展开后列出常用尺寸和自定义入口。
  - 风格/参数：显示当前风格；高级参数放入弹层/抽屉。
  - 公开：用锁/地球图标加短标签，避免当前大块说明。
  - 积分：显示“预计消耗/余额”的短 chip，错误时转为警告态。
- 结果：
  - 无结果：不渲染大型边框结果面板。
  - 有结果：显示最近结果网格或轮次块，保留下载、复制提示词、发送画布。
  - 最新一轮成功后，给出“继续到画布”的紧凑提示。

## 状态与数据流

保留现有数据流：

1. 页面加载 `/api/gallery` 获取最近图片。
2. 用户提交后调用 `/api/images/generate`。
3. 若返回非终态，轮询 `/api/generations/:id`。
4. 终态后合并 `sessionItems` 和 `galleryItems`。
5. 刷新账户积分状态。

参考图数据流：

1. 用户上传或粘贴图片，前端读取为 data URL。
2. `referenceImages.length > 0` 时提交 `/api/images/edit`，否则提交 `/api/images/generate`。
3. 请求体沿用 `EditImageRequest.referenceImages`，字段包含 `dataUrl`、`fileName`。
4. 参考图只保留在当前输入器状态，不写入长期本地存储。

## 兼容性

- 不改变路由 `/generate`。
- 不改变 `onContinueOnCanvas` 协议。
- 不改变 Gallery/API 返回结构。
- 不改变顶部导航。
- 不改变 `SIZE_PRESETS`、`STYLE_PRESETS`、积分配置来源。

## 风险

- 底部工作台如果固定定位，可能遮挡移动端内容；优先用页面内部 flex 布局和 padding 预留空间。
- 参数收纳后可能降低专业用户可见性；用清晰的“参数”入口和当前值 chip 缓解。
- 参考图上传会扩大测试面，需要验证文件大小、类型错误、粘贴、移除、提交、失败反馈。
- 当前页面没有会话模型；如果强行复制参考项目的对话历史，会引入过大状态迁移。第一版建议只做视觉/交互工作台，不引入新会话存储。

## 回滚

变更集中在简单生图页面和样式文件。若体验或构建失败，可回滚 `SimpleGenerationPage.tsx`、`simple-generation.css`、`i18n/index.tsx` 三处变更，不影响 API 和画布。
