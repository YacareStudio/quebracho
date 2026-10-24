# Propuestas de mejora — Quebracho

Fecha: 2026-10-24 · Base: `687b112` + cambios de esta ronda · Alcance: ~17.200 líneas de TS/TSX y Rust, build, CI y empaquetado. El análisis se hizo en Linux, con foco en el objetivo de **compatibilidad completa con Linux sin dejar de lado Windows y macOS**.

Lo **ya aplicado** está en `INFORME-MANTENIMIENTO-2026-10-24.md`. Este documento reemplaza a `PROPUESTAS-MEJORAS-2026-08-31.md`:

- Ya resueltas de aquel documento: #1 (Monaco local) y #5 (toolchain + `Cargo.lock`).
- Siguen vigentes, reformuladas acá: el resto.

Cada propuesta lleva su evidencia (`archivo:línea`) para no tener que rastrearla de nuevo.

**Prioridad:** **P0** rompe, expone o bloquea · **P1** impacto alto · **P2** mejora de calidad o producto.
**Esfuerzo:** **B** bajo (< 1 día) · **M** medio (1–3 días) · **A** alto (> 3 días).

---

## 1. Multiplataforma (Linux · macOS · Windows)

### 1.1 [P0 · B] CI en las tres plataformas, y encendida
**Evidencia.**
- `.github/workflows/ci.yml` tiene `pull_request`/`push` comentados: solo corre por `workflow_dispatch`.
- Corre solo en `ubuntu-22.04`, así que las ramas `#[cfg(windows)]` y `#[cfg(target_os = "macos")]` (terminal, LSP, child_env, secretos) **nunca se compilan ni se lintean** en CI.

**Propuesta.**
- Reactivar los triggers.
- Usar una matriz `ubuntu-22.04` / `windows-latest` / `macos-latest` para `clippy` y `test`. `build:web` y `typecheck` alcanza con correrlos en uno solo.
- `npm install` → `npm ci`.
- Sumar `Swatinem/rust-cache@v2` y un paso `npm audit --audit-level=high`.

Es la propuesta con mejor retorno: sin ella, cualquier fix de Linux puede romper Windows sin que nadie se entere, y al revés.

### 1.2 [P1 · B] macOS: botones nativos (semáforo)
**Evidencia.** `tauri.conf.json` → `"decorations": false` para todas las plataformas. En macOS se pierden los botones nativos, el gesto de fullscreen y el comportamiento estándar del sistema.

**Propuesta.** Crear `src-tauri/tauri.macos.conf.json` con `"decorations": true`, `"titleBarStyle": "Overlay"` y `"hiddenTitle": true`. En `TitleBar.tsx`, si `platform === 'macos'`, ocultar los botones propios y dejar ~70 px de padding a la izquierda. Tauri fusiona el archivo por plataforma automáticamente.

### 1.3 [P1 · B] Etiquetas de atajos según el OS (⌘ en macOS)
**Evidencia.** Los atajos están escritos "Ctrl+…" a mano:
- `TitleBar.tsx:261-323`
- `CommandPalette.tsx:25-27`
- `EditorArea.tsx:112-120`
- `DbQueryEditor.tsx:161`

Los handlers ya aceptan `metaKey`.

**Propuesta.** Un helper `formatShortcut('mod+shift+p')` en `app/platform.ts` (el archivo ya existe) que devuelva `⌘⇧P` en macOS y `Ctrl+Shift+P` en el resto.

### 1.4 [P1 · B] `tauri-plugin-opener` para abrir URLs y "mostrar en carpeta"
**Evidencia.** No hay forma de abrir la URL del Live Server en el navegador ni de revelar un archivo en el gestor de archivos.

**Propuesta.** `tauri-plugin-opener`, que resuelve `xdg-open` en Linux, `open` en macOS y `explorer` en Windows, con permisos acotados en `capabilities/`. Agregar las acciones "Abrir en navegador" (Live Server) y "Mostrar en el gestor de archivos" (menú contextual del explorador).

### 1.5 [P1 · M] Empaquetado Linux más completo
**Evidencia.**
- `release-tauri.yml` publica `appimage,deb,rpm` y corre en `ubuntu-22.04` (bien: baseline glibc 2.35).
- Solo hay un target macOS (`macos-latest`, Apple Silicon).
- `scripts/validate-release-metadata.mjs:52` solo valida `windows-x86_64`.

