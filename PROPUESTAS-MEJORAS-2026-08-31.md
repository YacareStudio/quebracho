# Propuestas de mejora — Quebracho

Fecha: 2026-08-31 · Base: `1d5d989` · Alcance analizado: ~12.000 líneas de TS/TSX (`app/`) + ~5.100 de Rust (`src-tauri/src/`), configuración de build, CI y empaquetado.

Lo ya **aplicado** en esta ronda está en `INFORME-MANTENIMIENTO-2026-08-31.md`. Acá va solo lo que **no** se aplicó, ordenado por impacto. Cada punto lleva la evidencia que lo respalda, para que no haya que rastrearla de nuevo.

Prioridades: **P0** rompe o expone la app · **P1** deuda que frena el desarrollo · **P2** calidad y producto.

---

## 1. [P0] Empaquetar Monaco localmente en vez de bajarlo de un CDN

**Evidencia.** `@monaco-editor/react` no consume el paquete `monaco-editor` instalado: su loader inyecta un `<script src="https://cdn.jsdelivr.net/npm/monaco-editor@<ver>/min/vs/loader.js">` en runtime. Se ve en el bundle compilado (`grep cdn.jsdelivr.net dist/assets/*.js`) y en que `monaco-editor` solo aparece en el código como `import type` (`EditorArea.tsx:5`, `FindReplaceOverlay.tsx:2`, `lsp/client.ts:17`). El chunk `vendor-monaco` pesa 21 kB: es el loader, no el editor.

**Por qué importa.**

- **La CSP del build empaquetado lo bloquea.** `src-tauri/tauri.conf.json` declara `script-src 'self' 'unsafe-eval'`, sin `cdn.jsdelivr.net`. En `npm run dev` la CSP no se aplica (el contenido viene de `devUrl`, un origen externo), así que el editor anda; en el instalador NSIS, donde el contenido se sirve por el protocolo custom, el `<script>` del CDN debería quedar bloqueado y el editor no montar. **Verificar esto con un build real es el primer paso** — es la diferencia entre "hay que empaquetar Monaco" y "la app no tiene editor en producción".
- **Un IDE que no abre archivos sin internet.** Aunque la CSP lo permitiera, la primera carga requiere red.
- **La superficie de seguridad real no la controla npm.** El `overrides.dompurify` del `package.json` cubre el árbol de npm, no el bundle `min/vs` del CDN, que trae su propio dompurify inlineado. La mitigación aplicada (fijar el loader a 0.56.0, que ya tiene el dompurify parcheado) tapa el agujero de hoy, no el mecanismo.
- **Ejecución de código de terceros en un IDE.** Un compromiso del CDN es ejecución arbitraria dentro de un proceso que ya tiene acceso al filesystem y a las API keys.

**Cómo.**

```ts
// app/monaco-loader.ts — reemplaza el pin actual
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });
```

Suma ~5 MB al bundle (aceptable en una app de escritorio) y **elimina toda dependencia de red del editor**. Requiere un smoke test manual real: abrir un `.ts`, un `.json` y un `.css`, verificar syntax highlighting, autocompletado y el flujo de streaming del agente hacia el editor.

**Bonus.** Con Monaco local se puede evaluar sacar `'unsafe-eval'` de la CSP: lo pide el loader AMD del build `min/vs`, no el ESM.

## 2. [P0] La CI está apagada

**Evidencia.** `.github/workflows/ci.yml`:

```yaml
on:
  # pull_request:
  # push:
  #   branches:
  #     - main
  workflow_dispatch:
```

**Por qué importa.** Ningún PR se valida automáticamente. Sumado a que esta máquina ya no tiene toolchain de Rust, hoy **no hay ningún lugar donde se compile el backend**. Es la razón por la que los cambios de `Cargo.toml` de esta ronda quedaron sin verificar.

**Cómo.** Descomentar los triggers. Y en el mismo movimiento:

