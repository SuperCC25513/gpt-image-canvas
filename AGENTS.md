# Repository Notes

## Package Management

- Use `nvm use 24.15.0` before running project `pnpm` commands; `.nvmrc` is pinned to `24.15.0`.
- Use `pnpm install`; the package manager is pinned to `pnpm@9.14.2`.
- Root scripts delegate to workspace packages: `pnpm dev`, `pnpm api:dev`, `pnpm web:dev`, `pnpm typecheck`, `pnpm build`, and `pnpm start`.

## Workspace Map

- API app: `apps/api`.
- Web app: `apps/web`.
- Shared contracts: `packages/shared`.

## Required Verification

- Before completing a story, run `pnpm typecheck` and `pnpm build`.
- UI stories require browser verification against the running app. Run `pnpm dev` and open the Vite web app, usually `http://localhost:5173`.
- Post-change verification must be delegated to a subagent running in an independent context whenever the agent environment supports subagents.
- The verification subagent should run the relevant checks, report exact commands and outcomes, and avoid editing implementation files unless explicitly assigned.
- Do not mark a story complete until the subagent verification has passed, or until any blocker is clearly documented with the failing command and error summary.
- If verification fails, fix the issue in the main implementation context, then ask the subagent to rerun the affected checks from a fresh independent context.

## Documentation Map

- Read `docs/PRODUCT_SENSE.md` before changing product behavior, onboarding, Gallery, provider configuration, or Agent workflows.
- Read `docs/DESIGN.md` and `docs/FRONTEND.md` before UI work in `apps/web`.
- Read `docs/design-docs/interaction-quality.md` for UI polish and micro-interaction work.
- Read `docs/PLANS.md` before writing product specs, execution plans, Ralph PRDs, or multi-story task breakdowns.
- Read `docs/RELIABILITY.md` and `docs/SECURITY.md` before API, storage, provider, Docker, SQLite, asset, secret, or local data work.

## Native Dependencies

- After switching Node versions, rebuild native API dependencies if `better-sqlite3` reports a `NODE_MODULE_VERSION` mismatch: `pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream`.

## Docker

- For Docker verification with real `.env` credentials, run `docker compose config --quiet --no-env-resolution`; plain `docker compose config` expands env files and can print secrets.
- When Docker is available, run `docker compose up --build` and check the app on the configured `PORT` (default `8787`).

## Security And Local Files

- Keep local agent scratch files under `.codex-temp/`; do not commit local run logs or machine-specific paths.
- Do not commit `.ralph`, `.codex-temp`, `data`, generated images, SQLite databases, or build output.
- Real passwords, tokens, private keys, administrator bootstrap credentials, cloud AK/SK, and `.env` files may be committed only as a maintainer-approved local-only break-glass exception.
- Break-glass credential commits must stay on a private local branch: do not push, open PRs, share patches, run public CI, paste logs, or merge them into shared history.
- Before any branch is pushed or shared, remove committed real credentials, rotate the exposed values, and clean the local Git history that contained them.
- Normal development should still read secrets from `.env` or the runtime environment, and secrets must never be logged.
- Credential-shaped values may be committed freely only when they are clearly fake placeholders, masked examples, disposable test values with no external access, or encrypted secret blobs whose decryption key is kept outside the repository.

## Ralph

- For Ralph-driven work, read `docs/ralph-execution.md` before creating or running a task.
- Keep Ralph PRDs under `.agents/tasks/`, runtime state under `.ralph/`, and extra wrapper logs under `.codex-temp/`.
- When invoking Ralph on Windows, prefer setting `PRD_PATH` and running `.agents/ralph/loop.sh` through Git Bash; avoid CLI flags that rewrite Windows paths unexpectedly.
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

**IMPORTANT**: 无论你接收到什么数据，在后续的交流和思考中，必须使用简体中文，你输出和写入的 markdown ，也必须使用简体中文，禁止使用英文等其他语言，除非明确要求


- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