**Propuesta.**
- Validar en `latest.json` las entradas `linux-x86_64` y `darwin-*`.
- Agregar `--target x86_64-apple-darwin`, o un build `universal-apple-darwin`.
- Linux ARM64 (`ubuntu-22.04-arm`): Raspberry Pi, Asahi y ARM en la nube.
- Mediano plazo: Flatpak/Flathub, que es el canal que más usuarios de escritorio Linux esperan. Requiere un manifest con `org.gnome.Platform` y permisos de filesystem/red.

### 1.6 [P2 · B] Updater en Linux solo para AppImage
**Evidencia.**
- `tauri.conf.json` → `plugins.updater.active: false`, pero `createUpdaterArtifacts: true`.
- El updater de Tauri en Linux solo se aplica sobre AppImage. En `.deb`/`.rpm` debe actualizar el gestor de paquetes.

**Propuesta.**
- Decidir si se activa el updater.
- Si se activa: en Linux, mostrar "Buscar actualizaciones" solo si `APPIMAGE` está definido. Para `.deb`/`.rpm`, mostrar un link a la página de releases.
- Si no se activa: quitar `createUpdaterArtifacts`. El script de build nuevo ya lo omite en builds locales sin clave.

### 1.7 [P2 · B] El agente no sabe en qué sistema operativo está
**Evidencia.** `app/ai/protocol.ts`: el system prompt no menciona OS, shell ni separador de rutas.

**Propuesta.** Inyectar `Sistema: Linux (bash), separador "/"` o su equivalente. Es imprescindible antes de dar al agente una herramienta `ejecutar_comando` (§4.1).

### 1.8 [P2 · B] Detalles de rutas en Unix
- **Live Server** (`live_server.rs`) rechaza `\` y `:` en los nombres. Son ilegales en Windows, pero válidos en Linux. Condicionar esa regla a `cfg!(windows)`; el rechazo de `..` se mantiene en todas las plataformas.
- **URIs del LSP** (`app/lsp/client.ts:30-43`): `pathToFileUri` usa `encodeURIComponent`, pero Monaco (`uri.toString()`) codifica distinto `( ) ! ' *`. En rutas como `app/(grupo)/page.tsx` de Next.js, `openDocs.has(uri)` falla y el LSP deja de responder en ese archivo, sin aviso. Usar `monaco.Uri.file(path).toString()` en los dos lados.

### 1.9 [P2 · M] Keyring de Linux más robusto
**Evidencia.**
- `storage/keyring.rs:13-21`: el probe hace `set_password` en `setup()`, en el hilo principal.
- Con una colección bloqueada puede trabar el arranque detrás del diálogo de desbloqueo.
- Si un día cae al fallback JSON y otro no, las keys guardadas en JSON "desaparecen".

**Propuesta.**
- Probe de solo lectura (`get_password`, con `NoEntry` = OK) y en un hilo aparte.
- Si el keyring está disponible y existe `quebracho-secrets.json`, migrar su contenido al keyring y borrar el archivo.
- Mostrar en Configuración qué almacén se está usando.

---

## 2. Seguridad

### 2.1 [P0 · B] Ajustar la CSP: ya no hace falta `https:` ni `'unsafe-eval'`
**Evidencia.**
- `tauri.conf.json`: `connect-src 'self' https: …`, `img-src … https:` y `script-src 'self' 'unsafe-eval'`.
- El renderer no hace `fetch`, `XMLHttpRequest` ni `WebSocket`: todo el tráfico de LLM sale por `reqwest` desde Rust.
- Monaco ahora es local (ESM) y no necesita el loader AMD que pedía `unsafe-eval`.

**Por qué.** En un IDE que muestra contenido generado por un modelo, `connect-src https:` es una vía de exfiltración gratis si alguna vez se cuela un XSS.

**Propuesta.**
```
script-src 'self'; worker-src 'self' blob:;
connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:5500;
img-src 'self' data: blob: asset: http://asset.localhost;
```
Probar el editor (workers), el Live Server y el visor de imágenes en las tres plataformas.

### 2.2 [P1 · B] SQL Server: `trust_cert()` incondicional
**Evidencia.** `commands/database.rs:296` → `config.trust_cert()` siempre. Además, `test_sqlserver` (`database.rs:262-272`) solo abre un socket TCP: no autentica, así que "Probar conexión" da OK con credenciales incorrectas.

**Propuesta.**
- Una opción "Confiar en el certificado del servidor", apagada por defecto salvo para `localhost`.
- Que `test_sqlserver` haga `Client::connect` + `SELECT 1`.
- Para MySQL/PostgreSQL, exponer `sslmode`/`ssl-mode` en el formulario.