- `npm install` → **`npm ci`**: es lo correcto en CI (respeta el lockfile, falla si está desincronizado) y es más rápido con `cache: npm`.
- Agregar un paso `npm audit --audit-level=moderate` para que los advisories nuevos —como el de dompurify de esta ronda— aparezcan solos.
- Cachear el target de Rust (`Swatinem/rust-cache@v2`); sin eso cada corrida recompila Tauri entero y el feedback tarda ~10 min.

## 3. [P0] Cero pruebas de frontend

**Evidencia.** 32 tests en Rust (`grep -rn '#\[test\]' src-tauri/src`), **0** en `app/`. `npm run test` es solo `cargo test`. La lógica más delicada del producto vive en el renderer.

**Por qué importa.** Los tres bugs más caros del historial reciente fueron todos de frontend: la corrupción de archivos por escapes `\uXXXX` en `streamRouter.ts` (informe de julio §3) y las dos condiciones de carrera documentadas a mano en los comentarios de `EditorArea.tsx:355-380`. Son exactamente el tipo de bug que un test unitario atrapa en un segundo y una revisión visual no.

**Cómo.** `vitest` + `@testing-library/react`, empezando por lo puro (sin DOM, alto retorno):

| Objetivo | Qué cubrir |
|---|---|
| `ai/streamRouter.ts` | el parser incremental de JSON: escapes `\n \" \\ \uXXXX`, pares sustitutos, chunks cortados en el medio de un escape |
| `ai/protocol.ts` | `parseAssistantTurn`: bloques `<tool>` múltiples, JSON inválido, texto mezclado con tool calls |
| `ai/runtime.ts` | `relativize` (hoy tiene una heurística frágil de separadores en la línea 41) |
| `i18n/index.ts` | que ES y EN tengan exactamente el mismo juego de claves |
| `theme/appearance.ts` | mapeo de tokens a variables CSS |

Después, `npm run test` = `vitest run && cargo test`, y `ci:check` lo hereda.

## 4. [P1] CSP más restrictiva de lo que hoy declara

**Evidencia.** `tauri.conf.json`: `connect-src 'self' https: http://localhost:* http://127.0.0.1:*` y `img-src 'self' data: blob: asset: https:`.

**Por qué importa.** `connect-src https:` habilita al renderer a hablar con cualquier host. Y **no lo necesita**: `grep -rn "fetch(\|XMLHttpRequest\|new WebSocket" app/` no devuelve nada — todo el tráfico de LLM sale por `reqwest` desde Rust. El renderer solo habla por IPC. En un IDE que ejecuta código generado por un modelo, ese `https:` es una vía de exfiltración gratis.

**Cómo.** Una vez resuelto el punto 1 (que hoy es el único consumidor real de red del renderer):

```
connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:5500;
img-src 'self' data: blob: asset: http://asset.localhost;
```

Probar bien el Live Server y el visor de imágenes después del cambio; son los dos que tocan orígenes no-`self`.

## 5. [P1] Regenerar `Cargo.lock` y decidir qué pasa con el toolchain de Rust

