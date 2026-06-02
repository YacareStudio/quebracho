# Contributing to Quebracho

Thanks for helping improve Quebracho.

This project uses an issue-first workflow, small reviewable PRs, and performance-focused engineering because Quebracho is an agentic IDE where startup time and runtime resource usage are critical.

## Quick Start

1. Fork and clone the repository.
2. Install dependencies:
   - `npm install`
3. Run local validation before opening a PR:
   - `npm run ci:check`
4. Start the app in development mode:
   - `npm run dev`

## Contribution Flow (Issue -> Branch -> PR)

1. Open an issue first (bug or feature).
2. Wait for maintainer approval (`status:approved`) before implementation.
3. Create a branch with conventional naming:
   - `feat/short-description`
   - `fix/short-description`
   - `docs/short-description`
4. Keep changes as small work units (easy to review and rollback).
5. Open a PR linked to the issue (`Closes #123`).

## Branch and Commit Conventions

- Branch pattern:
  - `type/description`
  - Allowed `type`: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `ci`, `build`, `revert`, `style`
- Commit convention:
  - `type(scope): short description`
  - Example: `perf(watcher): reduce filesystem refresh frequency`

## PR Rules

- Every PR must link one approved issue.
- Every PR must represent one coherent change.
- Include tests and docs in the same PR when behavior changes.
- Target review budget: ~400 changed lines. Split when larger.

## Quality Gates

Run these locally before pushing:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build:web`

CI runs equivalent checks on push/PR.

## Performance and Resource Policy

All contributions should preserve or improve responsiveness and memory/CPU usage.

Priorities:

1. Avoid expensive full-tree scans in hot paths.
2. Prefer incremental updates over full recomputation.
3. Add debouncing/coalescing for high-frequency events.
4. Keep renderer-to-native contracts explicit and minimal.
5. Do not expand filesystem access without path-boundary validation.

When a change can impact performance, include a short note in the PR:

- What path is affected (startup, editor input, watcher events, AI streaming, etc.)
- Expected impact (latency, CPU, memory)
- How you validated it

## Security Policy for Native Commands

`src-tauri/` changes are security-sensitive.

- Validate all input paths.
- Constrain operations to intended workspace boundaries.
- Keep command surface minimal.
- Document security tradeoffs in the PR description.

## Architecture Guidance

- Frontend (`app/`): UI, state, interaction orchestration.
- Backend (`src-tauri/`): native capabilities, process management, filesystem, updater, LSP bridge.
- Keep cross-layer contracts explicit and stable.

## Agentic Workflow (Skills)

See `docs/contributing/agentic-workflow.md` for maintainers and contributors using AI-assisted development workflows.

## Need Help?

- Use Issues for concrete bugs/features.
- Use Discussions for questions and design conversations.