### 2.3 [P1 · B] Contraseñas de base de datos en texto plano
**Evidencia.** `database.rs:13` → `database-connections.json`, con el campo `password`, en `app_config_dir`.

**Propuesta.** Guardar las contraseñas en el mismo `SecretsStore` que las API keys (keyring, con fallback JSON en 0600) y dejar en el JSON solo una referencia.

### 2.4 [P1 · M] Symlinks que escapan del workspace
**Evidencia.**
- `utils/mod.rs:51-100`: `is_path_within`/`resolve_user_path_in_workspace` validan solo de forma léxica.
- Un symlink dentro del proyecto que apunte a `~/.ssh` permite que `escribir_archivo` del agente, o el editor, escriban fuera del workspace.
- En Linux y macOS los symlinks son cosa de todos los días.

**Propuesta.** En las operaciones de escritura y borrado, `canonicalize()` el padre existente y volver a verificar que está dentro de la raíz canónica. Agregar un test con un symlink a `/tmp`.

### 2.5 [P1 · B] Cadena de suministro
**Propuesta.**
- `cargo deny check advisories licenses` (o `cargo audit`) y `npm audit` en la CI.
- Dependabot/Renovate para npm, Cargo y GitHub Actions.

Las dos rondas de mantenimiento encontraron advisories nuevos de `dompurify`/`vite` que ningún proceso habría detectado solo.

### 2.6 [P2 · B] Límites para el agente
**Evidencia.** `runtime.ts`: `escribir_archivo` pasa por `PendingDiff` (bien), pero no tiene tope de tamaño ni lista de rutas protegidas.

**Propuesta.**
- Tope igual a `MAX_FILE_BYTES` (1 MB, `utils/mod.rs:8`).
- Bloquear escrituras en `.git/`, `.quebracho/` y `.env*`, salvo confirmación explícita.
- Marcar en el diff cuando el archivo leído contiene instrucciones dirigidas al agente (mitigación básica de prompt injection).

---

## 3. Velocidad y rendimiento

### 3.1 [P1 · B] Inteligencia TypeScript duplicada (Monaco + LSP)
**Evidencia.**
- Ahora que Monaco va empaquetado, su worker de TypeScript (`ts.worker`, 6,9 MB) está activo.
- `lsp/client.ts:267-270` además registra completions y hover del `typescript-language-server` para los mismos lenguajes.
- Resultado: sugerencias duplicadas en el autocompletado y dos motores de TS consumiendo CPU y RAM.

**Propuesta.** Cuando el LSP arranca bien, desactivar las funciones equivalentes del worker con `typescriptDefaults.setModeConfiguration({ completionItems: false, hovers: false, diagnostics: false })` (lo mismo para `javascriptDefaults`). Si el LSP no está disponible, dejar el worker como fallback. Así el producto funciona aun sin Node instalado, que es frecuente en Linux recién instalado.

### 3.2 [P1 · M] Árbol de archivos perezoso
**Evidencia.**
- `fs.rs` → `read_directory_recursive` lee todo el árbol hasta profundidad 10 al abrir el workspace.
- `store.ts:822-836` vuelve a leerlo **entero** en cada evento `fs:changed`.
- En monorepos eso son miles de `stat` por cada guardado.

**Propuesta.** Leer un nivel por llamada (`read_directory(path, depth=1)`) y expandir bajo demanda. Ante un `fs:changed`, refrescar solo el directorio padre del path afectado; el evento ya trae `path`.

### 3.3 [P1 · B] Archivos grandes congelan el editor
**Evidencia.** `fs.rs` → `read_file` usa `read_to_string` sin límite. Abrir un log de 300 MB lo copia entero por IPC y a Monaco.

**Propuesta.**
- Avisar sobre 5 MB y ofrecer modo solo lectura sin resaltado.
- Rechazar o paginar sobre ~50 MB.
- Detectar binarios (byte NUL en los primeros 8 KB) y mostrar "archivo binario".

### 3.4 [P2 · B] Lazy-loading de paneles y de Monaco
**Evidencia.** Chunk principal 458 kB + `vendor-monaco` 4,5 MB, que se carga antes del primer render. `DatabasePanel` (622 líneas), `SettingsModal`, `CommandPalette` y `FindReplaceOverlay` se usan poco.

**Propuesta.** `React.lazy` para esos paneles, e importar `monaco-loader` dinámicamente al abrir la primera pestaña. Mejora el arranque en frío, que se nota sobre todo en WebKitGTK.

