# 简化简单生图工作台实施计划

## 开始前

- 等用户确认规划可执行。
- 确认后执行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/05-24-simple-generate-workbench` 进入实现阶段。
- 实现前加载 `trellis-before-dev`，按 `apps/web` 前端规范执行。

## 实施步骤

1. 重构 `SimpleGenerationPage.tsx` 的 JSX 结构：
   - 将当前 header + 左表单 + 右结果面板改为工作区 + 底部输入工作台。
   - 保留现有提交、轮询、结果合并、积分校验函数。
   - 把参数控件拆成紧凑区域，避免首屏长表单。

2. 调整结果/空状态：
   - 无结果时展示轻量空状态和快捷提示词/预设入口。
   - 有结果时展示最近结果网格，保留下载、复制、发送画布。
   - 保留 Gallery 入口。

3. 调整参数入口：
   - 张数、尺寸、风格、公开、积分改为 chip/菜单/紧凑分组。
   - 高级设置继续包含自定义宽高、质量、输出格式。
   - 确保错误、警告、生成中状态在输入工作台附近显示。

4. 增加参考图输入：
   - 增加上传按钮、隐藏 file input、粘贴读取、参考图缩略图、移除按钮。
   - 无参考图时提交 `/api/images/generate`。
   - 有参考图时提交 `/api/images/edit`，请求体带 `referenceImages`。

5. 更新 `simple-generation.css`：
   - 使用现有 warm paper、ink、copper、teal token。
   - 去掉首屏复杂网格和大表单视觉。
   - 增加桌面/移动响应式规则，确保底部工作台不遮挡结果。

6. 更新 i18n：
   - 新增/修改中文和英文文案。
   - 删除不再使用的文案时先搜索引用。

7. 验证：
   - `nvm use 24.15.0`
   - `pnpm typecheck`
   - `pnpm build`
   - `pnpm dev`
   - 浏览器打开 `http://localhost:5173/generate`，检查桌面和移动视口。

## 重点检查

- 提示词为空时生成按钮禁用或给出明确提示。
- 上传/粘贴参考图后，输入器进入编辑语境；移除最后一张参考图后回到文生图语境。
- 积分不足、未登录、本地服务不可用时错误清晰。
- 生成成功后最近结果立即出现，刷新 Gallery 后不重复错乱。
- 下载、复制、发送到画布仍可用。
- 高级参数不会因收纳丢失当前值。
- 移动端 chip 可横向滚动或换行，不压住提交按钮。

## 回滚点

- JSX 结构重构前保留当前函数和状态命名，避免大范围逻辑改写。
- 样式变更只集中在 `simple-generation.css`，不改全局 token。
- 如参考图上传带来过大风险，可先回滚该分支，保留文生图工作台改版。

## 验证记录

- `source ~/.nvm/nvm.sh && nvm use 24.15.0 && pnpm --filter @gpt-image-canvas/web typecheck`：通过。
- `source ~/.nvm/nvm.sh && nvm use 24.15.0 && pnpm typecheck`：通过。
- `source ~/.nvm/nvm.sh && nvm use 24.15.0 && pnpm build`：通过，仅保留现有 Vite 大 chunk 警告。
- 独立 `trellis-check` 子代理复用本地 `http://localhost:5173/generate` 完成桌面 `1440x900` 和移动 `390x844` 验证：输入器可见、无横向溢出、上传入口可见、参数面板可打开且在视口内。
- 子代理发现中文空状态标题仍为英文，已修复为“把想法变成图片”，并重新运行 `pnpm typecheck` 与 `pnpm build` 通过。
