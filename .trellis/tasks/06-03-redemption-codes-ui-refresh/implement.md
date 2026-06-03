# 实现计划

## 前置阅读

- `docs/DESIGN.md`
- `docs/FRONTEND.md`
- `docs/design-docs/interaction-quality.md`
- `docs/PRODUCT_SENSE.md`
- `.trellis/spec/guides/index.md`
- `.trellis/spec/web/frontend/index.md`
- `ui-ux-pro-max` 决策结果见 `design.md` 的“ui-ux-pro-max 决策依据”

## 实现步骤

1. 开发前加载 `trellis-before-dev`，按 web/frontend 相关规范确认可编辑范围。
2. 在 `AdminPage.tsx` 增加兑换码筛选状态、筛选选项、统计派生和 helper。
   - 筛选 key 使用 `available`，不使用 `active`。
   - 增加 `redemptionCodeNow`，让统计、筛选和行状态基于同一时间快照。
   - 增加快捷过期按钮 selected 状态，手动改日期时清除。
3. 重构兑换码 tab JSX：
   - 增加摘要统计行。
   - 增加筛选工具条、筛选数量、搜索输入和清除筛选按钮。
   - 调整创建表单结构，保持现有提交逻辑。
   - 为快捷过期按钮加 `aria-pressed` 和 selected 样式。
   - 根据 `visibleRedemptionCodes` 渲染列表。
   - 区分无数据和无匹配空状态。
4. 在 `i18n/index.tsx` 增加中英文文案。
5. 在 `admin.css` 调整后台 tab 选中态和兑换码区域样式：
   - 移除纯黑大面积选中态。
   - 统一控件高度、焦点、hover、active。
   - 增加响应式布局。
6. 在 `layout.css`、`layout-theme.css`、`dark.css` 调整顶部全站导航和语言切换：
   - 当前页导航项使用青绿色 active/focus 主语义，不使用纯黑或通用蓝色。
   - 语言切换 active 使用青绿色柔和底和清晰边框，不使用纯黑或强反白。
   - 浅色与深色主题都保持足够对比。
   - 不改变 `TopNavigation` 路由、账号菜单和语言切换行为。
7. 检查 `responsive.css` 是否需要为新 active 视觉补充窄屏规则。
8. 本地运行验证，必要时微调布局和文案。

## 验证命令

每次运行 `pnpm` 前先切 Node：

```bash
nvm use 24.15.0
pnpm typecheck
pnpm build
```

UI 验证：

```bash
nvm use 24.15.0
pnpm dev
```

浏览器检查：

- 打开 `http://localhost:5173/admin/redemption-codes`。
- 检查桌面视口和移动视口。
- 检查顶部导航当前页、后台 tab 当前项、语言切换当前项。
- 切到画布页检查深色 canvas 主题下顶部导航和语言切换。
- 检查无兑换码、筛选无匹配、有兑换码列表、创建中、创建成功、复制反馈。
- 检查可兑换筛选不包含已兑换、已过期或已停用兑换码。
- 检查快捷过期按钮点击后 selected，手动改日期后 selected 消失。

## 重点检查

- 选中态没有纯黑背景。
- active 主语义遵循 `ui-ux-pro-max` 决策：青绿色为 selected/focus，铜色为主操作和运营强调。
- 筛选按钮、快捷过期按钮、生成按钮都有 hover、focus、active 状态。
- 顶部导航和语言切换在浅色/深色下都有 hover、focus、active、selected 状态。
- 表单标签和搜索输入可被辅助技术理解。
- 筛选不会改变后端数据，只影响当前加载列表。
- 筛选语义不混淆 API `active` 与 UI `available`。
- 兑换码搜索规范化后可匹配大小写不同的兑换码、用户名称、邮箱和 ID。
- 兑换码复制、启用/停用、删除业务逻辑不变。
- 移动端无横向页面滚动和文字重叠。

## 暂缓项

- 服务端筛选和分页搜索，等待后续任务。
