# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # full Tauri dev mode (starts Vite + Rust backend)
npm run dev:web      # frontend only, no Tauri shell (http://localhost:5173)
npm run build        # build desktop installer (NSIS only)
npm run build:all    # build all bundle targets for the platform
npm run build:web    # build static web output to dist/

npm run typecheck    # TypeScript check only
npm run lint:rust    # cargo clippy
npm run lint         # typecheck + clippy
npm run format:check # cargo fmt check
npm run test         # cargo test (Rust only)
npm run ci:check     # full pre-PR gate: build:web + format + lint + test
```

Run a single Rust test:
```bash
cargo test --manifest-path src-tauri/Cargo.toml <test_name>
```

Release/updater helpers (Tauri signed auto-update):
```bash
npm run updater:keygen        # generate the updater signing keypair (tauri signer generate)
npm run updater:latest:init   # scaffold the latest.json release-metadata template
```
`scripts/validate-release-metadata.mjs` checks the generated release metadata.

## Architecture

Quebracho is a Tauri 2 desktop IDE. The frontend is React/TypeScript (Vite), the backend is Rust. They communicate via Tauri's `invoke()` IPC.

### IPC bridge (`app/tauri-bridge.ts`)

`window.forgeAPI` is the single object exposing all Rust commands to the renderer. It is defined in `app/tauri-bridge.ts` and wired on module load. All Rust commands are called via `invoke('<command_name>', args)`. Event subscriptions use `listen('<event_name>', ...)`. If a new Rust command is added, add its wrapper here.

### State (`app/store.ts`)

A single Zustand store (`useStore`) holds the entire app state: workspace, open tabs, sidebar layout, AI conversation, live server status, and more. Async actions that call `window.forgeAPI` live here. The store is the source of truth for the renderer; the Rust side is the source of truth for file system and AI streaming state.

### AI system (`app/ai/`)

- **`runtime.ts`** — agentic loop. `runUserPrompt()` is the entry point from the input area. It handles slash commands (`/init`, `/clear`), then runs `runAgentLoop()` which streams LLM responses and executes tool calls in a loop (max 20 steps).
- **`protocol.ts`** — system prompt builder and parser. Tool calls are embedded in the model's plain-text output as `<tool>{"name":"…","args":{…}}</tool>` XML blocks. `parseAssistantTurn()` strips them from visible text and returns them as a structured list.
- **`streamRouter.ts`** — intercepts `escribir_archivo` chunks in the live stream to pipe file content directly into the Monaco editor tab character-by-character, before the full tool call is parsed.

Available agent tools (called in Spanish internally): `leer_archivo`, `escribir_archivo`, `listar_carpeta`, `buscar_en_proyecto`.

### AI providers (`src-tauri/src/providers/`)

Each provider implements the `Provider` trait (`providers/mod.rs`). Existing providers: Anthropic, Google, Ollama, OpenRouter, and a generic `OpenAiCompatibleProvider` for OpenAI-compatible APIs. To add a provider, implement the trait and register it in `providers/registry.rs`. API keys are stored in the OS keyring with a JSON file fallback (`storage/keyring.rs`, `storage/secrets.rs`).

### Rust backend (`src-tauri/src/`)

Modules:
- `commands/` — Tauri command handlers, one file per feature group (`ai.rs`, `agent.rs`, `fs.rs`, `terminal.rs`, `live_server.rs`, `lsp.rs`, `database.rs`, `settings.rs`, `app.rs`)
- `providers/` — LLM provider implementations + SSE parser
- `models/` — shared data types (`ChatMessage`, `ChatResponse`, `ModelInfo`, `ProviderError`, `StreamChunk`, `ProviderId`)
- `state/` — shared Tauri app state (provider registry, active stream tracking)
- `storage/` — config persistence (`quebracho-config.json`), keyring, migration
- `utils/` — shared utilities

### Project initialization (`/init`)

Running `/init` in the AI panel generates `PROJECT.md` at the workspace root and creates a `.quebracho/` directory with `history.json` for per-project conversation persistence. The AI panel blocks normal prompts until `/init` has been run.

### Other frontend systems

- **LSP** (`app/lsp/client.ts`) — wraps `typescript-language-server` via the Rust backend; started/stopped with the workspace.
- **Live Server** — embedded HTTP server (port 5500) serving static files from a workspace folder. Controlled via `liveServer.*` commands.
- **Database client** (`commands/database.rs`, `DatabasePanel.tsx`, `DbQueryEditor.tsx`) — connect and run queries against SQLite, MySQL, and PostgreSQL via `sqlx` (`AnyConnection`). Saved connections are persisted by the backend. Exposed as `database.*` commands (`testConnection`, `executeQuery`, `saveConnections`, `loadConnections`, `listSqliteTables`).
- **i18n** (`app/i18n/index.ts`) — Spanish/English, selected via settings and persisted.
- **Theming** (`app/theme/`) — color themes and file icon themes applied via CSS variables on the document root.

## Conventions

- Commits follow `type(scope): description` (e.g. `fix(terminal): handle Windows path separators`).
- Branches: `feat/`, `fix/`, `docs/`, `refactor/`, `perf/`, `ci/`.
- Every PR must link an approved issue (`Closes #N`) and stay under ~400 changed lines.
- AI agent narration and tool arguments use **Spanish** (this is intentional — the agent persona speaks Spanish).
- The renderer uses `window.forgeAPI` everywhere; never call `invoke()` directly outside `tauri-bridge.ts`.
