---
doc_type: audit-finding
audit: 2026-06-03-redemption-codes-ui-refresh
finding_id: "maintainability-03"
nature: maintainability
severity: P2
confidence: medium
suggested_action: cs-refactor
status: fixed
---

# Finding 03：移动端全站导航 active 项可能不可见

## 速答

本次增强了顶部导航 active 视觉，但移动端导航是窄横向滚动区，后台等靠后的 active 项可能不在首屏可见范围内，导致增强后的状态不可见。

## 关键证据

- `apps/web/src/features/canvas/CanvasApp.tsx:2641-2738` — 顶部导航顺序是：首页、广场、简单生成、画布、提示池、作品库、后台；后台位于末尾。
- `apps/web/src/styles/layout.css:47-58` — `.top-navigation__links` 使用 `overflow-x: auto` 且隐藏 scrollbar。
- `apps/web/src/styles/responsive.css:391-393` — 520px 以下导航容器 `max-width: 38vw`，可视宽度很窄。
- `apps/web/src/features/canvas/CanvasApp.tsx:2733-2738` — 后台 active 只通过 `data-active={route === "admin"}` 加样式，没有在路由切换或加载时把 active link 滚入视口。

## 影响

移动端进入后台时，用户可能只能看到导航前两个入口，看不到“后台”这个 active 项。样式本身已经有青绿色 selected，但由于横向位置不可见，无法发挥“当前位置提示”作用。

## 修复方向

给 `TopNavigation` 增加 active link ref，在 route 变化后执行 `scrollIntoView({ inline: "center", block: "nearest" })`；或把移动端导航改成当前页优先 / 菜单式结构。

## 建议动作

`cs-refactor`，因为这是导航结构和响应式行为的维护性改进，不需要改业务 API。

## 修复记录

2026-06-03：顶部导航 route 变化后自动把 active link 滚入横向导航可见区域。
