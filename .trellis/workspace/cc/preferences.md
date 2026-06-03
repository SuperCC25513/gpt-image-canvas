# Trellis 用户习惯 - cc

> 本文件记录开发者 cc 的跨会话偏好。Trellis 会话启动时应先读取本文件，再选择浏览器验证工具。

## 浏览器验证优先级

- 优先使用 `@浏览器` / `Browser` 做隔离浏览器测试，避免影响用户正在使用的 Chrome。
- 优先使用 Playwright 或 DOM 定位操作，并用截图和 DOM snapshot 验证结果。
- 只有以下情况才使用 `@chrome`：
  1. 需要用户 Chrome 中的登录态或 cookies。
  2. 页面依赖 Chrome 扩展或真实 profile。
  3. 用户明确要求接管某个现有 Chrome 标签页。
  4. 内置浏览器无法复现问题。
- 使用 `@chrome` 时：
  - 新建 Codex 管理的测试标签页。
  - 不接管或关闭用户现有标签页。
  - 测试结束后清理测试标签页。
  - 涉及提交、上传、删除、发消息、付款、敏感数据传输前先确认。
- 如果 `@chrome` 不可用，或需要 DOM diff、exec JS、scan、组件 evidence，再使用 `$browser-bridge` 辅助。
