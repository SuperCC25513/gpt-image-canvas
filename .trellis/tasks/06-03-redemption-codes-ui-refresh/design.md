# 设计方案

## 设计原则

- 延续项目既有视觉语言：暖纸背景、深墨文字、铜色主操作、青绿色焦点与成功状态。
- 后台页要数据密集但不拥挤，优先让运营人员快速判断“有多少码、哪些可用、最近生成了什么”。
- 不使用纯黑作为选中底色。深墨只保留为文字、边框或极少量强调，不作为大面积选中块。
- 交互状态用明确但克制的反馈：hover、focus、active、loading 都不改变布局尺寸。
- 顶部导航是全站共享外壳，改动要比兑换码页更保守：只统一 active/hover/focus 语言，不改变路由结构和账号菜单行为。

## ui-ux-pro-max 决策依据

本任务使用 `ui-ux-pro-max` 做设计检索，采纳和拒绝如下：

| 来源 | 结论 | 本任务决策 |
| --- | --- | --- |
| Design System | 推荐青绿色信任色 `#0F766E` / `#14B8A6` | 采纳；它与项目 `--focus` / `--focus-soft` 一致，用作 selected/focus 主色 |
| Design System | 推荐 OLED 暗黑和企业落地页结构 | 拒绝；与项目暖纸本地工作台方向冲突 |
| Style: Data-Dense Dashboard | KPI、表格、筛选、8-12px 紧凑间距、行 hover、加载状态 | 采纳；兑换码页按运营后台而不是营销页处理 |
| UX: Active State | 当前导航位置要用颜色或下划线明确标识 | 采纳；顶部导航 active 使用青绿色文字、柔和底和细强调线 |
| UX: Focus / Keyboard | 所有交互控件需要可见焦点和键盘路径 | 采纳；导航、语言切换、筛选、表单都要保留 focus-visible |
| UX: Form Labels / Submit Feedback | 输入必须有关联标签，提交要有加载/成功/错误反馈 | 采纳；新增搜索和筛选不依赖 placeholder，创建表单保留 loading/notice/error |
| React Stack | 表单和筛选用受控组件、局部 `useState` | 采纳；不引入额外状态库或非受控 ref |

最终视觉取舍：

- 青绿色是 active/focus 主色：全站导航、语言切换、后台 tab、兑换码筛选都使用同一语义。
- 铜色是行动与运营强调：生成兑换码、复制结果、局部边框细节可使用铜色，不作为所有 selected 的主色。
- 深墨不再作为大面积 selected 背景，仅用于正文、代码值和少量文字强调。

## 兑换码页结构

兑换码 tab 内改为四个区块：

1. 顶部摘要行
   - 展示总数、可兑换、已兑换、已停用、已过期等派生统计。
   - 统计用紧凑 pill 或小型指标，不做大卡片，避免后台页面继续堆卡片。

2. 筛选工具条
   - 左侧为状态分段按钮：全部、可兑换、已停用、已兑换、未兑换、已过期。
   - 右侧为搜索输入和清除筛选按钮。
   - 选中态用 `var(--focus-soft)`、`var(--focus)` 和暖纸边框组合，不使用 `var(--ink)` 背景。
   - 每个筛选按钮可展示数量，减少用户在列表与筛选之间来回扫读。

3. 创建表单
   - 积分、数量、过期时间保留为受控输入。
   - 快捷过期按钮作为过期时间的辅助选项，视觉上归属于过期时间输入。
   - 快捷过期按钮点击后进入 selected 状态并设置 `aria-pressed="true"`；手动编辑 `datetime-local` 后清除 selected。
   - 生成按钮固定在表单操作位；加载时保留按钮宽度，避免跳动。

4. 列表与状态
   - 列表数据来自本地 `redemptionCodes`，先倒序排序，再按筛选和搜索派生。
   - 空状态区分两种：没有任何兑换码；当前筛选无匹配。
   - 最近生成结果保留在表单下方，但改成轻量复制条，不再使用黑底按钮。

## 全站导航与语言切换

涉及文件：

- `apps/web/src/features/canvas/CanvasApp.tsx`
- `apps/web/src/styles/layout.css`
- `apps/web/src/styles/layout-theme.css`
- `apps/web/src/styles/dark.css`
- `apps/web/src/styles/responsive.css` 如响应式规则需要微调

设计方向：

- 顶部导航当前页使用“青绿色柔和底 + 青绿色文字/图标 + 底部细强调线”的组合，不使用纯黑底、强反白或通用蓝色。
- 当前页文字和图标一起强调，避免只靠文字颜色。
- 语言切换保持二段式 segmented control，但 active 改为青绿色柔和底、青绿色文字和清晰边框；深色主题使用低透明青绿色底和浅青文字。
- hover 使用暖纸加深或轻青绿色底，focus 使用 `var(--focus)` 轮廓，active 使用现有 press scale。
- 保留 `.top-navigation__links` 横向滚动与移动端紧凑规则，不引入会让导航高度变化的状态样式。

建议 token 映射：

- 浅色 active 背景：`var(--focus-soft)`。
- 浅色 active 边框/强调线：`rgb(15 118 110 / 0.36)`。
- 浅色 active 文本：`var(--focus)`。
- 铜色使用点：主操作按钮、生成结果复制条、少量 warm border 或 hover，不承担全站 active 主语义。
- 深色 active 背景：`rgb(20 184 166 / 0.16)`。
- 深色 active 文本：`#99f6e4`。

## 状态与数据

新增本地筛选状态：

```ts
type RedemptionCodeFilter = "all" | "available" | "disabled" | "redeemed" | "unredeemed" | "expired";
```

新增状态：

