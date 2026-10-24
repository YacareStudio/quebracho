# Informe de mantenimiento — 2026-10-24

Actualización de dependencias (npm y Rust), fixes de compatibilidad con **Linux** (sin romper Windows ni macOS) y verificación completa sobre `687b112`. Continúa `INFORME-MANTENIMIENTO-2026-08-31.md`.

Las propuestas que **no** se aplicaron están en **`PROPUESTAS-MEJORAS-2026-10-24.md`**.

---

## 1. Verificación — esta vez completa, y en Linux

En la ronda de agosto los checks de Rust no se pudieron correr (no había toolchain). Esta vez se corrieron todos, en Linux (YacareOS / Debian 13):

| Check | Resultado |
|---|---|
| `npm run typecheck` (TypeScript 7.0.2) | ✅ |
| `npm run build:web` (Vite 8.3.5) | ✅ |
| `cargo fmt --check` | ✅ |
| `cargo clippy --all-targets` | ✅ sin warnings |
| `cargo test` | ✅ **42 tests** (eran 37; +5 nuevos) |
| `npm audit` | ✅ 0 vulnerabilidades (antes: 1 crítica + 2 altas) |
| `npm run build` → `.deb` en Linux | ✅ `Quebracho_0.0.3_amd64.deb` (14,2 MB, depende de `libwebkit2gtk-4.1-0`, `libgtk-3-0`) |
| Smoke test de Monaco empaquetado (Chrome headless) | ✅ monta, colorea y el worker de TS devuelve diagnósticos en ~1,2 s |

Con esto también quedan verificados los cambios de agosto que nunca se habían compilado (`base64` 0.23, el fix de path traversal del Live Server y sus 5 tests).

> **Cómo se compiló sin `sudo`:** Rust se instaló con `rustup` en `~/.cargo` sin tocar el PATH (`--no-modify-path`). Los `-dev` de webkit2gtk/gtk/libsoup se bajaron con `apt-get download` y se extrajeron en una carpeta temporal. Para trabajar normalmente en esta máquina conviene instalarlos de verdad:
> ```bash
> sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev patchelf
> echo 'source "$HOME/.cargo/env"' >> ~/.bashrc
> ```

## 2. Dependencias npm

| Paquete | Antes | Después |
|---|---|---|
| `react` / `react-dom` | 19.2.8 | **19.3.1** |
| `@types/react` / `@types/react-dom` | 19.2.18 / 19.2.5 | **19.3.0** |
| `@tauri-apps/api` | 2.11.1 | **2.12.4** |
| `@tauri-apps/cli` | 2.11.4 | **2.12.4** |
| `@tauri-apps/plugin-dialog` | 2.7.3 | **2.8.3** |
| `@tauri-apps/plugin-clipboard-manager` | 2.3.3 | **2.5.0** |
| `monaco-editor` | 0.56.0 | **0.57.0** |
| `lucide-react` | 1.38.0 | **1.61.0** |
| `zustand` | 5.0.15 | **5.0.16** |
| `vite` | 8.2.2 | **8.3.5** (corrige 6 advisories de vite/launch-editor) |
| `@vitejs/plugin-react` | 6.1.1 | **6.1.2** |
| `overrides.dompurify` | ^3.4.14 | **^3.4.17** (corrige 5 advisories, 1 crítico) |

Ya estaban al día: `@monaco-editor/react` 4.7.0, `@xterm/*`, `diff` 9.0.0, `tailwindcss` 4.3.3, `typescript` 7.0.2. `source-map-js` (advisory alto) quedó corregido por el lockfile nuevo.

## 3. Dependencias Rust (`src-tauri/Cargo.toml` + `Cargo.lock` regenerado)

| Crate | Antes | Después |
|---|---|---|
| `tauri` / `tauri-build` | 2.11.5 / 2.6.3 | **2.12.5 / 2.7.4** |
| `tauri-plugin-updater` | 2.11.0 | **2.14.0** |
| `tauri-plugin-dialog` | 2.7.3 | **2.8.3** |
| `tauri-plugin-clipboard-manager` | 2.3.3 | **2.5.0** |
| `tiberius` | 0.12.3 | **0.13.0** (major; compila sin cambios de código) |
| `tokio` / `tokio-util` | 1.53 / 0.7.19 | **1.54 / 0.7.20** |
| `reqwest` | 0.13.4 | **0.13.5** |
| `uuid` | 1.26 | **1.29** |
| `serde` / `serde_json` | 1.0.228 / 1.0.150 | **1.0.229 / 1.0.154** |
| `thiserror`, `regex`, `bytes` | — | último patch |

`Cargo.lock` estaba desfasado del `Cargo.toml` (por ejemplo, `keyring` 4.1.4 contra el requisito `4.2`): un build con `--locked` habría fallado. Ahora quedó regenerado.