**Evidencia.** No hay `cargo`, `rustc` ni `~/.cargo` en esta máquina (se buscó en todo `C:\`). `src-tauri/target/` existe, de builds anteriores.

**Por qué importa.** Sin toolchain no se puede correr `npm run dev` (Tauri necesita compilar el backend), ni `npm run build`, ni los tests. El desarrollo queda limitado a `npm run dev:web`.

**Cómo.** `rustup` con el target `x86_64-pc-windows-msvc` (las Build Tools de Visual Studio y el Windows SDK 10 ya están instalados en la máquina, así que el linker está resuelto). Después:

```bash
cargo update --manifest-path src-tauri/Cargo.toml
npm run ci:check
```

## 6. [P1] El Live Server no recarga y no tolera el puerto ocupado

**Evidencia.** `src-tauri/src/commands/live_server.rs`: `Server::http(("127.0.0.1", LIVE_SERVER_PORT))` con `const LIVE_SERVER_PORT: u16 = 5500` y, si falla, `Err("live server bind failed")`. El loop de request solo lee del disco y responde: no hay watcher, ni WebSocket, ni inyección de script.

**Por qué importa.** "Live Server" es el nombre que la extensión de VS Code volvió sinónimo de *recarga automática al guardar*. Hoy es un servidor estático: hay que apretar F5 a mano. Y si el puerto 5500 está tomado (muy probable, justamente porque la extensión de VS Code usa ese mismo puerto), el arranque falla sin alternativa ni mensaje útil.

**Cómo.**

- Barrer 5500→5510 y quedarse con el primero libre; devolver el puerto elegido en `LiveServerStatus` (el campo ya existe).
- Reaprovechar el watcher de `notify` que ya usa `commands/fs.rs` para detectar cambios bajo la raíz servida, e inyectar en las respuestas `text/html` un `<script>` que escuche por SSE (`tiny_http` sirve SSE sin dependencias nuevas; un WebSocket obligaría a sumar un crate).
- Servir `index.html` cuando el request apunta a un directorio (hoy solo funciona para la raíz exacta).

## 7. [P1] `app/store.ts` tiene 1.494 líneas

**Evidencia.** Es el archivo más grande del repo, y concentra workspace, tabs, layout del sidebar, conversación de IA, streaming del agente, Live Server, LSP, base de datos y settings en un solo `create()`.

**Por qué importa.** Cualquier cambio toca el mismo archivo (conflictos de merge constantes), y ningún consumidor puede suscribirse a un dominio acotado: el store es una sola superficie. También hace que la lógica sea difícil de testear en aislamiento (ver punto 3).

**Cómo.** Zustand soporta el patrón de *slices* sin cambiar la API pública. Partir en `createWorkspaceSlice`, `createEditorSlice`, `createAiSlice`, `createPanelsSlice`, `createSettingsSlice`, componerlos en `useStore` y dejar `store.ts` como el archivo de composición. Los componentes no se enteran. Es refactor mecánico y se puede hacer slice por slice.

## 8. [P2] Herramientas del agente: falta cobertura y falta un límite

**Evidencia.** `app/ai/protocol.ts:78-81` — el agente tiene 4 herramientas: `leer_archivo`, `escribir_archivo`, `listar_carpeta`, `buscar_en_proyecto`. `MAX_STEPS = 20` en `runtime.ts:26`.

**Por qué importa.** Sin `ejecutar_comando` el agente no puede correr los tests o el build de lo que acaba de escribir, así que no puede cerrar el ciclo escribir→verificar→corregir; el usuario queda de intermediario. Sin `editar_archivo` (edición parcial), cada retoque de una línea obliga a reescribir el archivo entero por el stream — costoso en tokens y con riesgo de truncado en archivos grandes.

**Cómo.** Por orden de retorno:

1. `editar_archivo(ruta, buscar, reemplazar)` — la más barata de agregar y la que más tokens ahorra.
2. `ejecutar_comando(comando)` con confirmación explícita del usuario, reutilizando el PTY de `commands/terminal.rs` y el flujo de aprobación que ya existe para los diffs (`PendingDiff`).
3. Un tope de bytes por `escribir_archivo` alineado con `MAX_FILE_BYTES` (1 MB, ya definido en `utils/mod.rs`), para que un modelo en loop no llene el disco.

## 9. [P2] Config del updater inconsistente

**Evidencia.** `tauri.conf.json`: `bundle.createUpdaterArtifacts: true` pero `plugins.updater.active: false`. El workflow `release-tauri.yml` firma y publica los artefactos del updater igual.

**Por qué importa.** Se generan, firman y publican artefactos de actualización que la app nunca va a consultar. O el updater tiene que activarse, o conviene apagar la generación — el estado intermedio hace pensar que las actualizaciones automáticas funcionan cuando no.

**Adicional:** `bundle.targets: "all"` en la config mientras `npm run build` pasa `--bundles nsis`. La bandera gana, pero conviene que la config diga lo mismo para no sorprender a quien corra `tauri build` derecho.

## 10. [P2] CHANGELOG parado en 0.0.1

**Evidencia.** `CHANGELOG.md` solo documenta `[0.0.1] — 2026-06-01`. La app va por 0.0.3, con dos releases de features sin registrar (entre ellas todo el cliente de base de datos SQLite/MySQL/PostgreSQL, que es una feature grande).

**Cómo.** Agregar las entradas 0.0.2 y 0.0.3 reconstruyéndolas del historial de git, y sumar al `CONTRIBUTING.md` que actualizar el CHANGELOG es parte del PR. Los commits ya siguen `type(scope): description`, así que se puede automatizar más adelante.

## 11. [P2] Falta `.gitattributes`

**Evidencia.** Todo comando de git en este repo desde Windows emite `warning: LF will be replaced by CRLF`. Ya estaba anotado como pendiente en el informe de julio.

**Cómo.** Un `.gitattributes` con `* text=auto eol=lf` y `*.png binary`. **Ojo:** el primer commit posterior va a renormalizar los finales de línea de todo el repo — conviene hacerlo en un commit propio, aislado, con `git add --renormalize .`.

## 12. [P2] El chunk principal pesa 425 kB

**Evidencia.** `dist/assets/index-*.js` 425 kB (121 kB gzip), además de `vendor-xterm` 332 kB.

**Por qué importa.** Menos que en la web —es una app de escritorio, se carga del disco— pero impacta el tiempo de arranque en frío. `DatabasePanel` (622 líneas), `SettingsModal`, `CommandPalette` y `FindReplaceOverlay` son paneles que la mayoría de las sesiones no abre.

**Cómo.** `React.lazy` + `Suspense` para esos cuatro, y una entrada más en `manualChunks` de `vite.config.ts` para el panel de base de datos.

---

## Resumen

| # | Prioridad | Propuesta | Esfuerzo |
|---|---|---|---|
| 1 | P0 | Empaquetar Monaco localmente | Medio |
| 2 | P0 | Reactivar la CI (+ `npm ci`, audit, cache) | Bajo |
| 3 | P0 | Tests de frontend con vitest | Medio |
| 4 | P1 | Ajustar la CSP | Bajo |
| 5 | P1 | Toolchain de Rust + `Cargo.lock` | Bajo |
| 6 | P1 | Live Server: recarga automática y puerto libre | Medio |
| 7 | P1 | Partir `store.ts` en slices | Medio |
| 8 | P2 | Herramientas del agente (`editar_archivo`, `ejecutar_comando`) | Medio |
| 9 | P2 | Coherencia del updater | Bajo |
| 10 | P2 | Poner el CHANGELOG al día | Bajo |
| 11 | P2 | `.gitattributes` | Bajo |
| 12 | P2 | Lazy-loading de paneles | Bajo |

**Si hay que elegir tres:** #2 (sin CI nada de lo demás se sostiene), #1 (define si el editor funciona en el instalador) y #3 (los bugs históricos del proyecto están todos donde no hay tests).

## Lo que se revisó y está bien

Para que no se re-audite al pedo:

- **Puente IPC** (`app/tauri-bridge.ts`): sigue 1:1 con el `generate_handler![]` de `main.rs`. Ningún comando huérfano.
- **Path traversal en el workspace** (`utils/resolve_user_path_in_workspace`, `resolve_within_workspace`): correcto, con tests, y todos los comandos de `fs.rs` pasan por ahí. El agujero estaba solo en el Live Server, que no lo usaba (corregido en esta ronda).
- **Higiene del código**: ni un `TODO`/`FIXME`/`HACK` en `app/` ni en `src-tauri/src/`. Un solo `console.log`. 11 `: any` en 12.000 líneas de TS.
- **Manejo de secretos** (`storage/keyring.rs`, `storage/secrets.rs`): keyring del SO con fallback a JSON, detrás de un trait, con tests.
- **Conexiones de base de datos** (`commands/database.rs`): las credenciales van URL-encodeadas al armar el DSN — la inyección por contraseña con caracteres especiales está cubierta.
- **`.gitignore`**: correcto; ni `dist/` ni `target/` están trackeados.
