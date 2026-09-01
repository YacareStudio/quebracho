# Informe de mantenimiento — 2026-08-31

Actualización de dependencias (npm y Rust) y fixes aplicados sobre el estado del repo en `1d5d989 Mejoras`. Continúa el trabajo de `INFORME-MANTENIMIENTO-2026-07-11.md`.

> **Aviso importante sobre la verificación:** esta máquina **ya no tiene toolchain de Rust instalado** (no existe `~/.cargo`, ni `cargo`/`rustc` en el PATH, ni en ninguna ruta del disco). Por eso los checks de Rust (`cargo fmt`, `cargo clippy`, `cargo test`) **no pudieron ejecutarse localmente**. Todo el lado frontend sí quedó verificado. Ver §5 para los pasos pendientes de verificación.

---

## 1. Dependencias npm actualizadas

| Paquete | Antes | Después | Tipo |
|---|---|---|---|
| `react` / `react-dom` | 19.2.7 | **19.2.8** | patch |
| `zustand` | 5.0.14 | **5.0.15** | patch |
| `lucide-react` | 1.24.0 | **1.38.0** | minor (14 releases) |
| `monaco-editor` | 0.55.1 | **0.56.0** | minor — ver §3 |
| `@tauri-apps/api` | 2.11.0 | **2.11.1** | patch |
| `@tauri-apps/plugin-dialog` | 2.7.1 | **2.7.3** | patch |
| `@tauri-apps/plugin-clipboard-manager` | 2.3.2 | **2.3.3** | patch |
| `vite` | 8.1.4 | **8.2.2** | minor |
| `@vitejs/plugin-react` | 6.0.2 | **6.1.1** | minor |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.2 | **4.3.3** | patch |
| `@types/react` | 19.2.17 | **19.2.18** | patch |
| `@types/react-dom` | 19.2.3 | **19.2.5** | patch |