Sin cambios: `notify` 8.2 (la 9 sigue en RC), `sqlx` 0.9.0, `portable-pty` 0.9.0, `tiny_http` 0.12.0, `keyring` 4.2.0 y `wiremock` 0.6.5, que ya estaban en su última versión. Los plugins de Tauri 3.0 siguen en alpha.

## 4. Fix crítico: Monaco empaquetado localmente

`@monaco-editor/react` bajaba el editor de jsDelivr en runtime. La CSP del build empaquetado (`script-src 'self'`) bloquea ese `<script>`, así que **en el instalador el editor no podía cargar**. Además no funcionaba sin internet.

- `app/monaco-loader.ts` ahora importa `monaco-editor` desde npm y registra los workers (editor, TS/JS, JSON, CSS, HTML) con `?worker` de Vite. Son archivos same-origin, compatibles con la CSP.
- Desaparece el pin manual de versión: el runtime es siempre el paquete instalado.
- `vite.config.ts`: `chunkSizeWarningLimit` ajustado (el chunk de Monaco pesa 4,5 MB por diseño y se carga del disco).

## 5. Fixes de compatibilidad con Linux (y macOS)

| # | Problema | Fix | Archivos |
|---|---|---|---|
| 1 | **La ventana no se podía arrastrar** en Linux/macOS: `-webkit-app-region` solo existe en Electron/WebView2, y la ventana no tiene decoraciones | `onMouseDown` en la barra de título → `startDragging()`; doble clic maximiza/restaura; permiso `core:window:allow-start-dragging` | `TitleBar.tsx`, `tauri-bridge.ts`, `types.ts`, `capabilities/default.json` |
| 2 | **`rootUri` del LSP mal formado** en Unix (`file:////home/...`) | `Url::from_directory_path` + `workspaceFolders`; tests por plataforma | `commands/lsp.rs` |
| 3 | **LSP sin `npx`** cuando la app se abre desde el menú o el Dock (PATH mínimo, sin nvm/Homebrew) | Se lee el PATH del login shell en segundo plano al arrancar (con timeout de 5 s). Se prefiere `node_modules/.bin/typescript-language-server` del proyecto, y así `kill()` llega al proceso real | `utils/child_env.rs` (nuevo), `commands/lsp.rs`, `main.rs` |
| 4 | **Terminal sin `TERM`/`COLORTERM`/`LANG`** si la app se abre desde el escritorio (sin colores; `vim`/`htop`/`clear` fallan) | Se definen `TERM=xterm-256color`, `COLORTERM=truecolor` y `LANG` cuando falta. En macOS el shell arranca como login (`-l`), para que lea `.zprofile` | `commands/terminal.rs`, `utils/child_env.rs` |
| 5 | **Caracteres UTF-8 rotos en la terminal** (`�`) cuando un carácter multibyte queda partido entre dos lecturas: prompts powerline, emoji, tildes | `Utf8StreamDecoder` que retiene los bytes incompletos; 2 tests | `commands/terminal.rs` |
| 6 | **Agotamiento de inotify**: el watcher recursivo entraba en `node_modules`/`target`/`.git` y podía consumir el `max_user_watches` del usuario, que comparten todas las apps | En Linux, un watch por carpeta relevante (saltea las ignoradas) y se agregan watches al crearse carpetas nuevas. Se descartan los eventos de carpetas ignoradas: `cargo build` ya no inunda el árbol. macOS/Windows siguen con watch recursivo (un solo handle) | `commands/fs.rs` |
| 7 | **Atajos globales robaban teclas a la terminal**: Ctrl+B (tmux/readline), Ctrl+F, Ctrl+H (backspace), Ctrl+S | Con el foco en xterm, los Ctrl+letra van al shell; Ctrl+` y Ctrl+Shift+P siguen funcionando | `App.tsx` |
| 8 | **Pegar con Ctrl+V** en la terminal pisaba el *quoted-insert* de bash y el *visual-block* de vim | Convención de cada OS: Cmd+V en macOS, Ctrl+Shift+V en Linux, Ctrl+V en Windows | `BottomPanel.tsx`, `platform.ts` (nuevo) |
| 9 | `cd` al workspace usaba comillas dobles: `$` y backticks del path se expandían en shells POSIX | Comillas simples con escape POSIX fuera de Windows | `store.ts` |
| 10 | **API keys legibles por otros usuarios**: el fallback JSON de secretos se escribía en modo 0644 | Escritura con modo `0600` (y corrige archivos ya existentes) | `storage/secrets.rs` |
| 11 | **AppImage**: las variables del runtime (`APPDIR`, `GTK_PATH`, `GIO_MODULE_DIR`, …) llegaban a la terminal y al LSP | Se eliminan del entorno de los procesos hijos | `utils/child_env.rs` |
| 12 | **Bucle con symlinks a carpetas** en el árbol (p. ej. `lib64 -> lib` de un virtualenv), y un `stat` por cada comparación del sort | Los symlinks a carpetas se listan pero no se expanden; un solo `stat` por entrada | `commands/fs.rs` |
| 13 | Fuentes monoespaciadas solo de Windows | Stack con `SF Mono`, `Menlo`, `DejaVu Sans Mono`, `Liberation Mono`, `Ubuntu Mono`, `Noto Sans Mono` | `platform.ts`, `EditorArea.tsx`, `BottomPanel.tsx` |
| 14 | **`npm run build` solo generaba NSIS** y fallaba en Linux/macOS | `scripts/build-desktop.mjs` elige los bundles según el OS (Windows conserva NSIS). Nuevos `build:win`, `build:linux`, `build:mac`. Sin `TAURI_SIGNING_PRIVATE_KEY` omite los artefactos firmados del updater, así el build local no falla al final | `package.json`, `scripts/build-desktop.mjs` (nuevo), `README.md`, `CLAUDE.md` |
| 15 | README recomendaba `libwebkit2gtk-4.0-dev`, que Tauri 2 no soporta | Corregido; nota sobre `WEBKIT_DISABLE_DMABUF_RENDERER=1` (NVIDIA/Wayland) | `README.md` |
| 16 | **Selects ilegibles en Linux** (detectado al probar la app): WebKitGTK dibuja `<select>` con el tema GTK claro, con texto claro sobre fondo blanco | `color-scheme: dark` global; `select` con `appearance: none`, colores del tema y chevron propio; mismo aspecto en los tres OS | `index.css`, `SettingsModal.tsx` |

## 6. Fixes de estabilidad y rendimiento

**Comandos bloqueantes en el hilo principal.** En Tauri, un `#[tauri::command]` síncrono corre en el hilo principal (el de la UI). `lsp_request` esperaba hasta **12 s** la respuesta del servidor ahí, y además con el lock de `LspState` tomado. Cada autocompletado lento congelaba la ventana, algo especialmente visible con GTK en Linux, y todas las llamadas al LSP quedaban en fila detrás de la más lenta. Lo mismo pasaba con `read_directory` (recorre el árbol entero) y `workspace_search`/`workspace_replace`.