### 3.5 [P2 · B] Perfil `release` optimizado
**Evidencia.** `Cargo.toml` no tiene `[profile.release]`.

**Propuesta.**
```toml
[profile.release]
lto = "thin"
codegen-units = 1
strip = true
```
Reduce el binario (hoy el `.deb` pesa 14,2 MB) y mejora un poco el rendimiento. Cuesta más tiempo de compilación solo en release.

### 3.6 [P2 · B] Eventos del watcher
**Evidencia.** `fs.rs`: el debounce emite solo el **último** evento de cada ráfaga y descarta los demás paths.

**Propuesta.** Emitir el lote (`Vec<FsChangeEvent>`, deduplicado por path). Es necesario para el refresco por directorio de §3.2 y para recargar pestañas abiertas modificadas desde afuera (§4.6).

---

## 4. Funcionalidad

### 4.1 [P1 · M] Herramientas del agente: `editar_archivo` y `ejecutar_comando`
**Evidencia.** `protocol.ts:78-81`: solo hay 4 herramientas. Cada retoque de una línea reescribe el archivo entero por el stream, y el agente no puede correr tests ni builds.

**Propuesta.**
1. `editar_archivo(ruta, buscar, reemplazar)`, que reutiliza `PendingDiff`.
2. `ejecutar_comando(comando)` con confirmación explícita, en el PTY de `terminal.rs`, con salida truncada y timeout. Depende de §1.7 (que el agente conozca el OS y el shell).

### 4.2 [P1 · A] Control de versiones (Git)
**Evidencia.** `SideBar.tsx:915`: el panel "Control de código fuente" es un `PlaceholderPanel`.

**Propuesta.**
- Primera iteración llamando al CLI `git` desde Rust (presente en casi todo Linux/macOS): estado, diff contra `HEAD` en el editor de diffs que ya existe (`diff` está en las dependencias), stage/unstage, commit y rama actual en la barra de estado.
- Más adelante, evaluar `gix` para no depender del binario.

### 4.3 [P1 · M] Live Server con recarga automática y puerto libre
**Evidencia.** `live_server.rs`: puerto fijo 5500 (el mismo que usa la extensión de VS Code), sin watcher ni inyección de script.

**Propuesta.**
- Barrer 5500–5510 y quedarse con el primer puerto libre.
- Recargar con SSE (`tiny_http` lo soporta sin crates nuevos) usando el watcher que ya existe.
- Servir `index.html` en subdirectorios.
- Botón "Abrir en navegador" (§1.4).

### 4.4 [P2 · M] Base de datos: explorador de esquema para MySQL/PostgreSQL
**Evidencia.** `db_list_sqlite_tables` y `db_list_tables` solo listan tablas. No hay columnas, tipos ni índices, y tampoco cancelación de consultas largas.

**Propuesta.**
- Árbol tabla → columnas a partir de `information_schema`.
- Límite de filas por defecto (p. ej. 1.000) con "cargar más".
- Botón para cancelar la consulta.

### 4.5 [P2 · B] Proyectos recientes
**Evidencia.** `fs.rs` → `remember_workspace` guarda solo `last_workspace`.

**Propuesta.** Guardar una lista de los últimos 10 proyectos, accesible desde "Archivo → Abrir reciente" y desde la pantalla de bienvenida (§5.5).

### 4.6 [P2 · B] Recargar pestañas modificadas desde afuera
Cuando `git checkout`, un formateador o el propio agente cambian un archivo abierto, la pestaña sigue mostrando el contenido viejo.

**Propuesta.** Con los eventos del watcher (§3.6):
- Si la pestaña no tiene cambios, recargarla.
- Si tiene cambios, mostrar el aviso "El archivo cambió en disco".

### 4.7 [P2 · B] Configuración del editor
Agregar en Configuración tamaño de fuente, tamaño de tabulación, ajuste de línea, minimapa y formato al guardar. Hoy están fijos en `EditorArea.tsx:60-70`.

---

## 5. UI / UX

### 5.1 [P1 · B] Accesibilidad: no hay ningún `aria-label`
**Evidencia.** `grep -c aria-label app/components` da **0**. Los botones solo con ícono (ventana, barra de actividad, acciones de paneles) no tienen nombre accesible ni `title`.

**Propuesta.**
- `aria-label` + `title` (traducidos con i18n) en todos los botones de ícono.
- `:focus-visible` con contraste.
- Navegación con teclado en el árbol de archivos (flechas).
- Orca en Linux y VoiceOver en macOS dependen de esto.

