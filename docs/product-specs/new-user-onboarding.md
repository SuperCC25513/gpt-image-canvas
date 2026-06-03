# New User Onboarding

## Goal

帮助首次使用者理解应用能力、识别生成服务状态，并在不暴露系统配置或凭据细节的情况下进入画布。

## Current Product Shape

- `/` is credential-aware.
- `/canvas` is the working canvas and requires a usable generation service.
- `/gallery` remains available without credentials so local outputs can be viewed.
- Provider、Codex 和 Agent LLM 配置由管理员在后台 Providers 页面维护，onboarding 不提供系统配置入口。

## Quality Rules

- 缺少生成服务时，状态应清晰且指向联系管理员。
- ToC onboarding 不展示环境变量、API Key、Base URL、source order 或 Codex 登录。
- Users should not need to understand Docker, SQLite, or internal routes to start.
- If credentials are absent, generation actions should fail with a clear `missing_provider` style message rather than a generic error.

## Acceptance Criteria For Changes

- 用户可以识别生成服务是否可用。
- 缺少生成服务时，首页或画布阻塞状态不提供 provider setup 入口，只提示联系管理员。
- Gallery remains reachable without credentials.
- UI changes are verified at `http://localhost:5173` on desktop and mobile.
