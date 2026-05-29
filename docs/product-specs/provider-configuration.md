# Provider Configuration

## Goal

Let users choose reliable image generation and planning providers while keeping credentials local, masked, and understandable.

## Image Provider Sources

The image provider source order is:

1. Environment OpenAI-compatible config.
2. Local OpenAI-compatible config stored in the app database.
3. Codex login fallback.

Environment configuration comes from `.env` or runtime variables and is read-only in the UI. Local OpenAI-compatible config is editable in the app. Codex depends on local OAuth session state. SQLite and MySQL modes use the same system page contract, but switching to MySQL does not migrate existing SQLite provider or Codex configuration.

## Agent LLM Configuration

Agent planning uses a separate OpenAI-compatible chat configuration. It has its own API key, Base URL, model, timeout, and `supportsVision` setting.

Do not assume a configured image provider means Agent planning is configured.

Agent LLM configuration is stored in the app database in both SQLite and MySQL modes. Switching to MySQL requires saving Agent LLM settings again because SQLite configuration is not migrated.

## Acceptance Criteria For Changes

- Active source, source order, and missing source states are visible.
- Saved secrets are masked on read.
- Preserve-secret behavior is explicit.
- Provider errors are actionable and localized.
- Security rules in `docs/SECURITY.md` are preserved.