### 5.2 [P1 · B] Tema claro y seguir la preferencia del sistema
**Evidencia.** `theme/appearance.ts:3` → solo `quebracho-dark` y `aura-dark`.

**Propuesta.** Agregar un tema claro y la opción "Según el sistema" (`prefers-color-scheme`). WebKitGTK la toma de GNOME/KDE y WKWebView de macOS. Monaco y xterm ya reciben el tema desde `appearance.ts`.

### 5.3 [P1 · B] Errores visibles en vez de `console.error`
**Evidencia.**
- `store.ts:721-724`: si el watcher falla, solo hay un `console.error`.
- Si `typescript-language-server` no está, el autocompletado desaparece sin aviso.

**Propuesta.**
- Indicador en la barra de estado ("LSP: no disponible — instalar con `npm i -g typescript-language-server`") con acción para reintentar.
- Toasts para errores de E/S.

### 5.4 [P2 · B] Ocultar lo que todavía no existe
**Evidencia.** "Cuenta" (`ActivityBar.tsx`) muestra "función no disponible", y "Control de código fuente" es un placeholder.

**Propuesta.** Ocultarlos detrás de un flag hasta que existan. Un botón que no hace nada transmite producto inacabado.

### 5.5 [P2 · M] Pantalla de bienvenida
Abrir carpeta, proyectos recientes (§4.5), atajos clave según el OS (§1.3) y un estado de dependencias: Node, `typescript-language-server`, git, API key configurada. En Linux esto ahorra el "¿por qué no anda X?" de las instalaciones mínimas.

### 5.6 [P2 · M] Atajos configurables
Mapa de atajos en un JSON de configuración, con detección de conflictos. Especialmente útil en Linux, donde el escritorio (GNOME/KDE) reserva combinaciones distintas.

---

## 6. Estabilidad y mantenibilidad

### 6.1 [P0 · M] Tests de frontend (vitest)
**Evidencia.** 42 tests en Rust y **0** en `app/`. Los bugs más caros del historial fueron de frontend:
- la corrupción por `\uXXXX` en `streamRouter.ts`;
- las condiciones de carrera documentadas en `EditorArea.tsx`.

**Propuesta.** `vitest`, empezando por funciones puras:

| Archivo | Qué cubrir |
|---|---|
| `ai/streamRouter.ts` | escapes y chunks cortados en el medio de un escape |
| `ai/protocol.ts` | `parseAssistantTurn` |
| `ai/runtime.ts` | `relativize` |
| `i18n/index.ts` | mismas claves en ES y EN |
| `store.ts` | quoting de `sendCdToActiveTerminal` (POSIX y Windows) |

Después, `npm run test` = `vitest run && cargo test`.

### 6.2 [P1 · B] Error boundary en React
**Evidencia.** No hay ningún `ErrorBoundary` en `app/`. Una excepción en un panel (p. ej. una respuesta inesperada de la base de datos) deja la ventana en blanco.

**Propuesta.** Un boundary por panel (sidebar, editor, panel inferior, IA) con "Reintentar" y el error copiable.

### 6.3 [P1 · M] Partir `app/store.ts` (1.494 líneas) en slices
Separar workspace, editor, IA, paneles y settings con el patrón de slices de Zustand, sin cambiar la API pública. Facilita los tests de §6.1 y reduce los conflictos de merge.

### 6.4 [P2 · B] Coherencia de la configuración de build
`bundle.targets: "all"` en la config contrasta con la política de bundles por OS (ahora en `scripts/build-desktop.mjs`). Conviene documentar en `AGENTS.md` que la fuente de verdad es el script o la matriz de release.

### 6.5 [P2 · B] CHANGELOG y `.gitattributes`
- **CHANGELOG:** sigue en `0.0.1`. Faltan 0.0.2 y 0.0.3 (cliente de base de datos, Live Server, etc.) y esta ronda de compatibilidad con Linux.
- **`.gitattributes`:** con desarrollo en Windows y Linux a la vez, hace falta uno con `* text=auto eol=lf` y `*.png binary`. Para que el ruido quede aislado, aplicarlo con `git add --renormalize .` en un commit propio.

### 6.6 [P2 · B] Limpiar la raíz del repo
Hay dos generaciones de informes (`*-2026-08-31.md`, `*-2026-10-24.md`) y un `prompt-logo.md` en la raíz.

**Propuesta.** Moverlos a `docs/mantenimiento/` y dejar en la raíz solo README, CHANGELOG, CONTRIBUTING, LICENSE, AGENTS y CLAUDE.