- Esos 6 comandos (`lsp_start`, `lsp_request`, `lsp_notification`, `read_directory`, `workspace_search`, `workspace_replace`) pasan a `#[tauri::command(async)]`: corren en el pool de hilos y no en el de la UI.
- `lsp_request` suelta el lock antes de esperar y, si hay timeout, borra la entrada de `pending` (antes quedaba colgada para siempre).

**Timeout de conexión para los proveedores de IA.** `HTTP_CLIENT` (`lib.rs`) no tenía timeouts: con un host inalcanzable (sin red, VPN caída, URL de Ollama mal escrita) el panel de IA quedaba "pensando" para siempre. Ahora tiene `connect_timeout` de 15 s. A propósito no se puso timeout total, porque cortaría streams largos legítimos.

## 7. Qué falta probar a mano

No se pudo abrir la GUI en esta máquina (faltan los procesos auxiliares de WebKitGTK del sistema). Antes de publicar, conviene un smoke test en cada OS:

1. **Linux/macOS:** arrastrar la ventana desde la barra de título; doble clic para maximizar.
2. Abrir un `.ts`: autocompletado y hover (LSP), resaltado y errores (Monaco).
3. Terminal: colores, `vim`, una tilde/emoji en el prompt, Ctrl+B en bash, pegar con el atajo del OS.
4. **Windows:** confirmar que el arrastre, Ctrl+V en la terminal y `npm run build` (NSIS) se comportan igual que antes.

## 8. Archivos

```
nuevos:      app/platform.ts, scripts/build-desktop.mjs, src-tauri/src/utils/child_env.rs,
             src-tauri/gen/schemas/linux-schema.json (generado por Tauri)
modificados: app/{App,store,tauri-bridge,types,monaco-loader}.ts(x), app/components/{TitleBar,BottomPanel,EditorArea,SettingsModal}.tsx,
             src-tauri/src/{lib,main}.rs, src-tauri/src/commands/{fs,lsp,search,terminal}.rs, src-tauri/src/storage/secrets.rs,
             src-tauri/src/utils/mod.rs, src-tauri/capabilities/default.json, src-tauri/gen/schemas/*,
             package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, vite.config.ts, README.md, CLAUDE.md
```

Sin commits: los cambios quedaron en el working tree.
