# Informe de mantenimiento — 2026-07-11

Análisis integral del proyecto, actualización de librerías a últimas versiones y fixes aplicados para el correcto funcionamiento. Todo verificado con `typecheck`, `build:web`, `cargo clippy`, `cargo fmt` y `cargo test` (32 tests, todos en verde).

---

## 1. Dependencias npm actualizadas

| Paquete | Antes | Después | Tipo |
|---|---|---|---|
| `typescript` | 6.0.3 | **7.0.2** | Major — typecheck pasa sin cambios de código |
| `vite` | 8.1.0 | 8.1.4 | Patch |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.1 | 4.3.2 | Patch |
| `@tauri-apps/cli` | 2.11.3 | 2.11.4 | Patch |
| `lucide-react` | 1.21.0 | 1.24.0 | Minor |

### Vulnerabilidades corregidas
`npm audit` reportaba **2 vulnerabilidades (1 moderada, 1 baja)** por el `dompurify <= 3.4.10` embebido en `monaco-editor` (múltiples CVEs de XSS). Se agregó un `overrides` en `package.json` forzando `dompurify ^3.4.12`. Resultado: **0 vulnerabilidades**.

## 2. Dependencias Rust (cargo) actualizadas

- `cargo update` completo dentro de rangos semver (decenas de crates actualizadas; el lockfile además eliminó entradas huérfanas).
- Se verificó contra crates.io que **todas las dependencias directas ya están en su último major estable** (tauri 2.11.5, tauri-build 2.6.3, reqwest 0.13.4, sqlx 0.9, keyring 4.1.4, etc.). `notify 9` existe solo como release candidate, por lo que se mantiene en 8.

### Fix requerido: migración de la API de `keyring` 4.1
`cargo update` subió `keyring` a 4.1.4, donde `keyring::use_native_store()` fue eliminado (ahora vive detrás de la feature `cli`). Con la feature default `v1`, `keyring::Entry::new()` registra automáticamente el store nativo del SO en el primer uso.

- `src-tauri/src/storage/keyring.rs`: se eliminó el registro manual (`ensure_native_store` + `std::sync::Once`) y se migró de `keyring_core::Entry` a `keyring::Entry` en todo el archivo.
- `src-tauri/Cargo.toml`: se eliminó la dependencia directa `keyring-core` (ya no se usa; sigue presente como transitiva).

Sin este fix el proyecto **no compilaba** con las dependencias actualizadas.

## 3. Bug corregido: corrupción de archivos con escapes `\uXXXX` en el streaming del agente

`app/ai/streamRouter.ts` decodifica en vivo el JSON del tool call `escribir_archivo` para tipear el contenido en Monaco. El decodificador **no manejaba escapes unicode `\uXXXX`**: un archivo cuyo contenido incluyera por ejemplo `é` se escribía a disco como `u00e9` literal, porque `agentStreamFinalizeTab` persiste exactamente lo que decodificó el router (el runtime luego omite la escritura redundante).

Fix aplicado:
- Nuevo estado `unicodeHex` en el parser: al ver `\u` acumula los 4 dígitos hex y emite `String.fromCharCode(...)` (los pares sustitutos funcionan naturalmente al concatenarse en UTF-16). Ante hex inválido, emite la secuencia literal como mejor esfuerzo.
- `decodeJsonString()` (usada para la ruta del archivo) ahora usa `JSON.parse` con fallback manual, cubriendo todos los escapes correctamente.
- Reset del nuevo estado en todas las transiciones del parser.

## 4. Provider de Anthropic: listado real de modelos

`src-tauri/src/providers/anthropic.rs` devolvía una lista hardcodeada. Ahora `list_models`:
- Con API key configurada, consulta el endpoint real `GET /v1/models` (header `x-api-key` + `anthropic-version`) y mapea `data[].id`.
- Sin key, con error HTTP o respuesta vacía, cae a la lista estática actualizada.

Además se actualizaron los modelos de fallback (aquí y en `FALLBACK_MODELS` de `commands/ai.rs`) a los IDs vigentes: `claude-opus-4-8`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5` (antes faltaba Sonnet 5 y se usaba el ID datado de Haiku).

## 5. Versiones unificadas

Las tres fuentes de versión estaban desincronizadas y se unificaron a **0.0.3**:
- `package.json`: 0.0.3 (ya estaba)
- `src-tauri/Cargo.toml`: 0.0.2 → 0.0.3
- `src-tauri/tauri.conf.json`: 0.0.1-alpha3 → 0.0.3 ← esta es la que usa el updater y el instalador

## 6. CI actualizado a Node 24

`node-version: 20 → 24` en `.github/workflows/ci.yml` y `release-tauri.yml`. Node 20 alcanzó fin de vida (EOL) en abril de 2026; Node 24 es el LTS actual.

## 7. Análisis integral — verificaciones sin hallazgos

- **Puente IPC**: los 63 comandos invocados en `app/tauri-bridge.ts` coinciden 1:1 con los registrados en `generate_handler![]` de `main.rs`. Sin comandos huérfanos en ninguna dirección.
- **Runtime del agente** (`app/ai/runtime.ts`, `protocol.ts`): flujo correcto; `parseAssistantTurn` usa `JSON.parse` real; el loop respeta `MAX_STEPS` y el flujo de diffs.
- **Manejo de errores frontend**: consistente (errores logueados, sin catch vacíos); sin TODOs/FIXMEs pendientes.
- **Cambios preexistentes en el working tree** (formateo `cargo fmt`, pruning de `node_modules` en búsquedas, URL-encoding en conexiones DB, tests nuevos): se conservaron y se construyó encima de ellos.

## 8. Verificación final

| Check | Resultado |
|---|---|
| `npm run typecheck` (TypeScript 7) | ✅ sin errores |
| `npm run build:web` | ✅ build en ~2 s |
| `cargo clippy --all-targets` | ✅ sin warnings |
| `cargo fmt --check` | ✅ |
| `cargo test` | ✅ 32 passed, 0 failed |
| `npm audit` | ✅ 0 vulnerabilidades |

## Pendientes sugeridos (no aplicados)

- `notify` 9 cuando salga estable (hoy solo RC).
- Considerar exponer `claude-fable-5` como modelo seleccionable: requiere manejo especial (thinking siempre activo, stop reason `refusal`), por lo que se dejó fuera del fallback.
- Los archivos del repo tienen finales de línea LF y git en Windows advierte conversión a CRLF; valdría agregar un `.gitattributes` con `* text=auto eol=lf` para silenciar los warnings de forma consistente.