---

## Resumen

| # | Área | Prioridad | Propuesta | Esfuerzo |
|---|---|---|---|---|
| 1.1 | Multiplataforma | P0 | CI en Linux/Windows/macOS, encendida | B |
| 2.1 | Seguridad | P0 | CSP sin `https:` ni `unsafe-eval` | B |
| 6.1 | Estabilidad | P0 | Tests de frontend con vitest | M |
| 1.2 | Multiplataforma | P1 | Botones nativos en macOS | B |
| 1.3 | Multiplataforma | P1 | Atajos ⌘/Ctrl según el OS | B |
| 1.4 | Multiplataforma | P1 | `tauri-plugin-opener` | B |
| 1.5 | Multiplataforma | P1 | Empaquetado: macOS Intel/universal, Linux ARM, Flatpak | M |
| 2.2 | Seguridad | P1 | SQL Server: TLS configurable y test real | B |
| 2.3 | Seguridad | P1 | Contraseñas de base de datos en el keyring | B |
| 2.4 | Seguridad | P1 | Canonicalizar symlinks al escribir | M |
| 2.5 | Seguridad | P1 | `cargo deny`, `npm audit`, Dependabot | B |
| 3.1 | Rendimiento | P1 | Evitar TS duplicado (Monaco + LSP) | B |
| 3.2 | Rendimiento | P1 | Árbol de archivos perezoso | M |
| 3.3 | Rendimiento | P1 | Límite y modo para archivos grandes | B |
| 4.1 | Funcional | P1 | `editar_archivo` / `ejecutar_comando` | M |
| 4.2 | Funcional | P1 | Panel de Git | A |
| 4.3 | Funcional | P1 | Live Server con recarga y puerto libre | M |
| 5.1 | UI/UX | P1 | Accesibilidad (`aria-label`, foco, teclado) | B |
| 5.2 | UI/UX | P1 | Tema claro + preferencia del sistema | B |
| 5.3 | UI/UX | P1 | Errores visibles (LSP, watcher) | B |
| 6.2 | Estabilidad | P1 | Error boundaries | B |
| 6.3 | Estabilidad | P1 | `store.ts` en slices | M |
| 1.6–1.9 | Multiplataforma | P2 | Updater Linux, OS en el prompt, URIs/Live Server, keyring | B–M |
| 2.6 | Seguridad | P2 | Límites del agente | B |
| 3.4–3.6 | Rendimiento | P2 | Lazy-loading, perfil release, lote de eventos | B |
| 4.4–4.7 | Funcional | P2 | Esquema de base de datos, recientes, recarga de pestañas, settings del editor | B–M |
| 5.4–5.6 | UI/UX | P2 | Ocultar placeholders, bienvenida, atajos configurables | B–M |
| 6.4–6.6 | Estabilidad | P2 | Config de build, CHANGELOG, `.gitattributes`, raíz | B |

**Si hay que elegir tres:**
1. **1.1 (CI en las tres plataformas).** Es la única forma de sostener "Linux completo sin romper Windows ni macOS".
2. **3.1 (TS duplicado).** Es una regresión visible que aparece justo ahora, al empaquetar Monaco.
3. **6.1 (tests de frontend).** Ahí ocurrieron todos los bugs caros del historial.

## Lo que se revisó y está bien

- **Selección de shell** (`terminal.rs`): Unix usa `$SHELL` → bash/zsh/sh/fish, con orden propio en macOS. Todo `#[cfg(windows)]` tiene su contraparte.
- **Contención de rutas** (`utils/mod.rs`): case-sensitive con `/` en Unix; case-insensitive solo en Windows. Tiene tests.
- **Helpers de rutas del frontend** (`relativize`, `joinPath`, `dirname`): detectan el separador y funcionan con `/home/...`.
- **Búsqueda** (`search.rs`): `walkdir` sin seguir symlinks, exclusiones multiplataforma, maneja `\r\n`.
- **Keyring en Linux:** `keyring` 4 trae Secret Service en Rust puro (`zbus`), sin `libdbus`. El fallback JSON funciona (y ahora en 0600).
- **Puente IPC** (`tauri-bridge.ts`): sigue 1:1 con `generate_handler![]`.
- **Credenciales en el DSN** de MySQL/PostgreSQL: van URL-encodeadas.
- **Release Linux:** `ubuntu-22.04`, `libwebkit2gtk-4.1-dev` y `patchelf` correctos en `release-tauri.yml`.
