# Theming and Icon Themes in Quebracho

## Goal
Provide a high-impact visual upgrade now (Aura-like colors + Material-like explorer icons) while keeping a safe architecture that can evolve toward extension compatibility.

## Implemented now

### 1. Color theme engine (runtime)
- Runtime color themes: `forge-dark`, `aura-dark`.
- Theme tokens are exposed as CSS variables in `app/index.css`.
- Tailwind Forge colors now read from CSS variables (runtime switch, no class rebuild).
- Monaco editor supports both themes through `defineMonacoThemes`.
- Integrated terminal (`xterm`) reads palette from theme engine.

Main files:
- `app/theme/appearance.ts`
- `app/index.css`
- `tailwind.config.js`
- `app/components/EditorArea.tsx`
- `app/components/BottomPanel.tsx`

### 2. Explorer icon theme engine
- Runtime icon themes: `material`, `classic`.
- `material` is a Material-like mapping by extension/name.
- `classic` keeps simple generic icons.
- Resolver is centralized and easy to extend.

Main files:
- `app/theme/fileIcons.tsx`
- `app/components/SideBar.tsx`

### 3. Persisted user preferences
- Settings modal exposes:
  - Color theme
  - File icon theme
  - Terminal shell
  - UI language
- Preferences are persisted in backend app config:
  - `colorTheme`
  - `fileIconTheme`
  - `terminalShell`
  - `uiLanguage`

Main files:
- `app/components/SettingsModal.tsx`
- `app/store.ts`
- `app/tauri-bridge.ts`
- `app/types.ts`
- `src-tauri/src/main.rs`

## Decisions and recommendations

### Why partial compatibility instead of full extension runtime
- Security: no third-party JS execution in renderer/main process.
- Stability: no VS Code extension host emulation needed.
- Product speed: implement visual value first, defer heavy infra.
- Maintenance: avoids forks and plugin API churn.

### Near-term recommended path (next iterations)
1. Add import for VS Code `color-theme` JSON.
2. Add import for VS Code `icon-theme` JSON + SVG assets.
3. Support mapped subset first (UI colors, Monaco tokens, file/folder icons).
4. Add validation and fallback diagnostics for unsupported keys.
5. Add attribution/license metadata per imported theme pack.

### Scope intentionally not included yet
- No execution of VS Code extension JavaScript.
- No full compatibility with arbitrary extension contribution points.
- No marketplace integration yet.

## Product notes
- Default icon theme is `material` for immediate visual improvement.
- Theme switching is runtime and should feel instant.
- Terminal is remounted after theme/shell changes so the user sees accurate palette/shell behavior immediately.