```ts
const [redemptionCodeFilter, setRedemptionCodeFilter] = useState<RedemptionCodeFilter>("all");
const [redemptionCodeSearch, setRedemptionCodeSearch] = useState("");
const [redemptionCodeNow, setRedemptionCodeNow] = useState(() => Date.now());
const [selectedRedemptionCodeExpiryPresetId, setSelectedRedemptionCodeExpiryPresetId] = useState<string>("");
```

派生数据：

- `redemptionCodeStats`：从 `redemptionCodes` 统计总数、可兑换、已停用、已兑换、未兑换、已过期。
- `visibleRedemptionCodes`：基于 `sortedRedemptionCodes`、筛选状态和搜索词派生。
- `hasRedemptionCodeFilters`：用于显示清除筛选按钮和空状态文案。
- `redemptionCodeFilterOptions`：把筛选 label、filter key 和统计数量绑定，避免 JSX 内重复判断。

派生规则：

- 已兑换：`Boolean(code.redeemedAt || code.redeemedByUserId)`。
- 已过期：`code.expiresAt` 存在且早于 `redemptionCodeNow`，且未兑换。
- 可兑换：`code.status === "active"`、未兑换、未过期。
- 未兑换：未兑换，不要求一定可兑换。
- 已停用：`code.status === "disabled"`。
- 搜索：把输入和目标字段统一 `trim().toLowerCase()`；兑换码可额外去掉空格和连字符再匹配。
- 时间快照：加载列表、创建成功和切换到兑换码 tab 时刷新 `redemptionCodeNow`；如实现成本低，可用每分钟 interval 更新一次。

命名约束：

- 内部筛选 key 使用 `available` 表示“可兑换”，不要使用 `active`。`active` 已是 API 状态值，复用会让筛选语义和服务端状态混淆。
- 行内状态 badge 使用 API 的 `code.status` 渲染“已启用/已停用”；“可兑换”只用于筛选和统计，必须额外排除已兑换和已过期。

## 组件边界

保持改动集中在 `AdminPage.tsx` 和 `admin.css`：

- 兑换码筛选选项使用文件内常量，避免新增跨模块抽象。
- 可提取小型 helper：`isRedemptionCodeRedeemed`、`isRedemptionCodeExpired`、`matchesRedemptionCodeFilter`、`matchesRedemptionCodeSearch`。
- 可提取小型 helper：`redemptionCodeSearchText` 或 `normalizeRedemptionCodeSearchText`，集中处理搜索字段和大小写。
- 不新建通用组件，除非现有 JSX 明显重复到影响可读性。

## 文案与国际化

新增或调整文案都写入 `apps/web/src/shared/i18n/index.tsx`：

- 筛选标签：全部、可兑换、已停用、已兑换、未兑换、已过期。
- 搜索标签和 placeholder。
- 清除筛选。
- 当前筛选无匹配。
- 统计标签。
- 快捷过期时间 selected 语义不需要新增可见文案，但按钮需要保留现有中英文标签。

## 样式方案

新增命名建议：

- `.admin-redemption-summary`
- `.admin-redemption-stat`
- `.admin-redemption-toolbar`
- `.admin-redemption-filter-group`
- `.admin-redemption-search`
- `.admin-redemption-composer`
- `.admin-redemption-created-copy`

样式要求：

- 使用 grid/flex + gap，不靠零散 margin。
- 控件高度统一到 40px 左右。
- 数字统计使用 `font-variant-numeric: tabular-nums`。
- hover/focus/active 只改变背景、边框、颜色、轻微 transform，不使用 `transition: all`。
- 移动端在 900px 下两列，在 640px 下单列。
- 表格可以在 `.admin-table-wrap` 内横向滚动，但页面本身不能出现横向滚动。
- 筛选、语言切换、后台 tab 都不能只靠颜色表达 selected；至少同时使用背景、边框、强调线、图标状态或 `aria-pressed`。
- 顶部导航和语言切换优先改现有选择器，不改 DOM 结构；如需要 active 强调线，使用伪元素，避免新增无语义节点。
- 深色样式必须在 `dark.css` 中同步覆盖，不能只依赖浅色默认值。
- 导航 active 不能只靠颜色表达；需要同时提供背景、边框或底部强调线。

## 风险与回滚

- 风险：本地筛选是前端派生，只作用于已加载的 200 条数据；用户可能误以为是全量服务端筛选。
  - 处理：本任务文案不声明“全量搜索”，后续如需全量筛选再扩展 API。
- 风险：后台 tab 选中态样式是后台全页面共享，改动会影响用户管理、生成服务、审计和设置 tab 的外观。
  - 处理：只改同一后台视觉系统，不改业务逻辑。
- 风险：顶部导航和语言切换是全站共享样式，改动会影响首页、广场、简单生成、画布、提示池、作品库和后台。
  - 处理：只修改 active/hover/focus 视觉；实现后至少检查后台页、画布页、窄屏导航和语言切换。
- 风险：深色 canvas 主题有独立覆盖，浅色修复可能在深色下出现对比不足或反白突兀。
  - 处理：同步更新 `dark.css`，浏览器检查深色 canvas 场景。
- 风险：`available`、API `active`、已过期和已兑换之间语义接近，容易实现成错误筛选。
  - 处理：helper 命名区分 `status === "active"` 和 `isRedemptionCodeAvailable`，并在验收中单独检查可兑换筛选。
- 风险：快捷过期按钮 selected 状态可能在手动编辑日期后残留。
  - 处理：手动日期输入时清空 `selectedRedemptionCodeExpiryPresetId`，创建成功重置表单时一起清空。
- 回滚点：`AdminPage.tsx` 兑换码区 JSX、筛选派生逻辑、`admin.css` 后台 tab/兑换码样式、`layout.css`/`layout-theme.css`/`dark.css` 顶部导航样式、i18n 新增键。