Ya estaban en su última versión y no se tocaron: `@monaco-editor/react` 4.7.0, `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, `diff` 9.0.0, `typescript` 7.0.2, `@tauri-apps/cli` 2.11.4.

### Vulnerabilidad corregida: dompurify

Apareció un advisory nuevo — **GHSA-55q2-fjhq-7xh7** (moderado): en `dompurify <= 3.4.12`, quitar un hook `IN_PLACE` deja un subárbol desprendido pero ejecutable, lo que habilita XSS. El `overrides` del `package.json` apuntaba justamente a `^3.4.12`, así que el árbol quedaba en la versión vulnerable.

- `overrides.dompurify`: `^3.4.12` → **`^3.4.14`**.
- Resultado: `npm audit` → **0 vulnerabilidades** (antes: 2 moderadas).

⚠️ Este `overrides` solo protege el árbol de npm. El Monaco que la app carga en runtime viene de un CDN con su propio dompurify embebido y **no** está cubierto por el override — ver §3 y la propuesta §1 de `PROPUESTAS-MEJORAS-2026-08-31.md`.

## 2. Dependencias Rust actualizadas (`src-tauri/Cargo.toml`)

Se consultó crates.io para las 26 dependencias directas y se subieron los requisitos mínimos a la última versión estable publicada:

| Crate | Antes | Después | Nota |
|---|---|---|---|
| `base64` | 0.22 | **0.23** | major; API usada sin cambios (ver abajo) |
| `tauri` | 2.11.2 | **2.11.5** | |
| `tauri-build` | 2.6.2 | **2.6.3** | |
| `tauri-plugin-dialog` | 2.7.1 | **2.7.3** | |
| `tauri-plugin-updater` | 2.10.1 | **2.11.0** | |
| `tauri-plugin-clipboard-manager` | 2 | **2.3.3** | |
| `keyring` | 4 | **4.2** | incluye el fix de inicialización concurrente de 4.1.6 |
| `tokio` | 1 | **1.53** | |
| `tokio-util` | 0.7.18 | **0.7.19** | |
| `thiserror` | 2 | **2.0.20** | |
| `uuid` | 1 | **1.26** | |
| `regex` | 1 | **1.13** | |
| `futures` | 0.3 | **0.3.34** | |
| `async-trait` | 0.1 | **0.1.92** | |
| `reqwest` | 0.13 | **0.13.4** | |
| `serde` / `serde_json` | 1 | **1.0.228** / **1.0.150** | |
| `bytes`, `once_cell`, `walkdir`, `mime_guess`, `urlencoding`, `notify` | mayor genérico | pin al último minor estable | |

Sin cambio: `sqlx` 0.9, `tiberius` 0.12.3, `portable-pty` 0.9, `tiny_http` 0.12, `wiremock` 0.6.5 (ya en su última versión). `notify` sigue en 8.2: la 9 solo existe como release candidate (`9.0.0-rc.5`).

**Sobre `base64` 0.22 → 0.23 (major).** Las release notes de 0.23 son puramente aditivas (nuevas consts, engines SIMD detrás de la feature `simd-unsafe`, símbolos de padding configurables, MSRV 1.71). El único uso en el proyecto es `general_purpose::STANDARD.encode(...)` en `src-tauri/src/commands/fs.rs`, cuya firma no cambió. Como validación externa, `keyring` 4.2.0 ya depende de `base64` 0.23.1.

**`Cargo.lock` no se regeneró** (sin `cargo` en la máquina). Cargo lo va a resolver solo en el próximo `cargo build`/`cargo test`; para materializarlo explícitamente: `cargo update --manifest-path src-tauri/Cargo.toml`.

## 3. Fix: Monaco de runtime desalineado con el paquete npm

`@monaco-editor/react` no usa el paquete `monaco-editor` instalado: lo baja de jsDelivr en runtime, con una versión que trae hardcodeada su propio loader. El bundle compilado lo confirmaba:

```
dist/assets/vendor-monaco-*.js: cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs
```

Es decir, subir `monaco-editor` a 0.56.0 solo cambiaba **los tipos**, mientras el editor real seguía siendo 0.55.1 — un desfasaje que puede hacer que `tsc` valide APIs que en runtime no existen.

Fix aplicado: nuevo `app/monaco-loader.ts`, importado desde `app/main.tsx`, que fija el path del loader a la versión instalada:

```ts
loader.config({ paths: { vs: `https://cdn.jsdelivr.net/npm/monaco-editor@0.56.0/min/vs` } });
```

Verificado en el bundle: ahora resuelve a `monaco-editor@0.56.0`. Beneficio adicional: Monaco 0.56.0 actualizó su dompurify embebido, mientras que 0.55.1 arrastraba la versión con los CVEs de XSS.

> Esto es una **mitigación, no la solución**. Monaco se sigue bajando por red, lo que la CSP del build empaquetado (`script-src 'self'`) bloquea. La solución correcta —empaquetar Monaco localmente— está detallada como propuesta #1 en `PROPUESTAS-MEJORAS-2026-08-31.md`.

## 4. Fix de seguridad: path traversal en el Live Server

`src-tauri/src/commands/live_server.rs` construía la ruta del archivo a servir directamente desde el target HTTP crudo:

```rust
let rel = request.url().trim_start_matches('/');
let full = root_clone.join(if rel.is_empty() { html_clone.clone() } else { rel.to_string() });
```

Tres problemas:

1. **Directory traversal.** `GET /../../../Users/...` escapaba de la carpeta servida y entregaba cualquier archivo legible del disco. El server escucha en `127.0.0.1`, así que el vector es local (otra app local, o una página en el navegador tirando `<img>`/`<script>` contra `127.0.0.1:5500` para sondear rutas), pero es una lectura arbitraria de archivos igual.
2. **Query string sin recortar.** `GET /app.css?v=3` devolvía 404, porque `?v=3` quedaba dentro del nombre de archivo. Cualquier cache-buster rompía la página servida.
3. **Sin percent-decoding.** `GET /mi%20archivo.css` devolvía 404: los nombres con espacios o acentos nunca cargaban.

Fix: nueva función pura `resolve_request_path(root, url, index_file) -> Option<PathBuf>` que recorta query/fragment, hace percent-decode con `urlencoding` (ya era dependencia), rechaza segmentos `..` y prefijos de unidad de Windows (`C:`, y de paso los ADS de NTFS), y cierra con una verificación `is_path_within` contra la raíz normalizada. Las peticiones rechazadas responden `403` en vez de servir el archivo.

Se agregaron **5 tests unitarios** (`mod tests` en el mismo archivo) que cubren: index en `/`, recorte de query string, percent-decoding, rutas anidadas legítimas y los cinco vectores de traversal (`..`, `..` anidado, `%2e%2e`, `..\` de Windows, `C:/`).

## 5. Fix menor: copia innecesaria de imágenes

`src-tauri/src/commands/fs.rs:121` — `read_image_data_url` hacía `encode(bytes.clone())`, duplicando en memoria el archivo completo solo porque `bytes.len()` se usa después. Cambiado a `encode(&bytes)`: `Engine::encode` acepta `impl AsRef<[u8]>`, así que no hace falta consumir el vector.

## 6. Verificación

| Check | Resultado |
|---|---|
| `npm run typecheck` (TypeScript 7) | ✅ sin errores |
| `npm run build:web` | ✅ build en 2.7 s |
| `npm audit` | ✅ 0 vulnerabilidades |
| Bundle: URL de Monaco | ✅ `monaco-editor@0.56.0` |
| `cargo fmt --check` | ⛔ no ejecutable (sin toolchain) |
| `cargo clippy --all-targets` | ⛔ no ejecutable (sin toolchain) |
| `cargo test` | ⛔ no ejecutable (sin toolchain) |

### Cómo cerrar la verificación pendiente

En una máquina con Rust (o instalando `rustup` acá):

```bash
cargo update --manifest-path src-tauri/Cargo.toml   # materializa las versiones nuevas en Cargo.lock
npm run ci:check                                    # build:web + fmt + clippy + test
```

Los tests nuevos de `live_server.rs` deberían llevar el total de 32 a **37 tests**.

Tampoco alcanza con abrir un PR: la CI (`.github/workflows/ci.yml`) tiene los triggers `pull_request` y `push` comentados y solo corre por `workflow_dispatch`. Es la propuesta #2 del documento de mejoras.

## 7. Archivos tocados

```
 app/main.tsx                          |   1 +
 app/monaco-loader.ts                  |  nuevo
 package.json                          |  30 +-
 package-lock.json                     | 779 +++++-----
 src-tauri/Cargo.toml                  |  46 +-
 src-tauri/src/commands/fs.rs          |   2 +-
 src-tauri/src/commands/live_server.rs | 100 ++++-
```

Sin commits: los cambios quedaron en el working tree.

---

Las propuestas de mejora del análisis integral están en **`PROPUESTAS-MEJORAS-2026-08-31.md`**.
